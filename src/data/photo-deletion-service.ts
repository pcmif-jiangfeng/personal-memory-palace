import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "./transaction.ts";
import { DomainError } from "../domain/errors.ts";
import type { ImageStorage } from "../storage/image-storage.ts";

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
    .all(storageKey) as unknown as Array<{ id: string; title: string; isCover: number }>;
  const stages = database
    .prepare(
      `SELECT stages.id, stages.title
       FROM stage_covers
       JOIN stages ON stages.id = stage_covers.stage_id
       WHERE stage_covers.storage_key = ?
       ORDER BY stages.created_at DESC, stages.id`,
    )
    .all(storageKey) as unknown as PhotoStageReference[];

  return {
    memories: memories.map((memory) => ({ ...memory, isCover: memory.isCover === 1 })),
    stages: stages.map((stage) => ({ id: stage.id, title: stage.title })),
  };
}

function prepareDeletion(database: DatabaseSync, photoId: string): PhotoRow | null {
  return withTransaction(database, () => {
    const pending = database
      .prepare(
        `SELECT optimized_storage_key AS optimizedStorageKey,
                original_storage_key AS originalStorageKey
         FROM photo_deletion_jobs WHERE photo_id = ?`,
      )
      .get(photoId) as PhotoRow | undefined;
    if (pending) return pending;

    const photo = database
      .prepare(
        `SELECT optimized_storage_key AS optimizedStorageKey,
                original_storage_key AS originalStorageKey
         FROM uploaded_photos WHERE id = ?`,
      )
      .get(photoId) as PhotoRow | undefined;
    if (!photo) return null;

    const references = findPhotoReferences(database, photo.optimizedStorageKey);
    if (references.memories.length > 0 || references.stages.length > 0) {
      throw new DomainError("PHOTO_IN_USE", { references });
    }

    database
      .prepare(
        `INSERT INTO photo_deletion_jobs
         (photo_id, optimized_storage_key, original_storage_key, created_at, last_error)
         VALUES (?, ?, ?, ?, NULL)`,
      )
      .run(photoId, photo.optimizedStorageKey, photo.originalStorageKey, new Date().toISOString());
    database.prepare("DELETE FROM uploaded_photos WHERE id = ?").run(photoId);
    return photo;
  });
}

export async function deleteUploadedPhotoInDatabase(
  database: DatabaseSync,
  storage: Pick<ImageStorage, "remove">,
  photoId: string,
): Promise<{ deleted: boolean; alreadyDeleted: boolean }> {
  const plan = prepareDeletion(database, photoId);
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
    database.prepare("DELETE FROM photo_deletion_jobs WHERE photo_id = ?").run(photoId);
  } catch {
    throw new DomainError("PHOTO_DELETE_INCOMPLETE", { retryable: true });
  }
  return { deleted: true, alreadyDeleted: false };
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
    .all() as unknown as PendingDeletionRow[];
  let recovered = 0;
  let failed = 0;
  for (const job of pending) {
    try {
      await storage.remove([job.optimizedStorageKey, job.originalStorageKey]);
      database.prepare("DELETE FROM photo_deletion_jobs WHERE photo_id = ?").run(job.photoId);
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
    .all() as unknown as PendingUploadRow[];
  let recovered = 0;
  let failed = 0;
  for (const job of pending) {
    try {
      await storage.remove([job.storageKey]);
      database.prepare("DELETE FROM pending_uploads WHERE id = ?").run(job.id);
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
