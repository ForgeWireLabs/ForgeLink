import { createHash } from "node:crypto";
import { lookup as dnsLookupAll } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

export const MAX_SIGNAL_BYTES = 1024 * 1024;
export const MAX_SIGNAL_REDIRECTS = 3;
export const SIGNAL_FETCH_TIMEOUT_MS = 8000;
export const SIGNAL_STALE_MULTIPLIER = 2;
const MAX_ITEMS = 100;
const MAX_CREDENTIAL_SCAN_DEPTH = 3;

const TRACKING_QUERY_KEYS = /^(utm_[^=]*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|vero_id|_ga|yclid)$/i;
/** Shared credential-like parameter names (rejection, redaction, scrubbing, errors). */
export const SECRET_QUERY_KEYS = /^(?:api[_-]?key|x[_-]?api[_-]?key|client[_-]?secret|client[_-]?id|access[_-]?token|refresh[_-]?token|id[_-]?token|token|auth|authorization|bearer|password|passwd|secret|session|sid|sig|signature|key|x[_-]?amz[_-].+|x[_-]?goog[_-].+)$/i;
const SECRET_ASSIGNMENT_SOURCE = "(?:api[_-]?key|x[_-]?api[_-]?key|client[_-]?secret|client[_-]?id|access[_-]?token|refresh[_-]?token|id[_-]?token|token|auth|authorization|bearer|password|passwd|secret|session|sid|sig|signature|key|x[_-]?amz[_-][\\w-]+|x[_-]?goog[_-][\\w-]+)";
const CREDENTIAL_ASSIGNMENT = new RegExp(`(?:^|[?#&\\/\\s;,:])${SECRET_ASSIGNMENT_SOURCE}\\s*[:=]`, "i");
const CREDENTIAL_ASSIGNMENT_REPLACE = new RegExp(`\\b(${SECRET_ASSIGNMENT_SOURCE})\\s*[:=]\\s*[^\\s&"'#]+`, "gi");
const JWT_LIKE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SHA256_HEX = /^[a-f0-9]{64}$/i;
const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata", "kubernetes.default", "kubernetes.default.svc"]);

/** Always forbidden: link-local + cloud metadata endpoints (never permitted, even for LAN operators). */
const ALWAYS_FORBIDDEN = new BlockList();
ALWAYS_FORBIDDEN.addSubnet("169.254.0.0", 16, "ipv4"); // link-local incl. IMDS / ECS task metadata
ALWAYS_FORBIDDEN.addSubnet("fe80::", 10, "ipv6");
ALWAYS_FORBIDDEN.addAddress("100.100.100.200", "ipv4"); // Alibaba metadata
ALWAYS_FORBIDDEN.addAddress("fd00:ec2::254", "ipv6");

/** Operator-permitted LAN when allowPrivate is true. */
const OPERATOR_LAN = new BlockList();
OPERATOR_LAN.addSubnet("10.0.0.0", 8, "ipv4");
OPERATOR_LAN.addSubnet("127.0.0.0", 8, "ipv4");
OPERATOR_LAN.addSubnet("172.16.0.0", 12, "ipv4");
OPERATOR_LAN.addSubnet("192.168.0.0", 16, "ipv4");
OPERATOR_LAN.addSubnet("::1", 128, "ipv6");
OPERATOR_LAN.addSubnet("fc00::", 7, "ipv6");

/**
 * Additional IANA special-purpose / non-globally-reachable ranges. Treated as non-public for
 * redirect classification so public feeds cannot pivot into them.
 */
const SPECIAL_PURPOSE = new BlockList();
SPECIAL_PURPOSE.addSubnet("0.0.0.0", 8, "ipv4");
SPECIAL_PURPOSE.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT
SPECIAL_PURPOSE.addSubnet("192.0.0.0", 24, "ipv4");
SPECIAL_PURPOSE.addSubnet("192.0.2.0", 24, "ipv4"); // TEST-NET-1
SPECIAL_PURPOSE.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
SPECIAL_PURPOSE.addSubnet("198.51.100.0", 24, "ipv4"); // TEST-NET-2
SPECIAL_PURPOSE.addSubnet("203.0.113.0", 24, "ipv4"); // TEST-NET-3
SPECIAL_PURPOSE.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
SPECIAL_PURPOSE.addSubnet("240.0.0.0", 4, "ipv4"); // reserved
SPECIAL_PURPOSE.addSubnet("::", 128, "ipv6");
SPECIAL_PURPOSE.addSubnet("100::", 64, "ipv6"); // discard-only
SPECIAL_PURPOSE.addSubnet("2001:db8::", 32, "ipv6"); // documentation
SPECIAL_PURPOSE.addSubnet("ff00::", 8, "ipv6"); // multicast

