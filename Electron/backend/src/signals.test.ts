import assert from "node:assert/strict";
import test from "node:test";
import { parseTrustedSignalFeed } from "./signals";

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
