import { createHash } from "node:crypto";

export const MAX_SIGNAL_BYTES = 1024 * 1024;
export const MAX_SIGNAL_REDIRECTS = 3;
export const SIGNAL_FETCH_TIMEOUT_MS = 8000;
/** A source is stale when last successful/attempted fetch is older than this multiple of its interval. */
export const SIGNAL_STALE_MULTIPLIER = 2;
const MAX_ITEMS = 100;

const TRACKING_QUERY_KEYS = /^(utm_[^=]*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|vero_id|_ga|yclid)$/i;
const SECRET_QUERY_KEYS = /^(api[_-]?key|token|access[_-]?token|auth|authorization|password|passwd|secret|session|sid|key)$/i;

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

/**
 * Redact URL userinfo and credential-like query parameters for export/diagnostics.
 * Does not invent authenticated-feed support; only prevents accidental leakage of
 * URL tokens that operators may have pasted into a subscription URL.
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

export function parseTrustedSignalFeed(xml: string, feedUrl: string): ParsedSignalFeed {
  if (!xml || !xml.trim()) throw new Error("Feed body is empty.");
  const source = xml.replace(/<!--[\s\S]*?-->/g, "");
  const looksLikeFeed = /<(rss|feed|rdf:RDF)\b/i.test(source) || /<(item|entry)\b/i.test(source);
  if (!looksLikeFeed) throw new Error("Feed body is not readable RSS or Atom XML.");
  const channel = source.match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i)?.[1] || source;
  const feedTitle = firstTag(channel, ["title"]) || new URL(feedUrl).hostname;
  const candidates = blocks(source, "item").length ? blocks(source, "item") : blocks(source, "entry");
  const items = candidates.slice(0, MAX_ITEMS).map((block): ParsedSignalItem => {
    const title = firstTag(block, ["title"]) || "Untitled";
    const url = stripTrackingParams(firstLink(block));
    const external = firstTag(block, ["guid", "id"]) || url || title;
    const summary = firstTag(block, ["description", "summary", "content", "content:encoded"]).slice(0, 1200);
    const author = firstTag(block, ["author", "dc:creator", "name"]).slice(0, 160);
    return {
      external_id: external || fingerprint(feedUrl, title, summary),
      title: title.slice(0, 240),
      url: url.slice(0, 1000),
      summary,
      author,
      published_at: normalizeIso(firstTag(block, ["pubDate", "published", "updated"]))
    };
  }).filter((item) => item.title || item.url);
  return { title: feedTitle.slice(0, 160), items };
}

function validateFeedUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Feed URL must use http or https.");
  return url;
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

export async function fetchTrustedSignalFeed(feedUrl: string, redirectCount = 0): Promise<ParsedSignalFeed> {
  const url = validateFeedUrl(feedUrl);
  if (redirectCount > MAX_SIGNAL_REDIRECTS) throw new Error("Feed redirected too many times.");
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(SIGNAL_FETCH_TIMEOUT_MS),
    headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.2" }
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Feed redirect did not include a location.");
    return fetchTrustedSignalFeed(new URL(location, url).toString(), redirectCount + 1);
  }
  if (!response.ok) throw new Error(`Feed fetch failed (${response.status}).`);
  const type = response.headers.get("content-type") || "";
  if (type && !/(xml|rss|atom|text\/plain|application\/octet-stream)/i.test(type)) throw new Error(`Unsupported feed content type: ${type.split(";")[0]}.`);
  const parsed = parseTrustedSignalFeed(await boundedText(response), url.toString());
  if (!parsed.items.length) throw new Error("Feed did not contain readable RSS or Atom items.");
  return parsed;
}