export interface ParsedSignalItem {
  external_id: string;
  title: string;
  url: string;
  summary: string;
  author: string;
  published_at: string | null;
}

export interface ParsedSignalFeed {
  title: string;
  items: ParsedSignalItem[];
}

export type SignalHealthState = "ok" | "never_fetched" | "failed" | "stale" | "paused";
export interface SignalHealth { state: SignalHealthState; detail: string; }
export type SignalDnsLookup = (hostname: string) => Promise<string[]>;
export type SignalFetch = (input: string | URL, init?: UndiciRequestInit) => Promise<Response>;
export type SignalAddressClass = "forbidden" | "lan" | "special" | "public";

let signalDnsLookup: SignalDnsLookup = async (hostname) => {
  const results = await dnsLookupAll(hostname, { all: true, verbatim: true });
  return results.map((row) => row.address);
};
let signalFetch: SignalFetch = undiciFetch as unknown as SignalFetch;

export function setSignalDnsLookupForTests(lookup: SignalDnsLookup | null): void {
  signalDnsLookup = lookup ?? (async (hostname) => {
    const results = await dnsLookupAll(hostname, { all: true, verbatim: true });
    return results.map((row) => row.address);
  });
}

export function setSignalFetchForTests(fetchImpl: SignalFetch | null): void {
  signalFetch = fetchImpl ?? (undiciFetch as unknown as SignalFetch);
}

function decodeEntities(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'");
}

function stripTags(value: string): string {
  return decodeEntities(value).replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
}

function firstTag(block: string, names: string[]): string {
  for (const name of names) {
    const escaped = name.replace(":", "\\:");
    const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
    if (match) return stripTags(match[1]);
  }
  return "";
}

function firstLink(block: string): string {
  const atom = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  if (atom) return decodeEntities(atom[1]).trim();
  return firstTag(block, ["link"]);
}

function blocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((match) => match[1]);
}

function normalizeIso(value: string): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function fingerprint(...parts: string[]): string {
  return createHash("sha256").update(parts.filter(Boolean).join("\n")).digest("hex");
}

