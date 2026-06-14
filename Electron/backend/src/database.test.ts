import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PhoneDatabase } from "./database";
import { normalizeNumber } from "./phone";

test("normalizes US phone numbers", () => {
  assert.equal(normalizeNumber("(555) 123-4567"), "+15551234567");
  assert.throws(() => normalizeNumber("123"));
});

test("stores messages, unread state, and linked contacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-ts-"));
  const database = new PhoneDatabase(join(directory, "test.sqlite3"));
  try {
    database.addMessage({ id: "SM1", number: "+15551234567", direction: "inbound", body: "hello", status: "received" });
    const thread = database.threads()[0];
    assert.equal(thread.unread_count, 1);
    assert.equal(database.messages(thread.id)[0].body, "hello");
    assert.equal(database.threads()[0].unread_count, 0);
    const contactId = database.upsertContact("Ada", "+15551234567");
    database.linkThread(thread.id, contactId);
    assert.equal(database.threads()[0].name, "Ada");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
