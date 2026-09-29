import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "./transaction.ts";
import { readNullableString, readString } from "./row-readers.ts";
import { measureMuseumPhotoAssets, validateMuseumAssetKey } from "../storage/photo-asset-usage.ts";

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
