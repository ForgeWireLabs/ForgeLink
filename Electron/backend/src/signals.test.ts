import assert from "node:assert/strict";
import test from "node:test";
import {
  assertUnauthenticatedFeedUrl,
  assertWellFormedFeedXml,
  boundedText,
  canonicalExternalId,
  containsCredentialMaterial,
  createPinnedAgent,
  fetchTrustedSignalFeed,
  isBlockedSignalAddress,
  MAX_SIGNAL_BYTES,
  parseTrustedSignalFeed,
  redactExportExternalId,
  redactSignalUrlSecrets,
  resolveValidateAndPin,
  sanitizeSignalError,
  setSignalDnsLookupForTests,
  setSignalFetchForTests,
  signalSubscriptionHealth,
  stripTrackingParams,
  toSignalSubscriptionDto
} from "./signals";

function oversizedBody(bytes: number): Response {
  let remaining = bytes;
  const stream = {
    getReader() {
      return {
        async read() {
          if (remaining <= 0) return { done: true as const, value: undefined };
          const size = Math.min(256 * 1024, remaining);
          remaining -= size;
          return { done: false as const, value: new Uint8Array(size) };
        }
      };
    }
  };
  return { body: stream, headers: new Headers({ "content-type": "application/xml" }), ok: true, status: 200 } as unknown as Response;
}

const SAMPLE_FEED = `<rss><channel><title>Redirected</title><item><guid>r1</guid><title>After redirect</title><link>https://example.com/item</link><description>ok</description></item></channel></rss>`;

test("parses RSS feeds as bounded trusted signal text", () => {
  const parsed = parseTrustedSignalFeed(`<?xml version="1.0"?>
    <rss><channel><title>Forge News</title><item><guid>one</guid><title>Release</title><link>https://example.com/release</link><pubDate>Mon, 15 Jun 2026 12:00:00 GMT</pubDate><description><![CDATA[<p>Ships <strong>today</strong>.</p><script>bad()</script>]]></description><dc:creator>Ada</dc:creator></item></channel></rss>`, "https://example.com/feed.xml");
  assert.equal(parsed.title, "Forge News");
  assert.equal(parsed.items[0].external_id, "one");
  assert.equal(parsed.items[0].summary, "Ships today.");
});

test("parses Atom entries with href links", () => {
  const parsed = parseTrustedSignalFeed(`<?xml version="1.0"?><feed><title>Signals</title><entry><id>tag:example,1</id><title>Atom item</title><link href="https://example.com/atom"/><updated>2026-06-15T13:00:00Z</updated><summary>Plain update</summary></entry></feed>`, "https://example.com/atom.xml");
  assert.equal(parsed.items[0].url, "https://example.com/atom");
  assert.equal(parsed.items[0].external_id, "tag:example,1");
});

test("strips tracking and credential query params from item links", () => {
  const parsed = parseTrustedSignalFeed(`<?xml version="1.0"?><rss><channel><title>Tracked</title><item><guid>t1</guid><title>Tracked item</title><link>https://example.com/post?utm_source=feed&amp;token=secret&amp;keep=1</link><description>ok</description></item></channel></rss>`, "https://example.com/feed.xml");
  assert.equal(parsed.items[0].url, "https://example.com/post?keep=1");
  assert.equal(stripTrackingParams("https://example.com/a?gclid=1&id=2"), "https://example.com/a?id=2");
});

test("hashes URL fallback and suspicious external ids", () => {
  const parsed = parseTrustedSignalFeed(`<?xml version="1.0"?><rss><channel><title>No Guid</title><item><title>Leaky</title><link>https://user:pass@example.com/item?token=abc&amp;keep=1</link><description>body</description></item></channel></rss>`, "https://example.com/feed.xml");
  assert.equal(parsed.items[0].external_id, canonicalExternalId({ sanitizedUrl: "https://example.com/item?keep=1" }));
  assert.equal(containsCredentialMaterial("token=abc"), true);
  assert.equal(redactExportExternalId("token=abc").startsWith("sha256:"), true);
  assert.equal(redactExportExternalId("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig").startsWith("sha256:"), true);
});

