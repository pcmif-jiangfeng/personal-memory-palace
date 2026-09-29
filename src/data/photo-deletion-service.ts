import type { DatabaseSync } from "node:sqlite";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { withTransaction } from "./transaction.ts";
import { DomainError } from "../domain/errors.ts";
import type { ImageStorage } from "../storage/image-storage.ts";
import type { MemoryScope } from "./scoped-memory.ts";
import { requirePhotoAccess, requirePhotoMuseum } from "./photo-access.ts";
import { ApiError } from "../http/errors.ts";
import { readBooleanFlag, readNullableString, readString } from "./row-readers.ts";
import { releasePhotoStorageInDatabase } from "./photo-storage-quota.ts";

export interface PhotoMemoryReference {
  id: string;
  title: string;
  isCover: boolean;
}

export interface PhotoStageReference {
  id: string;
  title: string;
}

export interface PhotoReferences {
  memories: PhotoMemoryReference[];
  stages: PhotoStageReference[];
}

interface PhotoRow {
  optimizedStorageKey: string;
  originalStorageKey: string | null;
}

interface PendingDeletionRow extends PhotoRow {
  photoId: string;
}

interface PendingUploadRow {
  id: string;
  storageKey: string;
}

function readPhotoRow(row: Record<string, unknown>): PhotoRow {
  return {
    optimizedStorageKey: readString(row, "optimizedStorageKey"),
    originalStorageKey: readNullableString(row, "originalStorageKey"),
  };
}

function readPendingDeletionRow(row: Record<string, unknown>): PendingDeletionRow {
  return {
    photoId: readString(row, "photoId"),
    ...readPhotoRow(row),
  };
}

function readPendingUploadRow(row: Record<string, unknown>): PendingUploadRow {
  return {
    id: readString(row, "id"),
    storageKey: readString(row, "storageKey"),
  };
}

function readPhotoMemoryReference(row: Record<string, unknown>): PhotoMemoryReference {
  return {
    id: readString(row, "id"),
    title: readString(row, "title"),
    isCover: readBooleanFlag(row, "isCover"),
  };
}

function readPhotoStageReference(row: Record<string, unknown>): PhotoStageReference {
  return {
    id: readString(row, "id"),
    title: readString(row, "title"),
  };
}

function findPhotoReferences(database: DatabaseSync, storageKey: string): PhotoReferences {
  const memories = database
    .prepare(
      `SELECT memories.id, memories.title, MAX(memory_images.is_cover) AS isCover
       FROM memory_images
       JOIN memories ON memories.id = memory_images.memory_id
       WHERE memory_images.storage_key = ?
       GROUP BY memories.id, memories.title
       ORDER BY memories.created_at DESC, memories.id`,
    )
    .all(storageKey)
    .map(readPhotoMemoryReference);
  const stages = database
    .prepare(
      `SELECT stages.id, stages.title
       FROM stage_covers
       JOIN stages ON stages.id = stage_covers.stage_id
       WHERE stage_covers.storage_key = ?
       ORDER BY stages.created_at DESC, stages.id`,
    )
    .all(storageKey)
    .map(readPhotoStageReference);

  return {
    memories,
    stages: stages.map((stage) => ({ id: stage.id, title: stage.title })),
  };
}