export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function isSecretQueryKey(key: string): boolean {
  return SECRET_QUERY_KEYS.test(key);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Shared detector for userinfo, query keys/values, fragments, and non-URL assignments/JWTs. */
export function containsCredentialMaterial(value: string, depth = 0): boolean {
  if (!value || depth > MAX_CREDENTIAL_SCAN_DEPTH) return false;
  const trimmed = value.trim();
  if (JWT_LIKE.test(trimmed)) return true;
  if (CREDENTIAL_ASSIGNMENT.test(value)) return true;
  try {
    const url = new URL(value);
    if (url.username || url.password) return true;
    if (url.hash) {
      const hash = safeDecode(url.hash.replace(/^#/, ""));
      if (containsCredentialMaterial(hash, depth + 1)) return true;
    }
    for (const [key, raw] of url.searchParams.entries()) {
      if (isSecretQueryKey(key)) return true;
      const decoded = safeDecode(raw);
      if (JWT_LIKE.test(decoded.trim()) || CREDENTIAL_ASSIGNMENT.test(decoded)) return true;
      if (looksLikeUrl(decoded) && containsCredentialMaterial(decoded, depth + 1)) return true;
      if (decoded !== raw && containsCredentialMaterial(decoded, depth + 1)) return true;
    }
    return false;
  } catch {
    return CREDENTIAL_ASSIGNMENT.test(value) || JWT_LIKE.test(trimmed);
  }
}

export function stripTrackingParams(value: string): string {
  if (!value) return value;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_QUERY_KEYS.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}

export function stripCredentialMaterial(value: string): string {
  if (!value) return value;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const [key, raw] of [...url.searchParams.entries()]) {
      if (isSecretQueryKey(key) || containsCredentialMaterial(raw) || containsCredentialMaterial(safeDecode(raw))) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

export function sanitizeItemUrl(value: string): string {
  return stripCredentialMaterial(stripTrackingParams(value)).slice(0, 1000);
}

export function urlContainsCredentialMaterial(value: string): boolean {
  return containsCredentialMaterial(value);
}

export function assertUnauthenticatedFeedUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Feed URL is invalid.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Feed URL must use http or https.");
  if (url.hash) throw new Error("Feed URL must not include a fragment.");
  if (url.username || url.password) {
    throw new Error("Feed URL must not include username/password. Authenticated feeds are not supported yet.");
  }
  if (containsCredentialMaterial(url.toString())) {
    throw new Error("Feed URL must not include credential-like query parameters. Authenticated feeds are not supported yet.");
  }
  return url;
}

export function redactSignalUrlSecrets(value: string): string {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (url.username) url.username = "REDACTED";
    if (url.password) url.password = "REDACTED";
    for (const [key, raw] of [...url.searchParams.entries()]) {
      if (isSecretQueryKey(key) || containsCredentialMaterial(raw) || containsCredentialMaterial(safeDecode(raw))) {
        url.searchParams.set(key, "REDACTED");
      }
    }
    if (url.hash && containsCredentialMaterial(url.hash)) url.hash = "#REDACTED";
    return url.toString();
  } catch {
    return containsCredentialMaterial(value) ? "[redacted]" : "[invalid-url]";
  }
}

export function canonicalExternalId(input: {
  rawGuid?: string;
  sanitizedUrl?: string;
  feedUrl?: string;
  title?: string;
  summary?: string;
}): string {
  const rawGuid = (input.rawGuid || "").trim();
  if (rawGuid) {
    if (looksLikeUrl(rawGuid) || containsCredentialMaterial(rawGuid)) return fingerprint("guid", rawGuid);
    return rawGuid.slice(0, 1000);
  }
  const sanitizedUrl = (input.sanitizedUrl || "").trim();
  if (sanitizedUrl) return fingerprint("url", sanitizedUrl);
  return fingerprint(input.feedUrl || "", input.title || "", input.summary || "");
}

/** 19da3f1 hashed URL-shaped ids as sha256("legacy-external\\n" + original). */
export function legacy19daExternalId(originalExternalId: string): string {
  return fingerprint("legacy-external", originalExternalId);
}

/**
 * Candidate identities for migration-era dedupe when the URL/GUID distinction was lost.
 */
export function signalDedupeAliases(input: { externalId: string; url?: string }): string[] {
  const aliases = new Set<string>([input.externalId.slice(0, 1000)]);
  const rawUrl = (input.url || "").trim();
  const sanitized = rawUrl ? sanitizeItemUrl(rawUrl) : "";
  if (sanitized) {
    aliases.add(canonicalExternalId({ sanitizedUrl: sanitized }));
    aliases.add(legacy19daExternalId(rawUrl));
    aliases.add(legacy19daExternalId(sanitized));
  }
  if (rawUrl && looksLikeUrl(rawUrl)) {
    aliases.add(canonicalExternalId({ rawGuid: rawUrl }));
    if (sanitized && sanitized !== rawUrl) aliases.add(canonicalExternalId({ rawGuid: sanitized }));
  }
  if (looksLikeUrl(input.externalId)) {
    aliases.add(canonicalExternalId({ sanitizedUrl: sanitizeItemUrl(input.externalId) }));
    aliases.add(canonicalExternalId({ rawGuid: input.externalId }));
    aliases.add(legacy19daExternalId(input.externalId));
  }
  return [...aliases].filter(Boolean);
}

/** Migrate a stored external_id toward the parser's canonical scheme when possible. */
export function migrateStoredExternalId(item: { external_id: string; url: string }): string {
  const current = item.external_id;
  const rawUrl = item.url || "";
  const sanitized = sanitizeItemUrl(rawUrl || current);

  if (looksLikeUrl(current) || containsCredentialMaterial(current)) {
    const sanitizedExt = sanitizeItemUrl(current);
    if (!rawUrl || sanitizeItemUrl(rawUrl) === sanitizedExt || rawUrl === current) {
      return canonicalExternalId({ sanitizedUrl: sanitizedExt || sanitized });
    }
    return canonicalExternalId({ rawGuid: current });
  }

  if (SHA256_HEX.test(current) && rawUrl) {
    const legacyRaw = legacy19daExternalId(rawUrl);
    const legacySanitized = legacy19daExternalId(sanitized);
    if (current === legacyRaw || current === legacySanitized) {
      return canonicalExternalId({ sanitizedUrl: sanitized });
    }
    const urlIdentity = canonicalExternalId({ sanitizedUrl: sanitized });
    const guidIdentity = canonicalExternalId({ rawGuid: rawUrl });
    if (current === urlIdentity || current === guidIdentity || current === canonicalExternalId({ rawGuid: sanitized })) {
      return current;
    }
    // Opaque migration-era hash with a usable item URL: converge on URL identity for refresh dedupe.
    return urlIdentity;
  }

  return current;
}

export function redactExportExternalId(value: string): string {
  if (!value) return value;
  if (!looksLikeUrl(value) && !containsCredentialMaterial(value) && !/\/\/[^/\s]+@/.test(value)) return value;
  return `sha256:${fingerprint("external_id", value)}`;
}

export function sanitizeSignalError(message: string): string {
  if (!message) return "";
  let out = String(message);
  out = out.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => redactSignalUrlSecrets(match));
  out = out.replace(/\b[^\s/:@]+:[^\s/@]+@/g, "REDACTED:REDACTED@");
  out = out.replace(CREDENTIAL_ASSIGNMENT_REPLACE, "$1=REDACTED");
  return out.replace(/\s+/g, " ").trim().slice(0, 500);
}

export function toSignalSubscriptionDto<T extends { url: string; last_error?: string }>(row: T): T {
  return {
    ...row,
    url: redactSignalUrlSecrets(row.url),
    last_error: sanitizeSignalError(row.last_error || "")
  };
}

export function signalSubscriptionHealth(input: {
  enabled: boolean;
  last_fetch_at: string | null;
  last_fetch_status: string;
  fetch_interval_minutes: number;
  now?: number;
}): SignalHealth {
  if (!input.enabled) return { state: "paused", detail: "Paused" };
  if (input.last_fetch_status === "failed") return { state: "failed", detail: "Last fetch failed" };
  if (!input.last_fetch_at) return { state: "never_fetched", detail: "Never fetched" };
  const fetchedAt = new Date(input.last_fetch_at).getTime();
  if (!Number.isFinite(fetchedAt)) return { state: "never_fetched", detail: "Never fetched" };
  const intervalMs = Math.max(15, Number(input.fetch_interval_minutes) || 60) * 60_000;
  const ageMs = (input.now ?? Date.now()) - fetchedAt;
  if (ageMs > intervalMs * SIGNAL_STALE_MULTIPLIER) {
    return { state: "stale", detail: `Stale (no fetch for ${Math.round(ageMs / 60_000)}m)` };
  }
  return { state: "ok", detail: "Healthy" };
}

export function normalizeSignalIp(address: string): { address: string; family: 4 | 6 } {
  const family = isIP(address);
  if (family === 4) return { address, family: 4 };
  if (family === 6) {
    const dotted = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (dotted) return { address: dotted[1], family: 4 };
    const hexMapped = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return { address: `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`, family: 4 };
    }
    return { address, family: 6 };
  }
  throw new Error("Feed host could not be resolved.");
}

