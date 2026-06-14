import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AddressInfo } from "node:net";
import { createBackend } from "./server";

test("serves health and contact HTTP contracts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-http-"));
  const { server } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, runtime: "node" });

    const saved = await fetch(`http://127.0.0.1:${port}/api/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada", number: "+15551234567" })
    });
    assert.equal(saved.status, 200);
    const contacts = await fetch(`http://127.0.0.1:${port}/api/contacts`).then((response) => response.json()) as Array<Record<string, unknown>>;
    assert.equal(contacts[0].name, "Ada");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
