import type { DatabaseSync } from "node:sqlite";
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
    prepare: (key) =>
      withTransaction(db, () => {
        requirePhotoMuseum(db, scope);
        return prepareOptimizedUploadInDatabase(db, key, scope.museumId);
      }),
    save: (image, key) => storage.saveOptimized(image, key),
    commit: (id, item) =>
      withTransaction(db, () => {
        // Saving files is asynchronous; membership may have been revoked while the upload was running.
        requirePhotoMuseum(db, scope);
        return commitOptimizedUploadInDatabase(db, id, item, scope.museumId);
      }),
  });
}
