// Managed document store unit tests (work item 041, Phase 4: FAX-007).
// No network call anywhere in this suite -- this is a pure local
// filesystem primitive.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ManagedDocumentStore } from "./managed-document-store";

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

test("FAX-007: beginStaging creates an empty placeholder file under staging/, never under documents/", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "forgelink-managed-store-"));
  try {
    const store = new ManagedDocumentStore(dataDir);
    const staged = await store.beginStaging();
    assert.ok(existsSync(staged.stagingPath));
    assert.equal(readFileSync(staged.stagingPath).length, 0);
    assert.ok(staged.stagingPath.includes(join("managed-documents", "staging")));
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test("FAX-007: commit computes hash/size from the file on disk (never a caller claim) and atomically moves it into documents/", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "forgelink-managed-store-commit-"));
  try {
    const store = new ManagedDocumentStore(dataDir);
    const staged = await store.beginStaging();
    const bytes = Buffer.from("%PDF-1.4 synthetic test content");
    writeFileSync(staged.stagingPath, bytes);
    const ref = await store.commit(staged, "application/pdf", "webhook_media_url");
    assert.equal(ref.byteSize, bytes.length);
    assert.equal(ref.contentSha256, sha256(bytes));
    assert.equal(ref.contentType, "application/pdf");
    assert.equal(ref.sourceKind, "webhook_media_url");
    assert.ok(ref.localRef.startsWith("documents/"));
    assert.equal(existsSync(staged.stagingPath), false, "the staging file must no longer exist after commit");
    const inspected = await store.inspect(ref.localRef);
    assert.equal(inspected.exists, true);
    assert.equal(inspected.byteSize, bytes.length);
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test("FAX-007: quarantineStaged moves the file into quarantine/, never documents/, and the id is not a durable document reference", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "forgelink-managed-store-quarantine-"));
  try {
    const store = new ManagedDocumentStore(dataDir);
    const staged = await store.beginStaging();
    writeFileSync(staged.stagingPath, Buffer.from("<html>not a fax</html>"));
    const { quarantineId } = await store.quarantineStaged(staged);
    assert.equal(existsSync(staged.stagingPath), false);
    assert.ok(existsSync(join(store.quarantineDir, quarantineId)));
    assert.equal(readdirSync(store.documentsDir).length, 0, "quarantined content must never land in documents/");
    // A quarantine id is never accepted as a documents/ reference.
    assert.throws(() => store.documentPath(`quarantine/${quarantineId}`));
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test("FAX-007: discardStaged removes the file with no trace in documents/ or quarantine/", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "forgelink-managed-store-discard-"));
  try {
    const store = new ManagedDocumentStore(dataDir);
    const staged = await store.beginStaging();
    writeFileSync(staged.stagingPath, Buffer.from("oversized or otherwise unusable"));
    await store.discardStaged(staged);
    assert.equal(existsSync(staged.stagingPath), false);
    assert.equal(readdirSync(store.documentsDir).length, 0);
    assert.equal(readdirSync(store.quarantineDir).length, 0);
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test("FAX-007: sweepAbandonedStaging removes every leftover staging file (a crashed acquisition) without touching documents/", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "forgelink-managed-store-sweep-"));
  try {
    const store = new ManagedDocumentStore(dataDir);
    const abandoned1 = await store.beginStaging();
    const abandoned2 = await store.beginStaging();
    writeFileSync(abandoned1.stagingPath, Buffer.from("partial"));
    const committed = await store.beginStaging();
    writeFileSync(committed.stagingPath, Buffer.from("%PDF-1.4 complete"));
    const ref = await store.commit(committed, "application/pdf", "webhook_media_url");

    const swept = await store.sweepAbandonedStaging();
    assert.equal(swept, 2, "only the two genuinely abandoned staging files are swept");
    assert.equal(existsSync(abandoned1.stagingPath), false);
    assert.equal(existsSync(abandoned2.stagingPath), false);
    const stillThere = await store.inspect(ref.localRef);
    assert.equal(stillThere.exists, true, "an already-committed document must survive the staging sweep");
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test("FAX-007: documentPath rejects a reference that would escape the documents/ directory", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "forgelink-managed-store-escape-"));
  try {
    const store = new ManagedDocumentStore(dataDir);
    assert.throws(() => store.documentPath("../staging/whatever"));
    assert.throws(() => store.documentPath("../../etc/passwd"));
    assert.throws(() => store.documentPath("documents/../../../etc/passwd"));
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test("FAX-007: verify confirms a matching hash and rejects a mismatched or missing one", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "forgelink-managed-store-verify-"));
  try {
    const store = new ManagedDocumentStore(dataDir);
    const staged = await store.beginStaging();
    const bytes = Buffer.from("%PDF-1.4 verify me");
    writeFileSync(staged.stagingPath, bytes);
    const ref = await store.commit(staged, "application/pdf", "webhook_media_url");
    assert.equal(await store.verify(ref.localRef, ref.contentSha256), true);
    assert.equal(await store.verify(ref.localRef, "0".repeat(64)), false);
    assert.equal(await store.verify("documents/does-not-exist", ref.contentSha256), false);
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test("FAX-007: delete removes only the targeted document, leaving other committed documents untouched", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "forgelink-managed-store-delete-"));
  try {
    const store = new ManagedDocumentStore(dataDir);
    const stagedA = await store.beginStaging();
    writeFileSync(stagedA.stagingPath, Buffer.from("%PDF-1.4 document A"));
    const refA = await store.commit(stagedA, "application/pdf", "webhook_media_url");
    const stagedB = await store.beginStaging();
    writeFileSync(stagedB.stagingPath, Buffer.from("%PDF-1.4 document B"));
    const refB = await store.commit(stagedB, "application/pdf", "webhook_media_url");

    await store.delete(refA.localRef);
    assert.equal((await store.inspect(refA.localRef)).exists, false);
    assert.equal((await store.inspect(refB.localRef)).exists, true, "an unrelated committed document must never be deleted as a side effect");
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});
