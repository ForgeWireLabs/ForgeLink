import { createHash } from "node:crypto";
import { lookup as dnsLookupAll } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

export const MAX_SIGNAL_BYTES = 1024 * 1024;
export const MAX_SIGNAL_REDIRECTS = 3;
export const SIGNAL_FETCH_TIMEOUT_MS = 8000;
/** A source is stale when last successful/attempted fetch is older than this multiple of its interval. */
export const SIGNAL_STALE_MULTIPLIER = 2;
const MAX_ITEMS = 100;

const TRACKING_QUERY_KEYS = /^(utm_[^=]*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|vero_id|_ga|yclid)$/i;
/** Query/fragment/parameter names that indicate credential material. */
export const SECRET_QUERY_KEYS = /^(?:api[_-]?key|x[_-]?api[_-]?key|client[_-]?secret|client[_-]?id|access[_-]?token|refresh[_-]?token|id[_-]?token|token|auth|authorization|bearer|password|passwd|secret|session|sid|sig|signature|key|x[_-]?amz[_-].+|x[_-]?goog[_-].+)$/i;
const CREDENTIAL_ASSIGNMENT = /(?:^|[?#&\/\s;,:])(?:api[_-]?key|x[_-]?api[_-]?key|client[_-]?secret|client[_-]?id|access[_-]?token|refresh[_-]?token|id[_-]?token|token|auth|authorization|bearer|password|passwd|secret|session|sid|sig|signature|key|x[_-]?amz[_-][\w-]+|x[_-]?goog[_-][\w-]+)\s*[:=]/i;
const JWT_LIKE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata", "kubernetes.default", "kubernetes.default.svc"]);

const NON_GLOBAL = new BlockList();
NON_GLOBAL.addSubnet("0.0.0.0", 8, "ipv4");
NON_GLOBAL.addSubnet("10.0.0.0", 8, "ipv4");
NON_GLOBAL.addSubnet("127.0.0.0", 8, "ipv4");
NON_GLOBAL.addSubnet("169.254.0.0", 16, "ipv4");
NON_GLOBAL.addSubnet("172.16.0.0", 12, "ipv4");
NON_GLOBAL.addSubnet("192.168.0.0", 16, "ipv4");
NON_GLOBAL.addSubnet("100.64.0.0", 10, "ipv4");
NON_GLOBAL.addSubnet("224.0.0.0", 4, "ipv4");
NON_GLOBAL.addSubnet("::", 128, "ipv6");
NON_GLOBAL.addSubnet("::1", 128, "ipv6");
NON_GLOBAL.addSubnet("fc00::", 7, "ipv6");
NON_GLOBAL.addSubnet("fe80::", 10, "ipv6");
NON_GLOBAL.addSubnet("ff00::", 8, "ipv6");

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

export interface SignalHealth {
  state: SignalHealthState;
  detail: string;
}

export type SignalDnsLookup = (hostname: string) => Promise<string[]>;
export type SignalFetch = (input: string | URL, init?: UndiciRequestInit) => Promise<Response>;

let signalDnsLookup: SignalDnsLookup = async (hostname) => {
  const results = await dnsLookupAll(hostname, { all: true, verbatim: true });
  return results.map((row) => row.address);
};

let signalFetch: SignalFetch = undiciFetch as unknown as SignalFetch;

/** Test seam for redirect/SSRF fixtures. Pass null to restore the default resolver. */
export function setSignalDnsLookupForTests(lookup: SignalDnsLookup | null): void {
  signalDnsLookup = lookup ?? (async (hostname) => {
    const results = await dnsLookupAll(hostname, { all: true, verbatim: true });
    return results.map((row) => row.address);
  });
}

/** Test seam for fetch pinning. Pass null to restore undici fetch. */
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

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function isSecretQueryKey(key: string): boolean {
  return SECRET_QUERY_KEYS.test(key);
}

/** Shared detector for URL userinfo, query, fragment, and non-URL key/value credential material. */
export function containsCredentialMaterial(value: string): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (JWT_LIKE.test(trimmed)) return true;
  if (CREDENTIAL_ASSIGNMENT.test(value)) return true;
  try {
    const url = new URL(value);
    if (url.username || url.password) return true;
    if (url.hash && (CREDENTIAL_ASSIGNMENT.test(url.hash) || JWT_LIKE.test(url.hash.replace(/^#/, "")))) return true;
    for (const key of url.searchParams.keys()) {
      if (isSecretQueryKey(key)) return true;
    }
    return false;
  } catch {
    return CREDENTIAL_ASSIGNMENT.test(value) || JWT_LIKE.test(trimmed);
  }
}

/** Strip common tracking/analytics query parameters from feed item URLs. */
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

/** Remove userinfo, credential-like query/fragment parameters, and fragments from a URL. */
export function stripCredentialMaterial(value: string): string {
  if (!value) return value;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (isSecretQueryKey(key)) url.searchParams.delete(key);
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

/** @deprecated Use containsCredentialMaterial — kept as a compatibility alias. */
export function urlContainsCredentialMaterial(value: string): boolean {
  return containsCredentialMaterial(value);
}

/**
 * Reject subscription URLs that embed HTTP credentials, credential-like query
 * parameters, or fragments. Authenticated feeds require a future secure-settings path.
 */
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
  if (containsCredentialMaterial(url.toString()) || [...url.searchParams.keys()].some(isSecretQueryKey)) {
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
    for (const key of [...url.searchParams.keys()]) {
      if (isSecretQueryKey(key)) url.searchParams.set(key, "REDACTED");
    }
    if (url.hash && containsCredentialMaterial(url.hash)) url.hash = "#REDACTED";
    return url.toString();
  } catch {
    return containsCredentialMaterial(value) ? "[redacted]" : "[invalid-url]";
  }
}

/** Canonical external id used by the parser, scrubber, and dedupe path. */
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

/** Hash any suspicious external id so export/scrub never retain secrets. */
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
  out = out.replace(/([?#&](?:api[_-]?key|x[_-]?api[_-]?key|client[_-]?secret|token|access[_-]?token|auth|password|secret|session|sid|sig|signature|key|x[_-]?amz[_-][\w-]+|x[_-]?goog[_-][\w-]+)=)[^&\s"'#]+/gi, "$1REDACTED");
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

export function isCloudMetadataAddress(address: string): boolean {
  const normalized = normalizeSignalIp(address).address.toLowerCase();
  return normalized === "169.254.169.254" || address.toLowerCase() === "fd00:ec2::254";
}

export function isCloudMetadataHostname(hostname: string): boolean {
  return METADATA_HOSTS.has(hostname.replace(/^\[|\]$/g, "").toLowerCase());
}

export function isBlockedSignalAddress(address: string): boolean {
  try {
    const normalized = normalizeSignalIp(address);
    if (isCloudMetadataAddress(normalized.address) || isCloudMetadataAddress(address)) return true;
    return NON_GLOBAL.check(normalized.address, normalized.family === 4 ? "ipv4" : "ipv6");
  } catch {
    return true;
  }
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa") || host.endsWith(".internal")) return true;
  if (isCloudMetadataHostname(host)) return true;
  if (isIP(host)) return isBlockedSignalAddress(host);
  return false;
}

export interface PinnedSignalTarget {
  url: URL;
  address: string;
  family: 4 | 6;
  isPrivate: boolean;
  agent: Agent;
}

export function createPinnedAgent(address: string, family: 4 | 6): Agent {
  return new Agent({
    connect: {
      lookup(_hostname, _options, callback) {
        callback(null, address, family);
      }
    }
  });
}

/**
 * Resolve, validate, and pin a feed target. Metadata hosts/addresses are always forbidden.
 * `allowPrivate` only permits ordinary LAN/non-global ranges for operator-chosen or private-origin hops.
 */
export async function resolveValidateAndPin(url: URL, options: { allowPrivate: boolean }): Promise<PinnedSignalTarget> {
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
    try {
      addresses = await signalDnsLookup(host);
    } catch {
      throw new Error("Feed host could not be resolved.");
    }
  }
  if (!addresses.length) throw new Error("Feed host could not be resolved.");

  const normalized = addresses.map((address) => normalizeSignalIp(address));
  if (addresses.some((address) => isCloudMetadataAddress(address)) || normalized.some((row) => isCloudMetadataAddress(row.address))) {
    throw new Error("Feed host is not allowed.");
  }

  const privateFlags = normalized.map((row) => NON_GLOBAL.check(row.address, row.family === 4 ? "ipv4" : "ipv6"));
  if (privateFlags.some(Boolean) && privateFlags.some((flag) => !flag)) {
    throw new Error("Feed host resolved to mixed public and private addresses.");
  }
  const isPrivate = privateFlags.every(Boolean);
  if (isPrivate && !options.allowPrivate) throw new Error("Feed redirect target is not allowed.");

  const pinned = normalized[0];
  return {
    url,
    address: pinned.address,
    family: pinned.family,
    isPrivate,
    agent: createPinnedAgent(pinned.address, pinned.family)
  };
}

/** Fail closed using a real XML validator with entity processing disabled. */
export function assertWellFormedFeedXml(xml: string): void {
  if (!xml || !xml.trim()) throw new Error("Feed body is empty.");
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new Error("Feed XML with DTD or entity declarations is not allowed.");
  }
  const validated = XMLValidator.validate(xml, { allowBooleanAttributes: true });
  if (validated !== true) {
    const message = typeof validated === "object" && validated.err?.msg ? validated.err.msg : "Feed XML is not well-formed.";
    throw new Error(`Feed XML is not well-formed: ${message}`);
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    htmlEntities: false,
    allowBooleanAttributes: true
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
  state: { redirectCount: number; startedAt: number; deadlineMs: number; originPrivate: boolean | null; originProtocol: string }
): Promise<ParsedSignalFeed> {
  const remaining = state.deadlineMs - (Date.now() - state.startedAt);
  if (remaining <= 0) throw new Error("Feed fetch timed out.");
  if (state.redirectCount > MAX_SIGNAL_REDIRECTS) throw new Error("Feed redirected too many times.");
  const url = assertUnauthenticatedFeedUrl(feedUrl);
  if (state.redirectCount > 0 && state.originProtocol === "https:" && url.protocol === "http:") {
    throw new Error("Feed HTTPS to HTTP redirect downgrade is not allowed.");
  }
  // Every hop is validated (including the initial operator URL). Metadata is always
  // forbidden. Private LAN is allowed for the initial URL and for redirects that stay
  // within a private origin; public origins cannot pivot into private space.
  const allowPrivate = state.redirectCount === 0 ? true : state.originPrivate === true;
  const pinned = await resolveValidateAndPin(url, { allowPrivate });
  const originPrivate = state.redirectCount === 0 ? pinned.isPrivate : Boolean(state.originPrivate);
  try {
    const response = await signalFetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(remaining),
      headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.2" },
      dispatcher: pinned.agent
    }) as unknown as Response;
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Feed redirect did not include a location.");
      const next = new URL(location, url);
      return fetchTrustedSignalFeedHop(next.toString(), {
        redirectCount: state.redirectCount + 1,
        startedAt: state.startedAt,
        deadlineMs: state.deadlineMs,
        originPrivate,
        originProtocol: state.originProtocol
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
    originProtocol: url.protocol
  });
}
