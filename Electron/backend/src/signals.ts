import { createHash } from "node:crypto";

export const MAX_SIGNAL_BYTES = 1024 * 1024;
const MAX_ITEMS = 100;

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

export function parseTrustedSignalFeed(xml: string, feedUrl: string): ParsedSignalFeed {
  const source = xml.replace(/<!--[\s\S]*?-->/g, "");
  const channel = source.match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i)?.[1] || source;
  const feedTitle = firstTag(channel, ["title"]) || new URL(feedUrl).hostname;
  const candidates = blocks(source, "item").length ? blocks(source, "item") : blocks(source, "entry");
  const items = candidates.slice(0, MAX_ITEMS).map((block): ParsedSignalItem => {
    const title = firstTag(block, ["title"]) || "Untitled";
    const url = firstLink(block);
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

async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      size += value.byteLength;
      if (size > MAX_SIGNAL_BYTES) throw new Error("Feed response exceeds the 1 MB limit.");
      chunks.push(value);
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchTrustedSignalFeed(feedUrl: string, redirectCount = 0): Promise<ParsedSignalFeed> {
  const url = validateFeedUrl(feedUrl);
  if (redirectCount > 3) throw new Error("Feed redirected too many times.");
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.2" } });
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
