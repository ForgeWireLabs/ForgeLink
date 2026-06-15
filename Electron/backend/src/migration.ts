import { cpSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

export interface LegacyMigrationResult {
  databaseCopied: boolean;
  uploadsCopied: boolean;
}

export function migrateLegacyData(legacyDir: string, dataDir: string): LegacyMigrationResult {
  const legacyDatabase = [join(legacyDir, "phone.sqlite"), join(legacyDir, "phone.sqlite3")].find(existsSync);
  const targetDatabase = join(dataDir, "phone.sqlite3");
  const legacyUploads = join(legacyDir, "uploads");
  const targetUploads = join(dataDir, "uploads");
  const result = { databaseCopied: false, uploadsCopied: false };

  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(targetDatabase) && legacyDatabase) {
    copyFileSync(legacyDatabase, targetDatabase);
    result.databaseCopied = true;
  }
  if (!existsSync(targetUploads) && existsSync(legacyUploads)) {
    cpSync(legacyUploads, targetUploads, { recursive: true, errorOnExist: false });
    result.uploadsCopied = true;
  }
  return result;
}
