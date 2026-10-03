import type { DatabaseSync } from "node:sqlite";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { readNullableString } from "./row-readers.ts";
import type { MemoryScope } from "./scoped-memory.ts";
import { requireMuseumAccessInDatabase } from "./museum-access.ts";
import { archiveUploadedPhotoInDatabase } from "./photo-repository.ts";
import { withTransaction } from "./transaction.ts";
import { ApiError } from "../http/errors.ts";

import {
  isMuseumPhotoKey,
  optimizedPhotoKeyPattern,
  photoUuidPattern as uuid,
} from "../storage/photo-storage-key.ts";
export {
  optimizedPhotoKeyPattern,
  museumPhotoStorageKey,
  isMuseumPhotoKey,
} from "../storage/photo-storage-key.ts";

export function requirePhotoMuseum(db: DatabaseSync, scope: MemoryScope, ownerOnly = false) {
  const access = requireMuseumAccessInDatabase(db, scope.userId, scope.museumId);
  if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
  if (ownerOnly && access.role !== "owner") throw new ApiError("MUSEUM_OWNER_REQUIRED", 403);
  return access;
}

export function requirePhotoAccess(
  db: DatabaseSync,
  scope: MemoryScope,
  id: string,
  pendingDeletion = false,
) {
  requirePhotoMuseum(db, scope);
  const table = pendingDeletion ? "photo_deletion_jobs" : "uploaded_photos";
  const idColumn = pendingDeletion ? "photo_id" : "id";
  const row = db
    .prepare(
      `SELECT optimized_storage_key AS optimizedKey, original_storage_key AS originalKey FROM ${table} WHERE ${idColumn}=? AND museum_id=?`,
    )
    .get(id, scope.museumId);
  if (!row) throw new ApiError("PHOTO_NOT_FOUND", 404);
  const optimizedKey = String(row.optimizedKey);
  // Legacy files remain readable only through an owned row; new files must carry matching physical scope.
  if (
    !isMuseumPhotoKey(optimizedKey, scope.museumId) &&
    !new RegExp(`^uploads/(demo|owner)/optimized/${uuid}\\.webp$`).test(optimizedKey)
  )
    throw new ApiError("INVALID_PHOTO_BINDING", 400);
  if (row.originalKey !== null) {
    const key = String(row.originalKey);
    const originalPattern = new RegExp(
      `^uploads/(?:(?:demo|owner)|museums/${uuid})/original/${uuid}\\.(?:jpg|jpeg|png|webp)$`,
    );
    if (
      !originalPattern.test(key) ||
      (key.startsWith("uploads/museums/") &&
        !key.startsWith(`uploads/museums/${scope.museumId}/original/`))
    )
      throw new ApiError("INVALID_PHOTO_BINDING", 400);
  }
  return row;
}

export function archiveScopedPhoto(db: DatabaseSync, scope: MemoryScope, id: string) {
  return withTransaction(db, () => {
    requirePhotoAccess(db, scope, id);
    const photo = db.prepare("SELECT library_archived_at,trashed_at FROM uploaded_photos WHERE id=?").get(id)!;
    if (photo.trashed_at !== null) throw new ApiError("PHOTO_NOT_FOUND", 404);
    const alreadyArchived = readNullableString(photo, "library_archived_at") !== null;
    const result = archiveUploadedPhotoInDatabase(db, id);
    if (!alreadyArchived) {
      writeAuditLogInDatabase(db, {
        actorUserId: scope.userId,
        museumId: scope.museumId,
        action: "photo.archive",
        objectType: "photo",
        objectId: id,
      });
    }
    return result;
  });
}

export function canReadMuseumPhoto(db: DatabaseSync, userId: string | null, key: string) {
  if (!userId) return false;
  const photo = db
    .prepare("SELECT id,museum_id FROM uploaded_photos WHERE optimized_storage_key=?")
    .get(key);
  if (!photo || typeof photo.museum_id !== "string") return false;
  try {
    requirePhotoAccess(db, { userId, museumId: photo.museum_id }, String(photo.id));
    return true;
  } catch {
    return false;
  }
}

export function isPhotoMediaAvailable(db: DatabaseSync, key: string) {
  if (!optimizedPhotoKeyPattern.test(key)) return false;
  const photo = db
    .prepare(
      `SELECT p.museum_id, m.status FROM uploaded_photos p LEFT JOIN museums m ON m.id=p.museum_id WHERE p.optimized_storage_key=? AND p.trashed_at IS NULL`,
    )
    .get(key);
  if (!photo) return false;
  if (photo.museum_id === null) return !key.startsWith("uploads/museums/");
  return (
    photo.status === "active" &&
    (!key.startsWith("uploads/museums/") || isMuseumPhotoKey(key, String(photo.museum_id)))
  );
}
