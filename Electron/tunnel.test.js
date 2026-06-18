const assert = require("node:assert/strict");
const test = require("node:test");
const { extractTunnelUrl, createTunnelManager } = require("./tunnel");

test("extracts the trycloudflare URL from cloudflared output", () => {
  const line = "2026-06-18T09:10:00Z INF +--------------------------------------------------------+\n" +
    "Your quick Tunnel has been created! Visit it at:\n" +
    "https://calm-river-1234.trycloudflare.com\n";
  assert.equal(extractTunnelUrl(line), "https://calm-river-1234.trycloudflare.com");
});

test("returns null when no tunnel URL is present", () => {
  assert.equal(extractTunnelUrl("INF Starting tunnel...\n"), null);
});

test("start resolves with the URL parsed from cloudflared output and stop kills the process", async () => {
  const { EventEmitter } = require("node:events");
  let killed = false;
  const fakeProc = new EventEmitter();
  fakeProc.stdout = new EventEmitter();
  fakeProc.stderr = new EventEmitter();
  fakeProc.kill = () => { killed = true; fakeProc.killed = true; };
  const manager = createTunnelManager({
    binDir: "unused",
    ensure: async () => "cloudflared",
    spawnImpl: () => { setImmediate(() => fakeProc.stderr.emit("data", Buffer.from("Visit it at: https://swift-bird-42.trycloudflare.com\n"))); return fakeProc; }
  });
  const started = manager.start("http://127.0.0.1:5055", { timeoutMs: 2000 });
  assert.equal(await started, "https://swift-bird-42.trycloudflare.com");
  assert.equal(manager.running(), true);
  await manager.stop();
  assert.equal(killed, true);
  assert.equal(manager.running(), false);
});