test("rejects broad credential-bearing subscription URLs including fragments", () => {
  for (const url of [
    "https://example.com/feed?client_secret=value",
    "https://example.com/feed?x-api-key=value",
    "https://example.com/feed?sig=value",
    "https://example.com/feed?x-amz-security-token=value",
    "https://example.com/feed#access_token=value",
    "https://user:pass@example.com/feed.xml"
  ]) {
    assert.throws(() => assertUnauthenticatedFeedUrl(url), /credential|username|fragment/i);
  }
  assert.equal(assertUnauthenticatedFeedUrl("https://example.com/feed.xml?keep=1").toString(), "https://example.com/feed.xml?keep=1");
});

test("XML validator rejects malformed, multi-root, case-mismatched, and entity documents", () => {
  assert.throws(() => parseTrustedSignalFeed("<html><body>not a feed</body></html>", "https://example.com/bad"), /not readable|well-formed/i);
  assert.throws(() => assertWellFormedFeedXml(`<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel></channel></rss>`), /DTD|entity/i);
  assert.throws(() => parseTrustedSignalFeed(`<rss><channel><item><title>Truncated</title>`, "https://example.com/trunc"), /well-formed/i);
  assert.throws(() => parseTrustedSignalFeed(`<rss><channel></rss>`, "https://example.com/mismatch"), /well-formed/i);
  assert.throws(() => assertWellFormedFeedXml(`<rss><channel></channel></rss><feed></feed>`), /well-formed|Multiple possible root|single RSS or Atom root/i);
  assert.throws(() => assertWellFormedFeedXml(`<rss><channel><Title>x</title></channel></rss>`), /well-formed/i);
  assert.throws(() => assertWellFormedFeedXml(`<rss><channel><title>a & b</title></channel></rss>`), /well-formed/i);
  const empty = parseTrustedSignalFeed("<?xml version=\"1.0\"?><rss><channel><title>Empty</title></channel></rss>", "https://example.com/empty");
  assert.equal(empty.items.length, 0);
});

test("classifies non-global IPv6 link-local /10 and hex-mapped loopback", () => {
  assert.equal(isBlockedSignalAddress("fe80::1"), true);
  assert.equal(isBlockedSignalAddress("fe90::1"), true);
  assert.equal(isBlockedSignalAddress("feb0::1"), true);
  assert.equal(isBlockedSignalAddress("::ffff:7f00:1"), true);
  assert.equal(isBlockedSignalAddress("8.8.8.8"), false);
});

test("resolveValidateAndPin pins the validated DNS address and classifies LAN hosts", async () => {
  setSignalDnsLookupForTests(async (hostname) => {
    if (hostname === "nas.lan") return ["192.168.1.50"];
    if (hostname === "example.com") return ["93.184.216.34"];
    return ["93.184.216.34"];
  });
  try {
    const lan = await resolveValidateAndPin(new URL("http://nas.lan/feed.xml"), { allowPrivate: true });
    assert.equal(lan.address, "192.168.1.50");
    assert.equal(lan.isPrivate, true);
    await lan.agent.close();
    const pub = await resolveValidateAndPin(new URL("https://example.com/feed.xml"), { allowPrivate: false });
    assert.equal(pub.address, "93.184.216.34");
    assert.equal(pub.isPrivate, false);
    await pub.agent.close();
    assert.equal(createPinnedAgent("93.184.216.34", 4) instanceof Object, true);
  } finally {
    setSignalDnsLookupForTests(null);
  }
});

