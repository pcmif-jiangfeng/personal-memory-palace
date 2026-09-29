import type { DatabaseSync } from "node:sqlite";
import { writeAuditLogInDatabase } from "../data/audit-log.ts";
import type { MemoryScope } from "../data/scoped-memory.ts";
import { museumPhotoStorageKey, requirePhotoMuseum } from "../data/photo-access.ts";
import {
  prepareOptimizedUploadInDatabase,
  commitOptimizedUploadInDatabase,
} from "../data/photo-repository.ts";
import { withTransaction } from "../data/transaction.ts";
import { uploadOptimizedPhoto } from "./photo-upload-service.ts";
import { validateWebOptimizedImage } from "../storage/image-processor.ts";
import { imageStorage } from "../storage/local-image-storage.ts";
import type { ImageStorage } from "../storage/image-storage.ts";
import {
  markUploadStorageSavedInDatabase,
  reservePhotoStorageInDatabase,
} from "../data/photo-storage-quota.ts";

export function uploadScopedPhoto(
  db: DatabaseSync,
  scope: MemoryScope,
  input: { data: Buffer; requestedName: string | null },
  storage: Pick<ImageStorage, "saveOptimized"> = imageStorage,
) {
  requirePhotoMuseum(db, scope);
  return uploadOptimizedPhoto(input, {
    createStorageKey: () => museumPhotoStorageKey(scope.museumId),
    validate: validateWebOptimizedImage,
    prepare: (key, image) =>
      withTransaction(db, () => {
        requirePhotoMuseum(db, scope);
        reservePhotoStorageInDatabase(db, scope.museumId, key, image.data.length);
        return prepareOptimizedUploadInDatabase(db, key, scope.museumId);
      }),
    save: async (image, key) => {
      const saved = await storage.saveOptimized(image, key);
      if (saved.optimizedStorageKey !== key || saved.originalStorageKey !== null)
        throw new Error("Scoped upload must save only the reserved file");
      markUploadStorageSavedInDatabase(db, scope.museumId, key);
      return saved;
    },
    commit: (id, item) =>
      withTransaction(db, () => {
        // Saving files is asynchronous; membership may have been revoked while the upload was running.
        requirePhotoMuseum(db, scope);
        const photo = commitOptimizedUploadInDatabase(db, id, item, scope.museumId);
        writeAuditLogInDatabase(db, {
          actorUserId: scope.userId,
          museumId: scope.museumId,
          action: "photo.upload",
          objectType: "photo",
          objectId: photo.id,
          diff: { width: photo.width, height: photo.height },
        });
        return photo;
      }),
  });
}
