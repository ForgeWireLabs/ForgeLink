// Private managed-document storage primitive (work item 041, Phase 4:
// FAX-007). A provider-neutral foundation for any local document that must
// be held durably and privately -- never served through the existing
// public `/media/...` route (that directory participates in existing
// media-serving behavior and is not an acceptable authority for private
// received fax documents), never keyed by a provider-supplied filename,
// never identified by a provider URL. FAX-009 (camera/device/cloud
// acquisition) is expected to reuse this same primitive in a later phase;
// this module implements only what inbound fax needs today -- no source
// adapters are implemented here.
//
// Storage layout, all under `<dataDir>/managed-documents/`:
//   staging/    -- temporary files mid-download/mid-import. Never treated
//                  as an active/open-able document. Swept unconditionally
//                  on startup if abandoned by a crashed writer -- a
//                  committed file is always renamed OUT of staging/ before
//                  anything could observe it there, so anything left in
//                  staging/ is provably abandoned, never in-progress
//                  across a restart.
//   documents/  -- committed, immutable artifacts, named by opaque id.
//   quarantine/ -- content that failed validation. Never associated with a
//                  fax_documents row, never reachable via any open/serve
//                  path, never treated as the underlying transmission's
//                  failure.
//
// Atomic commit: beginStaging() creates a zero-byte placeholder under
// staging/ (so a reconciliation sweep can always find an abandoned
// attempt even before the first byte arrives); the caller streams bytes
// into that same file; commit() computes the hash/size from the staged
// file itself (never trusts a caller-supplied value) and renames it into
// documents/ via `fs.rename`, which is atomic because staging/ and
// documents/ always live under the same managed-documents root (same
// filesystem/volume).

import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { chmod, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export interface ManagedDocumentRef {
  id: string;
  // Opaque, relative to the store root -- never a provider URL, never a
  // provider-supplied filename, never a temporary filesystem path outside
  // this store.
  localRef: string;
  contentType: string;
  byteSize: number;
  contentSha256: string;
  createdAt: string;
  sourceKind: string;
}

export interface StagedDocument {
  stagingId: string;
  stagingPath: string;
}

function opaqueId(): string {
  return randomBytes(18).toString("base64url");
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolvePromise());
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

export class ManagedDocumentStore {
  readonly root: string;
  readonly stagingDir: string;
  readonly documentsDir: string;
  readonly quarantineDir: string;

  constructor(dataDir: string) {
    this.root = join(dataDir, "managed-documents");
    this.stagingDir = join(this.root, "staging");
    this.documentsDir = join(this.root, "documents");
    this.quarantineDir = join(this.root, "quarantine");
  }

  async ensureDirectories(): Promise<void> {
    await mkdir(this.stagingDir, { recursive: true, mode: 0o700 });
    await mkdir(this.documentsDir, { recursive: true, mode: 0o700 });
    await mkdir(this.quarantineDir, { recursive: true, mode: 0o700 });
  }

  // Opens a fresh, empty staging file for the caller to stream bytes into.
  // Restrictive permissions where supported; never trusts any external
  // filename.
  async beginStaging(): Promise<StagedDocument> {
    await this.ensureDirectories();
    const stagingId = opaqueId();
    const stagingPath = join(this.stagingDir, stagingId);
    const handle = await open(stagingPath, "wx", 0o600);
    await handle.close();
    return { stagingId, stagingPath };
  }

  // Atomically promotes a staged file into the durable documents/ tree.
  // Recomputes hash/size from the file on disk -- never from a caller
  // claim -- so the returned ref is always self-consistent with the bytes
  // actually committed.
  async commit(staged: StagedDocument, contentType: string, sourceKind: string): Promise<ManagedDocumentRef> {
    const stats = await stat(staged.stagingPath);
    const sha256 = await hashFile(staged.stagingPath);
    const id = opaqueId();
    const finalPath = join(this.documentsDir, id);
    await rename(staged.stagingPath, finalPath);
    try { await chmod(finalPath, 0o600); } catch { /* best-effort on platforms without POSIX permissions */ }
    return {
      id,
      localRef: `documents/${id}`,
      contentType,
      byteSize: stats.size,
      contentSha256: sha256,
      createdAt: new Date().toISOString(),
      sourceKind
    };
  }

  // Moves a staged file into quarantine/ instead of documents/ -- never
  // associated with a fax_documents row, never reachable through any
  // "open managed document" path. The returned id is a bounded internal
  // reference for evidence/debugging only, never a durable document
  // identity.
  async quarantineStaged(staged: StagedDocument): Promise<{ quarantineId: string }> {
    await this.ensureDirectories();
    const quarantineId = opaqueId();
    await rename(staged.stagingPath, join(this.quarantineDir, quarantineId));
    return { quarantineId };
  }

  async discardStaged(staged: StagedDocument): Promise<void> {
    await rm(staged.stagingPath, { force: true });
  }

  // Startup reconciliation: anything still under staging/ was abandoned by
  // a crashed/interrupted acquisition attempt -- safe to delete
  // unconditionally. Returns the count removed, for observability only.
  async sweepAbandonedStaging(): Promise<number> {
    if (!existsSync(this.stagingDir)) return 0;
    const entries = await readdir(this.stagingDir);
    for (const entry of entries) await rm(join(this.stagingDir, entry), { force: true });
    return entries.length;
  }

  // Resolves a stored localRef to an absolute path, defensively re-proving
  // containment under documents/ even though localRef is always
  // store-generated -- never trusts string concatenation alone.
  documentPath(localRef: string): string {
    const resolved = resolve(this.root, localRef);
    const containedRoot = resolve(this.documentsDir);
    if (resolved !== containedRoot && !resolved.startsWith(containedRoot + sep)) {
      throw new Error("Managed document reference escapes the managed store.");
    }
    return resolved;
  }

  async inspect(localRef: string): Promise<{ exists: boolean; byteSize?: number }> {
    try {
      const stats = await stat(this.documentPath(localRef));
      return { exists: true, byteSize: stats.size };
    } catch {
      return { exists: false };
    }
  }

  async verify(localRef: string, expectedSha256: string): Promise<boolean> {
    try {
      const actual = await hashFile(this.documentPath(localRef));
      return actual.toLowerCase() === String(expectedSha256 || "").toLowerCase();
    } catch {
      return false;
    }
  }

  async delete(localRef: string): Promise<void> {
    await rm(this.documentPath(localRef), { force: true });
  }
}
