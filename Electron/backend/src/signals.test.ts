import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  assertUnauthenticatedFeedUrl,
  assertWellFormedFeedXml,
  boundedText,
  canonicalExternalId,
  classifySignalAddress,
  containsCredentialMaterial,
  fetchTrustedSignalFeed,
  legacy19daExternalId,
  MAX_SIGNAL_BYTES,
  migrateStoredExternalId,
  parseTrustedSignalFeed,
  redactSignalUrlSecrets,
  resolveValidateAndPin,
  sanitizeSignalError,
  setSignalDnsLookupForTests,
  setSignalFetchForTests,
  withSignalDeadline
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

const SAMPLE_FEED = `<?xml version="1.0"?><rss><channel><title>Pinned</title><item><guid>r1</guid><title>Item</title><link>https://example.com/item</link><description>ok</description></item></channel></rss>`;

test("rejects credential values embedded in non-secret query parameters", () => {
  for (const url of [
    "https://example.com/feed?next=https%3A%2F%2Fuser%3Apass%40private.example%2Ffeed",
    "https://example.com/feed?opaque=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
    "https://example.com/feed?next=token%3Dsecret",
    "https://example.com/feed?client_secret=value",
    "https://example.com/feed#access_token=value"
  ]) {
    assert.equal(containsCredentialMaterial(url), true);
    assert.throws(() => assertUnauthenticatedFeedUrl(url), /credential|fragment/i);
  }
  const redacted = redactSignalUrlSecrets("https://example.com/feed?next=https%3A%2F%2Fuser%3Apass%40private.example%2Ffeed");
  assert.equal(redacted.includes("user:pass"), false);
  assert.match(redacted, /REDACTED/);
  assert.match(sanitizeSignalError("failed refresh_token=abc id_token=xyz bearer=tok passwd=p client_id=cid"), /REDACTED/);
  assert.equal(sanitizeSignalError("failed refresh_token=abc").includes("abc"), false);
});

test("classifies always-forbidden metadata and special-purpose ranges", () => {
  assert.equal(classifySignalAddress("169.254.169.254"), "forbidden");
  assert.equal(classifySignalAddress("169.254.170.2"), "forbidden");
  assert.equal(classifySignalAddress("100.100.100.200"), "forbidden");
  assert.equal(classifySignalAddress("fe90::1"), "forbidden");
  assert.equal(classifySignalAddress("192.168.1.1"), "lan");
  assert.equal(classifySignalAddress("198.18.0.1"), "special");
  assert.equal(classifySignalAddress("192.0.2.1"), "special");
  assert.equal(classifySignalAddress("198.51.100.1"), "special");
  assert.equal(classifySignalAddress("203.0.113.1"), "special");
  assert.equal(classifySignalAddress("2001:db8::1"), "special");
  assert.equal(classifySignalAddress("8.8.8.8"), "public");
});

test("direct forbidden endpoints are rejected even with allowPrivate", async () => {
  for (const target of [
    "http://169.254.170.2/v2/metadata",
    "http://100.100.100.200/latest/meta-data/",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/"
  ]) {
    await assert.rejects(() => resolveValidateAndPin(new URL(target), { allowPrivate: true, remainingMs: 1000 }), /not allowed/i);
    await assert.rejects(() => fetchTrustedSignalFeed(target), /not allowed/i);
  }
  await assert.rejects(() => resolveValidateAndPin(new URL("http://198.18.0.1/feed"), { allowPrivate: true, remainingMs: 1000 }), /not allowed/i);
});

test("XML validator rejects boolean attributes and malformed markup", () => {
  assert.throws(() => assertWellFormedFeedXml(`<rss malformed><channel></channel></rss>`), /well-formed/i);
  assert.throws(() => assertWellFormedFeedXml(`<rss><channel><Title>x</title></channel></rss>`), /well-formed/i);
  assert.throws(() => parseTrustedSignalFeed(`<rss><channel><item><title>Truncated</title>`, "https://example.com/x"), /well-formed/i);
});

