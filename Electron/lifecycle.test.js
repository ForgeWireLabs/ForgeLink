const assert = require("node:assert/strict");
const net = require("node:net");
const test = require("node:test");
const { isPortAvailable, findAvailablePort, createRestartPolicy } = require("./lifecycle");

function listenOnFreePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

test("isPortAvailable reflects whether a port is in use", async () => {
  const { server, port } = await listenOnFreePort();
  try {
    assert.equal(await isPortAvailable(port), false);
  } finally {
    await new Promise((r) => server.close(r));
  }
  assert.equal(await isPortAvailable(port), true);
});

test("findAvailablePort returns the preferred port when free", async () => {
  const { server, port } = await listenOnFreePort();
  await new Promise((r) => server.close(r));
  assert.equal(await findAvailablePort(port), port);
});

test("findAvailablePort falls back to a free port when the preferred one is taken", async () => {
  const { server, port } = await listenOnFreePort();
  try {
    const chosen = await findAvailablePort(port);
    assert.notEqual(chosen, port);
    assert.equal(await isPortAvailable(chosen), true);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("restart policy allows up to the budget then denies within the window", () => {
  const policy = createRestartPolicy({ maxRestarts: 3, windowMs: 1000 });
  const t = 10_000;
  assert.equal(policy.allow(t), true);
  assert.equal(policy.allow(t), true);
  assert.equal(policy.allow(t), true);
  assert.equal(policy.allow(t), false);
  assert.equal(policy.count, 3);
});

test("restart policy recovers after the window elapses", () => {
  const policy = createRestartPolicy({ maxRestarts: 2, windowMs: 1000 });
  assert.equal(policy.allow(0), true);
  assert.equal(policy.allow(0), true);
  assert.equal(policy.allow(0), false);
  // After the window, old stamps expire and restarts are allowed again.
  assert.equal(policy.allow(2000), true);
});