export function classifySignalAddress(address: string): SignalAddressClass {
  const normalized = normalizeSignalIp(address);
  const type = normalized.family === 4 ? "ipv4" : "ipv6";
  if (ALWAYS_FORBIDDEN.check(normalized.address, type)) return "forbidden";
  if (OPERATOR_LAN.check(normalized.address, type)) return "lan";
  if (SPECIAL_PURPOSE.check(normalized.address, type)) return "special";
  return "public";
}

export function isCloudMetadataAddress(address: string): boolean {
  try {
    const normalized = normalizeSignalIp(address).address.toLowerCase();
    return normalized.startsWith("169.254.") || normalized === "100.100.100.200" || address.toLowerCase() === "fd00:ec2::254";
  } catch {
    return false;
  }
}

export function isCloudMetadataHostname(hostname: string): boolean {
  return METADATA_HOSTS.has(hostname.replace(/^\[|\]$/g, "").toLowerCase());
}

export function isBlockedSignalAddress(address: string): boolean {
  try {
    return classifySignalAddress(address) !== "public";
  } catch {
    return true;
  }
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa") || host.endsWith(".internal")) return true;
  if (isCloudMetadataHostname(host)) return true;
  if (isIP(host)) return classifySignalAddress(host) === "lan";
  return false;
}