test("DNS is bounded by the shared deadline", async () => {
  await assert.rejects(() => withSignalDeadline(new Promise(() => undefined), 20, "DNS"), /timed out/i);
  setSignalDnsLookupForTests(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return ["8.8.8.8"];
  });
  try {
    await assert.rejects(() => resolveValidateAndPin(new URL("https://slow.example/feed"), { allowPrivate: false, remainingMs: 10 }), /timed out/i);
  } finally {
    setSignalDnsLookupForTests(null);
  }
});

test("HTTPS to HTTP downgrade is rejected across intermediate hops", async () => {
  setSignalDnsLookupForTests(async () => ["93.184.216.34"]);
  setSignalFetchForTests(async (input) => {
    const href = String(input);
    if (href.includes("http-start")) return new Response(null, { status: 302, headers: { location: "https://example.com/mid" } }) as unknown as Response;
    if (href.includes("/mid")) return new Response(null, { status: 302, headers: { location: "http://example.com/final.xml" } }) as unknown as Response;
    return new Response("missing", { status: 404 }) as unknown as Response;
  });
  try {
    await assert.rejects(() => fetchTrustedSignalFeed("http://example.com/http-start"), /downgrade/i);
  } finally {
    setSignalDnsLookupForTests(null);
    setSignalFetchForTests(null);
  }
});

test("public to special-purpose redirect is rejected", async () => {
  setSignalDnsLookupForTests(async (hostname) => {
    if (hostname === "example.com") return ["93.184.216.34"];
    if (hostname === "bench.example.com") return ["198.18.0.1"];
    return ["93.184.216.34"];
  });
  setSignalFetchForTests(async (input) => {
    if (String(input).includes("/to-bench")) return new Response(null, { status: 302, headers: { location: "https://bench.example.com/feed" } }) as unknown as Response;
    return new Response("missing", { status: 404 }) as unknown as Response;
  });
  try {
    await assert.rejects(() => fetchTrustedSignalFeed("https://example.com/to-bench"), /not allowed/i);
  } finally {
    setSignalDnsLookupForTests(null);
    setSignalFetchForTests(null);
  }
});

test("pin-on-connect uses validated address while preserving Host", async () => {
  let seenHost = "";
  const server = createServer((request, response) => {
    seenHost = String(request.headers.host || "");
    response.writeHead(200, { "Content-Type": "application/rss+xml" });
    response.end(SAMPLE_FEED);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  setSignalDnsLookupForTests(async (hostname) => {
    assert.equal(hostname, "feed.test.local");
    return ["127.0.0.1"];
  });
  setSignalFetchForTests(null); // real undici
  try {
    const parsed = await fetchTrustedSignalFeed(`http://feed.test.local:${port}/feed.xml`);
    assert.equal(parsed.title, "Pinned");
    assert.equal(seenHost, `feed.test.local:${port}`);
  } finally {
    setSignalDnsLookupForTests(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("migrates 19da legacy hashes to canonical URL identities", () => {
  const raw = "https://example.com/post?utm_source=x&keep=1";
  const sanitized = "https://example.com/post?keep=1";
  const legacy = legacy19daExternalId(raw);
  assert.equal(migrateStoredExternalId({ external_id: legacy, url: raw }), canonicalExternalId({ sanitizedUrl: sanitized }));
  assert.equal(
    migrateStoredExternalId({ external_id: "https://example.com/guid-as-id", url: "https://example.com/different-link" }),
    canonicalExternalId({ rawGuid: "https://example.com/guid-as-id" })
  );
});

test("parses RSS and hashes URL fallbacks", () => {
  const parsed = parseTrustedSignalFeed(`<?xml version="1.0"?><rss><channel><title>T</title><item><title>No guid</title><link>https://example.com/a?utm_source=x&amp;keep=1</link><description>b</description></item></channel></rss>`, "https://example.com/feed.xml");
  assert.equal(parsed.items[0].external_id, canonicalExternalId({ sanitizedUrl: "https://example.com/a?keep=1" }));
});

test("boundedText enforces the byte cap", async () => {
  await assert.rejects(() => boundedText(oversizedBody(MAX_SIGNAL_BYTES + 1)), /1 MB limit/i);
});
