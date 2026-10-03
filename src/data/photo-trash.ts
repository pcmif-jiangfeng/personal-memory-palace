import type { DatabaseSync } from "node:sqlite";
import type { MemoryScope } from "./scoped-memory.ts";
import { requirePhotoAccess, requirePhotoMuseum } from "./photo-access.ts";
import { withTransaction } from "./transaction.ts";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { ApiError } from "../http/errors.ts";

export function listScopedTrashedPhotos(db: DatabaseSync, scope: MemoryScope) {
  requirePhotoMuseum(db, scope);
  return db
    .prepare(
      "SELECT id,original_name FROM uploaded_photos WHERE museum_id=? AND trashed_at IS NOT NULL ORDER BY trashed_at DESC,id",
    )
    .all(scope.museumId)
    .map((row) => ({ id: String(row.id), title: String(row.original_name) }));
}

export function trashScopedPhotos(db: DatabaseSync, scope: MemoryScope, ids: string[]) {
  requirePhotoMuseum(db, scope);
  const result: { deletedIds: string[]; failures: { photoId: string; error: string }[] } = {
    deletedIds: [],
    failures: [],
  };
  for (const id of new Set(ids)) {
    try {
      manageScopedPhotoTrash(db, scope, id, "trash");
      result.deletedIds.push(id);
    } catch (error) {
      result.failures.push({
        photoId: id,
        error: error instanceof ApiError ? error.code : "PHOTO_OPERATION_FAILED",
      });
    }
  }
  return result;
}

export function manageScopedPhotoTrash(
  db: DatabaseSync,
  scope: MemoryScope,
  id: string,
  action: "trash" | "restore",
) {
  return withTransaction(db, () => {
    const photo = requirePhotoAccess(db, scope, id);
    const pending = db
      .prepare(
        `SELECT 1 FROM photo_deletion_jobs
      WHERE photo_id=? OR optimized_storage_key=? OR original_storage_key=?`,
      )
      .get(id, photo.optimizedKey, photo.originalKey);
    if (pending) throw new ApiError("PHOTO_CLEANUP_PENDING", 409);
    const row = db
      .prepare("SELECT trashed_at FROM uploaded_photos WHERE id=? AND museum_id=?")
      .get(id, scope.museumId)!;
    if ((row.trashed_at !== null) !== (action === "restore"))
      throw new ApiError("PHOTO_NOT_FOUND", 404);
    // Preserve references, physical files, archive status and the quota ledger until permanent cleanup.
    db.prepare("UPDATE uploaded_photos SET trashed_at=? WHERE id=? AND museum_id=?").run(
      action === "trash" ? new Date().toISOString() : null,
      id,
      scope.museumId,
    );
    writeAuditLogInDatabase(db, {
      actorUserId: scope.userId,
      museumId: scope.museumId,
      action: `photo.${action}`,
      objectType: "photo",
      objectId: id,
    });
  });
}