export interface PinnedSignalTarget {
  url: URL;
  address: string;
  family: 4 | 6;
  isPrivate: boolean;
  agent: Agent;
}

export function createPinnedAgent(address: string, family: 4 | 6, connectTimeoutMs?: number): Agent {
  return new Agent({
    connect: {
      timeout: connectTimeoutMs && connectTimeoutMs > 0 ? connectTimeoutMs : SIGNAL_FETCH_TIMEOUT_MS,
      lookup(_hostname, options, callback) {
        if (options?.all) {
          callback(null, [{ address, family }]);
          return;
        }
        callback(null, address, family);
      }
    }
  });
}

export async function withSignalDeadline<T>(promise: Promise<T>, remainingMs: number, label: string): Promise<T> {
  if (remainingMs <= 0) throw new Error("Feed fetch timed out.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Feed ${label} timed out.`)), remainingMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolve, validate, and pin a feed target.
 * Always-forbidden infrastructure is rejected even when allowPrivate is true.
 * allowPrivate only permits operator LAN (RFC1918/loopback/ULA).
 */
export async function resolveValidateAndPin(
  url: URL,
  options: { allowPrivate: boolean; remainingMs: number }
): Promise<PinnedSignalTarget> {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Feed URL must use http or https.");
  if (url.username || url.password || url.hash || containsCredentialMaterial(url.toString())) {
    throw new Error("Feed URL must not include credentials.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isCloudMetadataHostname(host)) throw new Error("Feed host is not allowed.");

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    addresses = await withSignalDeadline(signalDnsLookup(host), options.remainingMs, "DNS");
  }
  if (!addresses.length) throw new Error("Feed host could not be resolved.");

  const classes = addresses.map((address) => classifySignalAddress(address));
  if (classes.some((value) => value === "forbidden")) throw new Error("Feed host is not allowed.");
  const nonPublic = classes.filter((value) => value !== "public");
  const publics = classes.filter((value) => value === "public");
  if (nonPublic.length && publics.length) throw new Error("Feed host resolved to mixed public and private addresses.");

  const isPrivate = nonPublic.length > 0;
  if (isPrivate && !options.allowPrivate) throw new Error("Feed redirect target is not allowed.");
  // Special-purpose ranges are never operator LAN, even on the initial hop.
  if (classes.every((value) => value === "special")) throw new Error("Feed host is not allowed.");

  const pinned = normalizeSignalIp(addresses[0]);
  const remainingAfterDns = options.remainingMs; // caller recomputes wall-clock remaining
  return {
    url,
    address: pinned.address,
    family: pinned.family,
    isPrivate: classes.every((value) => value === "lan"),
    agent: createPinnedAgent(pinned.address, pinned.family, remainingAfterDns)
  };
}

export function assertWellFormedFeedXml(xml: string): void {
  if (!xml || !xml.trim()) throw new Error("Feed body is empty.");
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new Error("Feed XML with DTD or entity declarations is not allowed.");
  }
  const validated = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (validated !== true) {
    const message = typeof validated === "object" && validated.err?.msg ? validated.err.msg : "Feed XML is not well-formed.";
    throw new Error(`Feed XML is not well-formed: ${message}`);
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    htmlEntities: false,
    allowBooleanAttributes: false
  });
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new Error("Feed XML is not well-formed.");
  }
  const rootKeys = Object.keys(doc).filter((key) => key !== "?xml");
  if (rootKeys.length !== 1) throw new Error("Feed XML must have a single RSS or Atom root element.");
  if (!/^(rss|feed|rdf:RDF)$/i.test(rootKeys[0])) throw new Error("Feed body is not readable RSS or Atom XML.");
}