function prepareDeletion(
  database: DatabaseSync,
  photoId: string,
  scope?: MemoryScope,
): PhotoRow | null {
  return withTransaction(database, () => {
    if (scope) {
      requirePhotoMuseum(database, scope, true);
      const pending = Boolean(
        database.prepare("SELECT photo_id FROM photo_deletion_jobs WHERE photo_id=?").get(photoId),
      );
      requirePhotoAccess(database, scope, photoId, pending);
    }
    const pendingRow = database
      .prepare(
        `SELECT optimized_storage_key AS optimizedStorageKey,
                original_storage_key AS originalStorageKey
         FROM photo_deletion_jobs WHERE photo_id = ?`,
      )
      .get(photoId);
    const pending = pendingRow ? readPhotoRow(pendingRow) : undefined;
    if (pending) return pending;

    const photoRow = database
      .prepare(
        `SELECT optimized_storage_key AS optimizedStorageKey,
                original_storage_key AS originalStorageKey, museum_id AS museumId
         FROM uploaded_photos WHERE id = ?`,
      )
      .get(photoId);
    const photo = photoRow ? readPhotoRow(photoRow) : undefined;
    if (!photo) return null;

    if (scope) {
      const foreignMemory = database
        .prepare(
          `SELECT 1 FROM memory_images i JOIN memories m ON m.id=i.memory_id WHERE i.storage_key=? AND (m.museum_id IS NOT ? OR i.museum_id IS NOT ?)`,
        )
        .get(photo.optimizedStorageKey, scope.museumId, scope.museumId);
      const foreignStage = database
        .prepare(
          `SELECT 1 FROM stage_covers c JOIN stages s ON s.id=c.stage_id WHERE c.storage_key=? AND (s.museum_id IS NOT ? OR c.museum_id IS NOT ?)`,
        )
        .get(photo.optimizedStorageKey, scope.museumId, scope.museumId);
      if (foreignMemory || foreignStage) throw new ApiError("INVALID_PHOTO_BINDING", 400);
    }

    const references = findPhotoReferences(database, photo.optimizedStorageKey);
    if (references.memories.length > 0 || references.stages.length > 0) {
      throw new DomainError("PHOTO_IN_USE", { references });
    }

    database
      .prepare(
        `INSERT INTO photo_deletion_jobs
         (photo_id, optimized_storage_key, original_storage_key, created_at, last_error, museum_id)
         VALUES (?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        photoId,
        photo.optimizedStorageKey,
        photo.originalStorageKey,
        new Date().toISOString(),
        readNullableString(photoRow!, "museumId"),
      );
    database.prepare("DELETE FROM uploaded_photos WHERE id = ?").run(photoId);
    // The DB deletion is committed before asynchronous file cleanup; do not claim cleanup succeeded.
    // Existing jobs return above, so retries and startup recovery cannot duplicate this event.
    if (scope) {
      writeAuditLogInDatabase(database, {
        actorUserId: scope.userId,
        museumId: scope.museumId,
        action: "photo.deleteQueued",
        objectType: "photo",
        objectId: photoId,
      });
    }
    return photo;
  });
}

export async function deleteUploadedPhotoInDatabase(
  database: DatabaseSync,
  storage: Pick<ImageStorage, "remove">,
  photoId: string,
  scope?: MemoryScope,
): Promise<{ deleted: boolean; alreadyDeleted: boolean }> {
  const plan = prepareDeletion(database, photoId, scope);
  if (!plan) return { deleted: false, alreadyDeleted: true };

  try {
    await storage.remove([plan.optimizedStorageKey, plan.originalStorageKey]);
  } catch (error) {
    database
      .prepare("UPDATE photo_deletion_jobs SET last_error = ? WHERE photo_id = ?")
      .run(error instanceof Error ? error.name : "UnknownError", photoId);
    throw new DomainError("PHOTO_DELETE_FAILED", { retryable: true });
  }

  try {
    withTransaction(database, () => {
      releasePhotoStorageInDatabase(database, [plan.optimizedStorageKey, plan.originalStorageKey]);
      database.prepare("DELETE FROM photo_deletion_jobs WHERE photo_id = ?").run(photoId);
    });
  } catch {
    throw new DomainError("PHOTO_DELETE_INCOMPLETE", { retryable: true });
  }
  return { deleted: true, alreadyDeleted: false };
}

export interface PhotoBatchDeleteResult {
  deletedIds: string[];
  failures: Array<{
    photoId: string;
    error: string;
    details?: Record<string, unknown>;
  }>;
}

export async function deleteUploadedPhotosInDatabase(
  database: DatabaseSync,
  storage: Pick<ImageStorage, "remove">,
  photoIds: string[],
  scope?: MemoryScope,
): Promise<PhotoBatchDeleteResult> {
  const result: PhotoBatchDeleteResult = { deletedIds: [], failures: [] };
  for (const photoId of new Set(photoIds)) {
    try {
      await deleteUploadedPhotoInDatabase(database, storage, photoId, scope);
      result.deletedIds.push(photoId);
    } catch (error) {
      result.failures.push({
        photoId,
        error:
          error instanceof DomainError || error instanceof ApiError ? error.code : "INTERNAL_ERROR",
        ...(error instanceof DomainError && error.details ? { details: error.details } : {}),
      });
    }
  }
  return result;
}

export async function recoverPendingPhotoDeletions(
  database: DatabaseSync,
  storage: Pick<ImageStorage, "remove">,
): Promise<{ recovered: number; failed: number }> {
  const pending = database
    .prepare(
      `SELECT photo_id AS photoId, optimized_storage_key AS optimizedStorageKey,
              original_storage_key AS originalStorageKey
       FROM photo_deletion_jobs ORDER BY created_at, photo_id`,
    )
    .all()
    .map(readPendingDeletionRow);
  let recovered = 0;
  let failed = 0;
  for (const job of pending) {
    try {
      await storage.remove([job.optimizedStorageKey, job.originalStorageKey]);
      withTransaction(database, () => {
        releasePhotoStorageInDatabase(database, [job.optimizedStorageKey, job.originalStorageKey]);
        database.prepare("DELETE FROM photo_deletion_jobs WHERE photo_id = ?").run(job.photoId);
      });
      recovered += 1;
    } catch (error) {
      database
        .prepare("UPDATE photo_deletion_jobs SET last_error = ? WHERE photo_id = ?")
        .run(error instanceof Error ? error.name : "UnknownError", job.photoId);
      failed += 1;
    }
  }
  return { recovered, failed };
}

export async function recoverPendingUploads(
  database: DatabaseSync,
  storage: Pick<ImageStorage, "remove">,
): Promise<{ recovered: number; failed: number }> {
  const pending = database
    .prepare("SELECT id, storage_key AS storageKey FROM pending_uploads ORDER BY created_at, id")
    .all()
    .map(readPendingUploadRow);
  let recovered = 0;
  let failed = 0;
  for (const job of pending) {
    try {
      await storage.remove([job.storageKey]);
      withTransaction(database, () => {
        releasePhotoStorageInDatabase(database, [job.storageKey]);
        database.prepare("DELETE FROM pending_uploads WHERE id = ?").run(job.id);
      });
      recovered += 1;
    } catch (error) {
      database
        .prepare("UPDATE pending_uploads SET last_error = ? WHERE id = ?")
        .run(error instanceof Error ? error.name : "UnknownError", job.id);
      failed += 1;
    }
  }
  return { recovered, failed };
}
