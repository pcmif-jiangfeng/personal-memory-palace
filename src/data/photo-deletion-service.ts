import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "./transaction.ts";
import { ApiError } from "../http/errors.ts";
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
        "SELECT optimized_storage_key AS optimizedStorageKey FROM photo_deletion_jobs WHERE photo_id = ?",
      )
      .get(photoId) as PhotoRow | undefined;
    if (pending) return pending;

    const photo = database
      .prepare(
        "SELECT optimized_storage_key AS optimizedStorageKey FROM uploaded_photos WHERE id = ?",
      )
      .get(photoId) as PhotoRow | undefined;
    if (!photo) return null;

    const references = findPhotoReferences(database, photo.optimizedStorageKey);
    if (references.memories.length > 0 || references.stages.length > 0) {
      throw new ApiError("PHOTO_IN_USE", 409, { references });
    }

    database
      .prepare(
        `INSERT INTO photo_deletion_jobs
         (photo_id, optimized_storage_key, created_at, last_error)
         VALUES (?, ?, ?, NULL)`,
      )
      .run(photoId, photo.optimizedStorageKey, new Date().toISOString());
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
    await storage.remove([plan.optimizedStorageKey]);
  } catch (error) {
    database
      .prepare("UPDATE photo_deletion_jobs SET last_error = ? WHERE photo_id = ?")
      .run(error instanceof Error ? error.name : "UnknownError", photoId);
    throw new ApiError("PHOTO_DELETE_FAILED", 500, { retryable: true });
  }

  try {
    database.prepare("DELETE FROM photo_deletion_jobs WHERE photo_id = ?").run(photoId);
  } catch {
    throw new ApiError("PHOTO_DELETE_INCOMPLETE", 500, { retryable: true });
  }
  return { deleted: true, alreadyDeleted: false };
}