export function parseTrustedSignalFeed(xml: string, feedUrl: string): ParsedSignalFeed {
  assertWellFormedFeedXml(xml);
  const source = xml.replace(/<!--[\s\S]*?-->/g, "");
  const channel = source.match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i)?.[1] || source;
  const feedTitle = firstTag(channel, ["title"]) || new URL(feedUrl).hostname;
  const candidates = blocks(source, "item").length ? blocks(source, "item") : blocks(source, "entry");
  const items = candidates.slice(0, MAX_ITEMS).map((block): ParsedSignalItem => {
    const title = firstTag(block, ["title"]) || "Untitled";
    const url = sanitizeItemUrl(firstLink(block));
    const rawExternal = firstTag(block, ["guid", "id"]);
    const summary = firstTag(block, ["description", "summary", "content", "content:encoded"]).slice(0, 1200);
    const author = firstTag(block, ["author", "dc:creator", "name"]).slice(0, 160);
    return {
      external_id: canonicalExternalId({ rawGuid: rawExternal, sanitizedUrl: url, feedUrl, title, summary }),
      title: title.slice(0, 240),
      url,
      summary,
      author,
      published_at: normalizeIso(firstTag(block, ["pubDate", "published", "updated"]))
    };
  }).filter((item) => item.title || item.url);
  return { title: feedTitle.slice(0, 160), items };
}

export async function boundedText(response: Response, maxBytes = MAX_SIGNAL_BYTES): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error("Feed response exceeds the 1 MB limit.");
    return text;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Feed response exceeds the 1 MB limit.");
      chunks.push(value);
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchTrustedSignalFeedHop(
  feedUrl: string,
  state: {
    redirectCount: number;
    startedAt: number;
    deadlineMs: number;
    originPrivate: boolean | null;
    currentProtocol: string;
    sawHttps: boolean;
  }
): Promise<ParsedSignalFeed> {
  const remainingBefore = state.deadlineMs - (Date.now() - state.startedAt);
  if (remainingBefore <= 0) throw new Error("Feed fetch timed out.");
  if (state.redirectCount > MAX_SIGNAL_REDIRECTS) throw new Error("Feed redirected too many times.");
  const url = assertUnauthenticatedFeedUrl(feedUrl);
  if (state.redirectCount > 0 && state.sawHttps && url.protocol === "http:") {
    throw new Error("Feed HTTPS to HTTP redirect downgrade is not allowed.");
  }
  if (state.redirectCount > 0 && state.currentProtocol === "https:" && url.protocol === "http:") {
    throw new Error("Feed HTTPS to HTTP redirect downgrade is not allowed.");
  }

  const allowPrivate = state.redirectCount === 0 ? true : state.originPrivate === true;
  const pinned = await resolveValidateAndPin(url, { allowPrivate, remainingMs: remainingBefore });
  const originPrivate = state.redirectCount === 0 ? pinned.isPrivate : Boolean(state.originPrivate);
  const remainingAfterDns = state.deadlineMs - (Date.now() - state.startedAt);
  if (remainingAfterDns <= 0) {
    await pinned.agent.close();
    throw new Error("Feed fetch timed out.");
  }

  try {
    const response = await signalFetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(remainingAfterDns),
      headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.2" },
      dispatcher: pinned.agent
    }) as unknown as Response;
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Feed redirect did not include a location.");
      const next = new URL(location, url);
      if (url.protocol === "https:" && next.protocol === "http:") {
        throw new Error("Feed HTTPS to HTTP redirect downgrade is not allowed.");
      }
      return fetchTrustedSignalFeedHop(next.toString(), {
        redirectCount: state.redirectCount + 1,
        startedAt: state.startedAt,
        deadlineMs: state.deadlineMs,
        originPrivate,
        currentProtocol: url.protocol,
        sawHttps: state.sawHttps || url.protocol === "https:"
      });
    }
    if (!response.ok) throw new Error(`Feed fetch failed (${response.status}).`);
    const type = response.headers.get("content-type") || "";
    if (type && !/(xml|rss|atom|text\/plain|application\/octet-stream)/i.test(type)) throw new Error(`Unsupported feed content type: ${type.split(";")[0]}.`);
    const parsed = parseTrustedSignalFeed(await boundedText(response), url.toString());
    if (!parsed.items.length) throw new Error("Feed did not contain readable RSS or Atom items.");
    return parsed;
  } finally {
    await pinned.agent.close();
  }
}

export async function fetchTrustedSignalFeed(feedUrl: string): Promise<ParsedSignalFeed> {
  const url = assertUnauthenticatedFeedUrl(feedUrl);
  return fetchTrustedSignalFeedHop(feedUrl, {
    redirectCount: 0,
    startedAt: Date.now(),
    deadlineMs: SIGNAL_FETCH_TIMEOUT_MS,
    originPrivate: null,
    currentProtocol: url.protocol,
    sawHttps: url.protocol === "https:"
  });
}
