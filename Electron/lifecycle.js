// Backend lifecycle helpers (PR-006): port-conflict detection, dynamic-port
// fallback, and a bounded crash-restart budget. Kept as a separate, pure-ish
// module so the lifecycle logic is unit-testable without an Electron harness.

const net = require("node:net");

// Resolve true if nothing is listening on host:port (we can bind it).
function isPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, host);
  });
}

// Prefer the requested port; if it is taken, fall back to an OS-assigned free one.
async function findAvailablePort(preferred, host = "127.0.0.1") {
  if (await isPortAvailable(preferred, host)) return preferred;
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const assigned = server.address().port;
      server.close(() => resolve(assigned));
    });
  });
}

// Sliding-window restart budget: allow up to maxRestarts within windowMs.
function createRestartPolicy({ maxRestarts = 5, windowMs = 60_000 } = {}) {
  let stamps = [];
  return {
    allow(now = Date.now()) {
      stamps = stamps.filter((t) => now - t < windowMs);
      if (stamps.length >= maxRestarts) return false;
      stamps.push(now);
      return true;
    },
    get count() { return stamps.length; },
    reset() { stamps = []; }
  };
}

module.exports = { isPortAvailable, findAvailablePort, createRestartPolicy };
