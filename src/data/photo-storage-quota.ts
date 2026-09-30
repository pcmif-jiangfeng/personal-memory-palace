import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { isMuseumPhotoAssetKey } from "../storage/photo-storage-key.ts";
import { readBooleanFlag, readNumber, readString } from "./row-readers.ts";
import { withTransaction } from "./transaction.ts";

export const photoStorageUsageSchemaSql = `
CREATE TABLE IF NOT EXISTS photo_asset_usage (
  storage_key TEXT PRIMARY KEY,
  museum_id TEXT NOT NULL REFERENCES museums(id) ON DELETE RESTRICT,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  state TEXT NOT NULL CHECK (state IN ('reserved','stored'))
);
CREATE INDEX IF NOT EXISTS photo_asset_usage_museum_state ON photo_asset_usage(museum_id,state);
`;

function safeBytes(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid photo byte accounting");
  return value;
}

// Must be part of the same transaction as the upload journal insertion.
export function reservePhotoStorageInDatabase(db: DatabaseSync, museumId: string, key: string, bytes: number) {
  if (!db.isTransaction) throw new Error("Photo reservation requires a transaction");
  if (!isMuseumPhotoAssetKey(key, museumId) || safeBytes(bytes) === 0) throw new Error("Invalid photo reservation");
  const museum = db.prepare("SELECT storage_used_bytes,storage_quota_bytes,storage_usage_ready FROM museums WHERE id=?").get(museumId);
  if (!museum) throw new ApiError("MUSEUM_NOT_FOUND", 404);
  if (!readBooleanFlag(museum, "storage_usage_ready")) throw new ApiError("STORAGE_USAGE_NOT_READY", 503);
  const used = safeBytes(readNumber(museum, "storage_used_bytes"));
  const quota = safeBytes(readNumber(museum, "storage_quota_bytes"));
  const reserved = safeBytes(readNumber(db.prepare("SELECT COALESCE(SUM(bytes),0) AS bytes FROM photo_asset_usage WHERE museum_id=? AND state='reserved'").get(museumId)!, "bytes"));
  if (bytes > quota - used - reserved)
    throw new ApiError("STORAGE_QUOTA_EXCEEDED", 507, {
      storageUsedBytes: used, storageQuotaBytes: quota, reservedBytes: reserved, newCompressedBytes: bytes,
    });
  db.prepare("INSERT INTO photo_asset_usage (storage_key,museum_id,bytes,state) VALUES (?,?,?,'reserved')").run(key, museumId, bytes);
}

// Called only after the storage adapter confirms the exact reserved file was saved.
export function markUploadStorageSavedInDatabase(db: DatabaseSync, museumId: string, key: string) {
  return withTransaction(db, () => {
    const row = db.prepare(`SELECT u.bytes,u.state FROM photo_asset_usage u
      JOIN pending_uploads p ON p.storage_key=u.storage_key AND p.museum_id=u.museum_id
      WHERE u.museum_id=? AND u.storage_key=?`).get(museumId, key);
    if (!row) throw new Error("Upload storage reservation not found");
    if (readString(row, "state") === "stored") return;
    const bytes = safeBytes(readNumber(row, "bytes"));
    const museum = db.prepare("SELECT storage_used_bytes FROM museums WHERE id=?").get(museumId)!;
    safeBytes(readNumber(museum, "storage_used_bytes") + bytes);
    db.prepare("UPDATE museums SET storage_used_bytes=storage_used_bytes+? WHERE id=?").run(bytes, museumId);
    db.prepare("UPDATE photo_asset_usage SET state='stored' WHERE storage_key=?").run(key);
  });
}

// Only after successful physical cleanup. A failed cleanup retains its charge for retry.
export function releasePhotoStorageInDatabase(db: DatabaseSync, keys: Array<string | null>) {
  if (!db.isTransaction) throw new Error("Photo release requires a transaction");
  for (const key of new Set(keys.filter((key): key is string => key !== null))) {
    const row = db.prepare("SELECT museum_id,bytes,state FROM photo_asset_usage WHERE storage_key=?").get(key);
    if (!row) continue; // Pre-I2 files have no ledger until the quiesced recalculation.
    if (readString(row, "state") === "stored") {
      db.prepare("UPDATE museums SET storage_used_bytes=storage_used_bytes-? WHERE id=?").run(
        safeBytes(readNumber(row, "bytes")), readString(row, "museum_id"),
      );
    }
    db.prepare("DELETE FROM photo_asset_usage WHERE storage_key=?").run(key);
  }
}
