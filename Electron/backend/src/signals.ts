import { createHash } from "node:crypto";
import { lookup as dnsLookupAll } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_SIGNAL_BYTES = 1024 * 1024;
export const MAX_SIGNAL_REDIRECTS = 3;
export const SIGNAL_FETCH_TIMEOUT_MS = 8000;
/** A source is stale when last successful/attempted fetch is older than this multiple of its interval. */
export const SIGNAL_STALE_MULTIPLIER = 2;
const MAX_ITEMS = 100;

const TRACKING_QUERY_KEYS = /^(utm_[^=]*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|vero_id|_ga|yclid)$/i;
export const SECRET_QUERY_KEYS = /^(api[_-]?key|token|access[_-]?token|auth|authorization|password|passwd|secret|session|sid|key)$/i;
const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata", "kubernetes.default", "kubernetes.default.svc"]);

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

let signalDnsLookup: SignalDnsLookup = async (hostname) => {
  const results = await dnsLookupAll(hostname, { all: true, verbatim: true });
  return results.map((row) => row.address);
};

/** Test seam for redirect/SSRF fixtures. Pass null to restore the default resolver. */
export function setSignalDnsLookupForTests(lookup: SignalDnsLookup | null): void {
  signalDnsLookup = lookup ?? (async (hostname) => {
    const results = await dnsLookupAll(hostname, { all: true, verbatim: true });
    return results.map((row) => row.address);
  });
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

function fingerprint(...parts: string[]): string {
  return createHash("sha256").update(parts.filter(Boolean).join("\n")).digest("hex");
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
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

/** Remove userinfo and credential-like query parameters from a URL (item links / scrub). */
export function stripCredentialMaterial(value: string): string {
  if (!value) return value;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY_KEYS.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}

export function sanitizeItemUrl(value: string): string {
  return stripCredentialMaterial(stripTrackingParams(value)).slice(0, 1000);
}

export function urlContainsCredentialMaterial(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return true;
    for (const key of url.searchParams.keys()) {
      if (SECRET_QUERY_KEYS.test(key)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Reject subscription URLs that embed HTTP credentials or credential-like query
 * parameters. Authenticated feeds require a future secure-settings path.
 */
export function assertUnauthenticatedFeedUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Feed URL is invalid.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Feed URL must use http or https.");
  if (url.username || url.password) {
    throw new Error("Feed URL must not include username/password. Authenticated feeds are not supported yet.");
  }
  for (const key of url.searchParams.keys()) {
    if (SECRET_QUERY_KEYS.test(key)) {
      throw new Error("Feed URL must not include credential-like query parameters. Authenticated feeds are not supported yet.");
    }
  }
  return url;
}

/**
 * Redact URL userinfo and credential-like query parameters for export/diagnostics/API DTOs.
 */
export function redactSignalUrlSecrets(value: string): string {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (url.username) url.username = "REDACTED";
    if (url.password) url.password = "REDACTED";
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY_KEYS.test(key)) url.searchParams.set(key, "REDACTED");
    }
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

/** Redact URL-shaped external ids so export never carries credential-bearing identity strings. */
export function redactExportExternalId(value: string): string {
  if (!value) return value;
  if (!looksLikeUrl(value) && !value.includes("@") && !SECRET_QUERY_KEYS.test(value.split(/[?&=]/)[0] || "")) {
    if (!/[?&](api[_-]?key|token|password|secret)=/i.test(value) && !/\/\/[^/\s]+@/.test(value)) return value;
  }
  if (looksLikeUrl(value) || /\/\/[^/\s]+@/.test(value) || /[?&](api[_-]?key|token|password|secret|auth)=/i.test(value)) {
    return `sha256:${fingerprint("external_id", value)}`;
  }
  return value;
}

/** Sanitize operator-visible / persisted fetch errors so URLs and secrets never leak. */
export function sanitizeSignalError(message: string): string {
  if (!message) return "";
  let out = String(message);
  out = out.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => redactSignalUrlSecrets(match));
  out = out.replace(/\b[^\s/:@]+:[^\s/@]+@/g, "REDACTED:REDACTED@");
  out = out.replace(/([?&](?:api[_-]?key|token|access[_-]?token|auth|password|secret|session|sid|key)=)[^&\s"']+/gi, "$1REDACTED");
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

function isIpv4Blocked(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true; // unspecified
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isIpv6Blocked(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("ff")) return true; // multicast
  // IPv4-mapped
  const mapped = normalized.match(/^:ffff:(\d+\.\d+\.\d+\.\d+)$/i) || normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isIpv4Blocked(mapped[1]);
  return false;
}

export function isCloudMetadataAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === "169.254.169.254" || normalized === "fd00:ec2::254" || normalized.endsWith(":169.254.169.254");
}

export function isBlockedSignalAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isIpv4Blocked(address);
  if (family === 6) return isIpv6Blocked(address);
  return true;
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (METADATA_HOSTS.has(host)) return true;
  if (isIP(host)) return isBlockedSignalAddress(host);
  return false;
}

async function assertFetchTargetAllowed(url: URL, options: { allowPrivate: boolean }): Promise<void> {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Feed URL must use http or https.");
  if (url.username || url.password) throw new Error("Feed URL must not include username/password.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (METADATA_HOSTS.has(host.toLowerCase())) throw new Error("Feed host is not allowed.");
  if (isIP(host)) {
    if (isCloudMetadataAddress(host)) throw new Error("Feed host is not allowed.");
    if (isBlockedSignalAddress(host) && !options.allowPrivate) throw new Error("Feed redirect target is not allowed.");
    return;
  }
  if (isPrivateOrLocalHostname(host) && !options.allowPrivate) throw new Error("Feed redirect target is not allowed.");
  let addresses: string[];
  try {
    addresses = await signalDnsLookup(host);
  } catch {
    throw new Error("Feed host could not be resolved.");
  }
  if (!addresses.length) throw new Error("Feed host could not be resolved.");
  if (addresses.some((address) => isCloudMetadataAddress(address))) throw new Error("Feed host is not allowed.");
  const blocked = addresses.filter((address) => isBlockedSignalAddress(address));
  if (blocked.length && !options.allowPrivate) throw new Error("Feed redirect target is not allowed.");
  if (blocked.length && blocked.length < addresses.length) {
    // Mixed public/private answers: refuse rather than race.
    throw new Error("Feed host resolved to mixed public and private addresses.");
  }
}

/**
 * Fail closed on DTD/entity declarations and documents that are not well-formed element XML.
 * This is a bounded structural check, not a full XML infoset implementation.
 */
export function assertWellFormedFeedXml(xml: string): void {
  if (!xml || !xml.trim()) throw new Error("Feed body is empty.");
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new Error("Feed XML with DTD or entity declarations is not allowed.");
  }
  // Strip comments and CDATA so tag scanning does not see their contents.
  const source = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ");
  if (/<[!?]/.test(source.replace(/<\?xml\b[^?]*\?>/gi, ""))) {
    throw new Error("Feed XML contains unsupported declarations.");
  }
  const stack: string[] = [];
  const token = /<\/?([A-Za-z_][\w:.-]*)\b[^>]*?(\/?)\>/g;
  let match: RegExpExecArray | null;
  let sawElement = false;
  while ((match = token.exec(source))) {
    const full = match[0];
    const name = match[1].toLowerCase();
    const selfClosing = match[2] === "/" || /\/\s*>$/.test(full);
    if (full.startsWith("</")) {
      if (!stack.length) throw new Error("Feed XML has a mismatched closing tag.");
      const expected = stack.pop();
      if (expected !== name) throw new Error("Feed XML has mismatched element nesting.");
      continue;
    }
    sawElement = true;
    if (!selfClosing) stack.push(name);
  }
  if (!sawElement) throw new Error("Feed body is not readable RSS or Atom XML.");
  if (stack.length) throw new Error("Feed XML is truncated or not well-formed.");
  if (!/<(rss|feed|rdf:rdf)\b/i.test(source)) throw new Error("Feed body is not readable RSS or Atom XML.");
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
    let external_id: string;
    if (rawExternal && !looksLikeUrl(rawExternal) && !urlContainsCredentialMaterial(rawExternal)) {
      external_id = rawExternal;
    } else if (rawExternal) {
      // GUID/id that is URL-shaped or credential-bearing must never be stored verbatim.
      external_id = fingerprint("guid", rawExternal);
    } else if (url) {
      external_id = fingerprint("url", url);
    } else {
      external_id = fingerprint(feedUrl, title, firstTag(block, ["description", "summary"]));
    }
    const summary = firstTag(block, ["description", "summary", "content", "content:encoded"]).slice(0, 1200);
    const author = firstTag(block, ["author", "dc:creator", "name"]).slice(0, 160);
    return {
      external_id: external_id.slice(0, 1000),
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
  state: { redirectCount: number; startedAt: number; deadlineMs: number; originPrivate: boolean; originProtocol: string }
): Promise<ParsedSignalFeed> {
  const remaining = state.deadlineMs - (Date.now() - state.startedAt);
  if (remaining <= 0) throw new Error("Feed fetch timed out.");
  if (state.redirectCount > MAX_SIGNAL_REDIRECTS) throw new Error("Feed redirected too many times.");
  const url = assertUnauthenticatedFeedUrl(feedUrl);
  // Initial operator URL may be LAN/private; redirect hops may not pivot public → private.
  const allowPrivate = state.redirectCount === 0 ? true : state.originPrivate;
  if (state.redirectCount > 0) {
    if (state.originProtocol === "https:" && url.protocol === "http:") {
      throw new Error("Feed HTTPS to HTTP redirect downgrade is not allowed.");
    }
    await assertFetchTargetAllowed(url, { allowPrivate });
  } else if (!state.originPrivate) {
    // Public initial hosts still must not resolve exclusively to blocked addresses unless operator used a private literal/host.
    await assertFetchTargetAllowed(url, { allowPrivate: false });
  }

  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(remaining),
    headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.2" }
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Feed redirect did not include a location.");
    const next = new URL(location, url);
    return fetchTrustedSignalFeedHop(next.toString(), {
      ...state,
      redirectCount: state.redirectCount + 1
    });
  }
  if (!response.ok) throw new Error(`Feed fetch failed (${response.status}).`);
  const type = response.headers.get("content-type") || "";
  if (type && !/(xml|rss|atom|text\/plain|application\/octet-stream)/i.test(type)) throw new Error(`Unsupported feed content type: ${type.split(";")[0]}.`);
  const parsed = parseTrustedSignalFeed(await boundedText(response), url.toString());
  if (!parsed.items.length) throw new Error("Feed did not contain readable RSS or Atom items.");
  return parsed;
}

export async function fetchTrustedSignalFeed(feedUrl: string): Promise<ParsedSignalFeed> {
  const url = assertUnauthenticatedFeedUrl(feedUrl);
  const originPrivate = isPrivateOrLocalHostname(url.hostname);
  return fetchTrustedSignalFeedHop(feedUrl, {
    redirectCount: 0,
    startedAt: Date.now(),
    deadlineMs: SIGNAL_FETCH_TIMEOUT_MS,
    originPrivate,
    originProtocol: url.protocol
  });
}