test("direct metadata and private-pivot targets are rejected; LAN DNS origins are allowed", async () => {
  setSignalDnsLookupForTests(async (hostname) => {
    if (hostname === "nas.lan" || hostname === "feed.home.arpa") return ["192.168.1.50"];
    if (hostname === "example.com" || hostname === "cdn.example.com") return ["93.184.216.34"];
    if (hostname === "evil.example.com") return ["127.0.0.1"];
    if (hostname === "meta.example.com") return ["169.254.169.254"];
    return ["93.184.216.34"];
  });
  setSignalFetchForTests(async (input) => {
    const href = String(input);
    if (href.includes("192.168.1.50") || href.includes("nas.lan") || href.includes("feed.home.arpa")) {
      return new Response(SAMPLE_FEED, { status: 200, headers: { "content-type": "application/rss+xml" } }) as unknown as Response;
    }
    if (href.endsWith("/start")) return new Response(null, { status: 302, headers: { location: "https://cdn.example.com/final.xml" } }) as unknown as Response;
    if (href.includes("cdn.example.com/final.xml")) return new Response(SAMPLE_FEED, { status: 200, headers: { "content-type": "application/rss+xml" } }) as unknown as Response;
    if (href.endsWith("/to-private")) return new Response(null, { status: 302, headers: { location: "https://evil.example.com/secret" } }) as unknown as Response;
    if (href.endsWith("/to-http")) return new Response(null, { status: 302, headers: { location: "http://example.com/final.xml" } }) as unknown as Response;
    if (href.endsWith("/huge")) return oversizedBody(MAX_SIGNAL_BYTES + 1024);
    if (href.endsWith("/loop")) return new Response(null, { status: 302, headers: { location: "https://example.com/loop" } }) as unknown as Response;
    return new Response("missing", { status: 404 }) as unknown as Response;
  });
  try {
    await assert.rejects(() => fetchTrustedSignalFeed("http://169.254.169.254/latest/meta-data/"), /not allowed/i);
    await assert.rejects(() => fetchTrustedSignalFeed("http://metadata.google.internal/"), /not allowed/i);
    await assert.rejects(() => resolveValidateAndPin(new URL("http://[fd00:ec2::254]/"), { allowPrivate: true }), /not allowed/i);
    const lan = await fetchTrustedSignalFeed("http://nas.lan/feed.xml");
    assert.equal(lan.title, "Redirected");
    const home = await fetchTrustedSignalFeed("http://feed.home.arpa/feed.xml");
    assert.equal(home.items.length, 1);
    const redirected = await fetchTrustedSignalFeed("https://example.com/start");
    assert.equal(redirected.title, "Redirected");
    await assert.rejects(() => fetchTrustedSignalFeed("https://example.com/to-private"), /not allowed/i);
    await assert.rejects(() => fetchTrustedSignalFeed("https://example.com/to-http"), /downgrade/i);
    await assert.rejects(() => fetchTrustedSignalFeed("https://example.com/huge"), /1 MB limit/i);
    await assert.rejects(() => fetchTrustedSignalFeed("https://example.com/loop"), /redirected too many times/i);
  } finally {
    setSignalDnsLookupForTests(null);
    setSignalFetchForTests(null);
  }
});

test("redacts credential material for export and errors", () => {
  assert.match(redactSignalUrlSecrets("https://user:pass@example.com/feed.xml?client_secret=x"), /REDACTED/);
  const dto = toSignalSubscriptionDto({ url: "https://example.com/feed.xml?token=abc", last_error: "Failed https://example.com/feed.xml?token=abc" });
  assert.equal(dto.url.includes("abc"), false);
  assert.equal(dto.last_error.includes("abc"), false);
  assert.match(sanitizeSignalError("boom at https://x:y@host/path?sig=z"), /REDACTED/);
});

test("classifies signal subscription health including stale", () => {
  const now = Date.parse("2026-07-20T12:00:00.000Z");
  assert.equal(signalSubscriptionHealth({ enabled: true, last_fetch_at: "2026-07-20T09:00:00.000Z", last_fetch_status: "ok", fetch_interval_minutes: 60, now }).state, "stale");
});

test("boundedText enforces the byte cap", async () => {
  await assert.rejects(() => boundedText(oversizedBody(MAX_SIGNAL_BYTES + 1)), /1 MB limit/i);
});
