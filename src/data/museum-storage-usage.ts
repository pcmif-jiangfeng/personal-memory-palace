import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "./transaction.ts";
import { readNullableString, readString, readNumber, readBooleanFlag } from "./row-readers.ts";
import { measureMuseumPhotoAssets, validateMuseumAssetKey } from "../storage/photo-asset-usage.ts";
import { requireMuseumAccessInDatabase } from "./museum-access.ts";
import { ApiError } from "../http/errors.ts";

/** A member sees this palace and an account remainder, never other owned palace details. */
export function readMuseumStorageSummaryInDatabase(database: DatabaseSync, userId: string | null, museumId: string) {
  return withTransaction(database, () => {
    const access = requireMuseumAccessInDatabase(database, userId, museumId);
    if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
    const museum = database.prepare(`SELECT m.owner_id,m.storage_used_bytes,m.storage_usage_ready,u.storage_quota_bytes
      FROM museums m JOIN users u ON u.id=m.owner_id WHERE m.id=?`).get(museumId)!;
    const ownerId = readString(museum, "owner_id");
    const account = database.prepare(`SELECT COALESCE(SUM(storage_used_bytes),0) AS used,MIN(storage_usage_ready) AS ready
      FROM museums WHERE owner_id=?`).get(ownerId)!;
    const reservation = database.prepare(`SELECT COALESCE(SUM(a.bytes),0) AS total,
      COALESCE(SUM(CASE WHEN a.museum_id=? THEN a.bytes ELSE 0 END),0) AS current
      FROM photo_asset_usage a JOIN museums m ON m.id=a.museum_id WHERE m.owner_id=? AND a.state='reserved'`).get(museumId, ownerId)!;
    const storageUsedBytes = readBooleanFlag(museum, "storage_usage_ready") ? readNumber(museum, "storage_used_bytes") : null;
    const reservedBytes = readNumber(reservation, "current");
    const accountUsed = readNumber(account, "used");
    const accountReserved = readNumber(reservation, "total");
    const quota = museum.storage_quota_bytes === null ? null : readNumber(museum, "storage_quota_bytes");
    for (const bytes of [storageUsedBytes, reservedBytes, accountUsed, accountReserved, quota])
      if (bytes !== null && (!Number.isSafeInteger(bytes) || bytes < 0)) throw new Error("Invalid photo byte accounting");
    const ownerRemainingBytes = readBooleanFlag(account, "ready") && quota !== null
      ? Math.max(0, quota - accountUsed - accountReserved) : null;
    return { museumId, storageUsedBytes, reservedBytes, ownerRemainingBytes };
  });
}

const assetInventorySql = `
  SELECT museum_id, optimized_storage_key AS storage_key FROM uploaded_photos
  UNION
  SELECT museum_id, original_storage_key FROM uploaded_photos WHERE original_storage_key IS NOT NULL
  UNION
  SELECT museum_id, optimized_storage_key FROM photo_deletion_jobs
  UNION
  SELECT museum_id, original_storage_key FROM photo_deletion_jobs WHERE original_storage_key IS NOT NULL
  UNION
  SELECT museum_id, storage_key FROM pending_uploads`;

// Internal maintenance operation, not a visitor API or an upload quota guard.
// SQLite serializes registry changes; the operator must also pause external file writers.
export function recalculateMuseumStorageUsageInDatabase(
  database: DatabaseSync,
  museumId: string,
  imageRoot: string,
) {
  return withTransaction(database, () => {
    if (!database.prepare("SELECT id FROM museums WHERE id=?").get(museumId))
      throw new Error("Museum not found");
    const inventory = database.prepare(assetInventorySql).all().map((row) => ({
      museumId: readNullableString(row, "museum_id"),
      key: readString(row, "storage_key"),
    }));
    const keys = new Set<string>();
    for (const asset of inventory) {
      if (asset.museumId === museumId) {
        validateMuseumAssetKey(asset.key, museumId);
        keys.add(asset.key);
      } else if (asset.key.startsWith(`uploads/museums/${museumId}/`)) {
        if (asset.museumId !== null) throw new Error("Photo asset belongs to another Museum");
        // Old interrupted jobs may lack museum_id, but scoped physical keys retain ownership.
        validateMuseumAssetKey(asset.key, museumId);
        keys.add(asset.key);
      } else if (asset.museumId === null && /^uploads\/(demo|owner)\//.test(asset.key)) {
        // Legacy paths do not identify a Museum. Never guess an owner or publish a low total.
        throw new Error("Unassigned legacy photo assets require ownership repair before recalculation");
      }
    }
    for (const asset of inventory)
      if (keys.has(asset.key) && asset.museumId !== null && asset.museumId !== museumId)
        throw new Error("Photo asset belongs to another Museum");
    const { assets, ...result } = measureMuseumPhotoAssets(imageRoot, museumId, [...keys]);
    database.prepare("DELETE FROM photo_asset_usage WHERE museum_id=?").run(museumId);
    const insert = database.prepare("INSERT INTO photo_asset_usage (storage_key,museum_id,bytes,state) VALUES (?,?,?,'stored')");
    for (const asset of assets) insert.run(asset.storageKey, museumId, asset.bytes);
    database.prepare("UPDATE museums SET storage_used_bytes=?,storage_usage_ready=1 WHERE id=?").run(result.storageUsedBytes, museumId);
    return result;
  });
}
