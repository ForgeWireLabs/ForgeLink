// Automatic public webhook via a cloudflared quick-tunnel (work item 014).
//
// cloudflared is resolved from a bundled resource when present, otherwise it is
// downloaded once into the Electron user-data dir and cached. The quick-tunnel
// forwards a public https://*.trycloudflare.com URL to the loopback service so
// Twilio can deliver inbound SMS without the user configuring anything. Quick
// tunnels are ephemeral, so the URL is re-provisioned on each start.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const CLOUDFLARED_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

// Pure: pull the first trycloudflare URL out of a cloudflared output chunk.
function extractTunnelUrl(text) {
  const match = String(text).match(TUNNEL_URL_RE);
  return match ? match[0] : null;
}

function download(url, destination, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error("Too many redirects fetching cloudflared."));
    https.get(url, { headers: { "User-Agent": "ForgeLink" } }, (response) => {
      const { statusCode = 0, headers } = response;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        response.resume();
        resolve(download(headers.location, destination, depth + 1));
        return;
      }
      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`cloudflared download failed (${statusCode}).`));
        return;
      }
      const tmp = `${destination}.download`;
      const file = fs.createWriteStream(tmp);
      response.pipe(file);
      file.on("finish", () => file.close((err) => {
        if (err) return reject(err);
        try { fs.renameSync(tmp, destination); resolve(destination); } catch (cause) { reject(cause); }
      }));
      file.on("error", reject);
    }).on("error", reject);
  });
}

// Resolve a cloudflared binary: a bundled resource if present, else a cached
// download under binDir (fetched once).
async function ensureCloudflared({ binDir, resourcePath } = {}) {
  if (resourcePath && fs.existsSync(resourcePath)) return resourcePath;
  fs.mkdirSync(binDir, { recursive: true });
  const target = path.join(binDir, "cloudflared.exe");
  if (fs.existsSync(target) && fs.statSync(target).size > 0) return target;
  await download(CLOUDFLARED_URL, target);
  return target;
}

function createTunnelManager({ binDir, resourcePath, spawnImpl = spawn, ensure = ensureCloudflared } = {}) {
  let child = null;

  async function start(targetUrl, { timeoutMs = 30_000 } = {}) {
    await stop();
    const bin = await ensure({ binDir, resourcePath });
    return await new Promise((resolve, reject) => {
      const proc = spawnImpl(bin, ["tunnel", "--no-autoupdate", "--url", targetUrl], { stdio: ["ignore", "pipe", "pipe"] });
      child = proc;
      let settled = false;
      const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
      const onData = (chunk) => { const url = extractTunnelUrl(chunk.toString()); if (url) finish(resolve, url); };
      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);
      proc.on("error", (err) => finish(reject, err));
      proc.on("exit", (code) => { if (child === proc) child = null; finish(reject, new Error(`cloudflared exited (${code}) before a tunnel URL was ready.`)); });
      const timer = setTimeout(() => finish(reject, new Error("Timed out waiting for the tunnel URL.")), timeoutMs);
    });
  }

  function stop() {
    const proc = child;
    child = null;
    if (proc && !proc.killed) { try { proc.kill(); } catch { /* already gone */ } }
    return Promise.resolve();
  }

  function running() { return Boolean(child && !child.killed); }

  return { start, stop, running };
}

module.exports = { extractTunnelUrl, ensureCloudflared, createTunnelManager, CLOUDFLARED_URL };
