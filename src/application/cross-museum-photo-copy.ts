import type { DatabaseSync } from "node:sqlite";
import path from "node:path";
import {
  requirePhotoAccess,
  requirePhotoMuseum,
  museumPhotoStorageKey,
} from "../data/photo-access.ts";
import {
  commitOptimizedUploadInDatabase,
  prepareOptimizedUploadInDatabase,
} from "../data/photo-repository.ts";
import {
  reservePhotoStorageInDatabase,
  markUploadStorageSavedInDatabase,
} from "../data/photo-storage-quota.ts";
import { readNumber, readString } from "../data/row-readers.ts";
import type { MemoryScope } from "../data/scoped-memory.ts";
import { withTransaction } from "../data/transaction.ts";
import { writeAuditLogInDatabase } from "../data/audit-log.ts";
import { ApiError } from "../http/errors.ts";
import { photoCopyStorage } from "../storage/photo-copy-storage.ts";
import type { UploadedPhoto } from "../domain/models.ts";

export async function copyPhotoToMuseum(
  db: DatabaseSync,
  source: MemoryScope,
  photoId: string,
  targetMuseumId: string,
  storage = photoCopyStorage,
) {
  return copyPhotosToMuseum(db, source, [photoId], targetMuseumId, (photos) => photos[0], storage);
}

// Memory copying uses the same asset lifecycle and publishes every Photo and its Memory together.
export async function copyPhotosToMuseum<T>(
  db: DatabaseSync,
  source: MemoryScope,
  photoIds: string[],
  targetMuseumId: string,
  finish: (photos: UploadedPhoto[]) => T,
  storage = photoCopyStorage,
) {
  const target = { userId: source.userId, museumId: targetMuseumId };
  if (source.museumId === targetMuseumId) throw new ApiError("COPY_TARGET_MUST_DIFFER", 400);
  requirePhotoMuseum(db, source);
  requirePhotoMuseum(db, target);
  const snapshots = [...new Set(photoIds)].map((photoId) => {
    const binding = requirePhotoAccess(db, source, photoId);
    const photo = db
      .prepare(
        "SELECT original_name,mime_type,width,height FROM uploaded_photos WHERE id=? AND museum_id=?",
      )
      .get(photoId, source.museumId)!;
    const optimizedKey = museumPhotoStorageKey(targetMuseumId);
    const originalKey =
      binding.originalKey === null
        ? null
        : optimizedKey
            .replace("/optimized/", "/original/")
            .replace(/\.webp$/, path.extname(String(binding.originalKey)));
    const assets = [{ sourceKey: String(binding.optimizedKey), targetKey: optimizedKey }];
    if (originalKey)
      assets.push({ sourceKey: String(binding.originalKey), targetKey: originalKey });
    return { photoId, binding, photo, optimizedKey, originalKey, assets };
  });
  const measured: Array<
    Omit<(typeof snapshots)[number], "assets"> & {
      assets: Array<(typeof snapshots)[number]["assets"][number] & { bytes: number }>;
    }
  > = [];
  for (const snapshot of snapshots)
    measured.push({
      ...snapshot,
      assets: await Promise.all(
        snapshot.assets.map(async (asset) => ({
          ...asset,
          bytes: await storage.size(asset.sourceKey),
        })),
      ),
    });
  const recheck = () => {
    requirePhotoMuseum(db, source);
    requirePhotoMuseum(db, target);
    for (const { photoId, binding } of snapshots) {
      const current = requirePhotoAccess(db, source, photoId);
      requirePhotoMuseum(db, target);
      if (
        current.optimizedKey !== binding.optimizedKey ||
        current.originalKey !== binding.originalKey
      )
        throw new ApiError("PHOTO_COPY_SOURCE_CHANGED", 409);
    }
  };
  // Each asset uses the existing journal, so failures remain recoverable without deleting the source.
  const plans = withTransaction(db, () => {
    recheck();
    return measured.map((snapshot) => ({
      ...snapshot,
      plans: snapshot.assets.map((asset) => {
        reservePhotoStorageInDatabase(db, targetMuseumId, asset.targetKey, asset.bytes);
        return {
          ...asset,
          operationId: prepareOptimizedUploadInDatabase(db, asset.targetKey, targetMuseumId),
        };
      }),
    }));
  });
  for (const plan of plans.flatMap((snapshot) => snapshot.plans)) {
    await storage.copy(plan.sourceKey, plan.targetKey);
    if ((await storage.size(plan.targetKey)) !== plan.bytes)
      throw new Error("Photo copy size changed");
    markUploadStorageSavedInDatabase(db, targetMuseumId, plan.targetKey);
  }
  return withTransaction(db, () => {
    recheck();
    const copies = plans.map(({ photoId, photo, optimizedKey, originalKey, plans }) => {
      const copied = commitOptimizedUploadInDatabase(
        db,
        plans[0].operationId,
        {
          originalName: readString(photo, "original_name"),
          mimeType: readString(photo, "mime_type"),
          saved: {
            optimizedStorageKey: optimizedKey,
            originalStorageKey: originalKey,
            width: readNumber(photo, "width"),
            height: readNumber(photo, "height"),
          },
        },
        targetMuseumId,
      );
      for (const plan of plans.slice(1))
        db.prepare("DELETE FROM pending_uploads WHERE id=? AND museum_id=?").run(
          plan.operationId,
          targetMuseumId,
        );
      writeAuditLogInDatabase(db, {
        actorUserId: source.userId,
        museumId: targetMuseumId,
        action: "photo.copy",
        objectType: "photo",
        objectId: copied.id,
        diff: { sourceMuseumId: source.museumId, sourcePhotoId: photoId },
      });
      return copied;
    });
    return finish(copies);
  });
}
