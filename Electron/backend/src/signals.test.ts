import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedText,
  fetchTrustedSignalFeed,
  MAX_SIGNAL_BYTES,
  parseTrustedSignalFeed,
  redactSignalUrlSecrets,
  signalSubscriptionHealth,
  stripTrackingParams
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

test("parses RSS feeds as bounded trusted signal text", () => {
  const parsed = parseTrustedSignalFeed(`<?xml version="1.0"?>
    <rss><channel><title>Forge News</title><item><guid>one</guid><title>Release</title><link>https://example.com/release</link><pubDate>Mon, 15 Jun 2026 12:00:00 GMT</pubDate><description><![CDATA[<p>Ships <strong>today</strong>.</p><script>bad()</script>]]></description><dc:creator>Ada</dc:creator></item></channel></rss>`, "https://example.com/feed.xml");
  assert.equal(parsed.title, "Forge News");
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].external_id, "one");
  assert.equal(parsed.items[0].summary, "Ships today.");
  assert.equal(parsed.items[0].published_at, "2026-06-15T12:00:00.000Z");
});

test("parses Atom entries with href links", () => {
  const parsed = parseTrustedSignalFeed(`<feed><title>Signals</title><entry><id>tag:example,1</id><title>Atom item</title><link href="https://example.com/atom"/><updated>2026-06-15T13:00:00Z</updated><summary>Plain update</summary></entry></feed>`, "https://example.com/atom.xml");
  assert.equal(parsed.title, "Signals");
  assert.equal(parsed.items[0].url, "https://example.com/atom");
  assert.equal(parsed.items[0].external_id, "tag:example,1");
});

test("strips tracking parameters from item links", () => {
  const parsed = parseTrustedSignalFeed(`<rss><channel><title>Tracked</title><item><guid>t1</guid><title>Tracked item</title><link>https://example.com/post?utm_source=feed&amp;utm_campaign=x&amp;fbclid=abc&amp;keep=1</link><description>ok</description></item></channel></rss>`, "https://example.com/feed.xml");
  assert.equal(parsed.items[0].url, "https://example.com/post?keep=1");
  assert.equal(stripTrackingParams("https://example.com/a?gclid=1&id=2"), "https://example.com/a?id=2");
});

test("rejects malformed non-feed bodies and reports empty feeds", () => {
  assert.throws(() => parseTrustedSignalFeed("<html><body>not a feed</body></html>", "https://example.com/bad"), /not readable RSS or Atom/i);
  assert.throws(() => parseTrustedSignalFeed("", "https://example.com/empty"), /empty/i);
  const empty = parseTrustedSignalFeed("<rss><channel><title>Empty</title></channel></rss>", "https://example.com/empty");
  assert.equal(empty.items.length, 0);
});

test("redacts credential-like URL material for export", () => {
  assert.equal(
    redactSignalUrlSecrets("https://user:pass@example.com/feed.xml?api_key=secret&token=abc&keep=1"),
    "https://REDACTED:REDACTED@example.com/feed.xml?api_key=REDACTED&token=REDACTED&keep=1"
  );
});

test("classifies signal subscription health including stale", () => {
  const now = Date.parse("2026-07-20T12:00:00.000Z");
  assert.equal(signalSubscriptionHealth({ enabled: false, last_fetch_at: null, last_fetch_status: "never", fetch_interval_minutes: 60, now }).state, "paused");
  assert.equal(signalSubscriptionHealth({ enabled: true, last_fetch_at: null, last_fetch_status: "never", fetch_interval_minutes: 60, now }).state, "never_fetched");
  assert.equal(signalSubscriptionHealth({ enabled: true, last_fetch_at: "2026-07-20T11:00:00.000Z", last_fetch_status: "failed", fetch_interval_minutes: 60, now }).state, "failed");
  assert.equal(signalSubscriptionHealth({ enabled: true, last_fetch_at: "2026-07-20T11:30:00.000Z", last_fetch_status: "ok", fetch_interval_minutes: 60, now }).state, "ok");
  assert.equal(signalSubscriptionHealth({ enabled: true, last_fetch_at: "2026-07-20T09:00:00.000Z", last_fetch_status: "ok", fetch_interval_minutes: 60, now }).state, "stale");
});

test("fetchTrustedSignalFeed follows bounded redirects and rejects oversized bodies", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    const href = String(input);
    if (href.endsWith("/start")) {
      return new Response(null, { status: 302, headers: { location: "https://example.com/final.xml" } });
    }
    if (href.endsWith("/final.xml")) {
      const body = `<rss><channel><title>Redirected</title><item><guid>r1</guid><title>After redirect</title><link>https://example.com/item</link><description>ok</description></item></channel></rss>`;
      return new Response(body, { status: 200, headers: { "content-type": "application/rss+xml" } });
    }
    if (href.endsWith("/huge")) {
      return oversizedBody(MAX_SIGNAL_BYTES + 1024);
    }
    if (href.endsWith("/loop")) {
      return new Response(null, { status: 302, headers: { location: "https://example.com/loop" } });
    }
    return new Response("missing", { status: 404 });
  }) as typeof fetch;
  try {
    const parsed = await fetchTrustedSignalFeed("https://example.com/start");
    assert.equal(parsed.title, "Redirected");
    assert.equal(parsed.items[0].title, "After redirect");
    assert.equal(calls, 2);
    await assert.rejects(() => fetchTrustedSignalFeed("https://example.com/huge"), /1 MB limit/i);
    await assert.rejects(() => fetchTrustedSignalFeed("https://example.com/loop"), /redirected too many times/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("boundedText enforces the byte cap", async () => {
  await assert.rejects(() => boundedText(oversizedBody(MAX_SIGNAL_BYTES + 1)), /1 MB limit/i);
});
