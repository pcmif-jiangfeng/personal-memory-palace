import type { DatabaseSync } from "node:sqlite";
import type { MemoryScope } from "./scoped-memory.ts";
import { requireMemoryAccessInDatabase } from "./memory-access.ts";
import { withTransaction } from "./transaction.ts";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { LATER_NOTE_MAX_LENGTH } from "../domain/rules.ts";
import { ApiError } from "../http/errors.ts";
import { listLaterNotesInDatabase } from "./memory-repository.ts";
import { redactObjectAuditInDatabase } from "./audit-content-redaction.ts";

export function listScopedTrashedLaterNotes(
  db: DatabaseSync,
  scope: MemoryScope,
  memoryId: string,
) {
  requireMemoryAccessInDatabase(db, scope.userId, scope.museumId, memoryId, "read");
  return listLaterNotesInDatabase(db, memoryId, scope.museumId, true);
}

export type LaterNoteAction =
  | { action: "update"; content: string; version: number }
  | { action: "trash" | "restore" }
  | { action: "permanent"; confirm: boolean };

export function manageScopedLaterNote(
  db: DatabaseSync,
  scope: MemoryScope,
  id: string,
  input: LaterNoteAction,
) {
  return withTransaction(db, () => {
    const note = db
      .prepare(
        "SELECT memory_id,author_user_id,trashed_at,version FROM later_notes WHERE id=? AND museum_id=?",
      )
      .get(id, scope.museumId);
    if (!note) throw new ApiError("LATER_NOTE_NOT_FOUND", 404);
    const access = requireMemoryAccessInDatabase(
      db,
      scope.userId,
      scope.museumId,
      String(note.memory_id),
      "read",
    );
    const author = note.author_user_id === scope.userId;
    if (
      input.action === "update"
        ? !author
        : input.action === "permanent"
          ? access.role !== "owner"
          : !author && access.role !== "owner"
    )
      throw new ApiError("LATER_NOTE_FORBIDDEN", 403);
    const needsTrashed = input.action === "restore" || input.action === "permanent";
    if ((note.trashed_at !== null) !== needsTrashed)
      throw new ApiError("LATER_NOTE_NOT_FOUND", 404);
    const timestamp = new Date().toISOString();
    switch (input.action) {
      case "update": {
        const content = input.content.trim();
        if (!content || content.length > LATER_NOTE_MAX_LENGTH)
          throw new ApiError("INVALID_LATER_NOTE_CONTENT", 400);
        if (!Number.isSafeInteger(input.version) || input.version < 1)
          throw new ApiError("INVALID_LATER_NOTE_VERSION", 400);
        const saved = db
          .prepare(
            "UPDATE later_notes SET content=?,updated_at=?,version=version+1 WHERE id=? AND museum_id=? AND version=?",
          )
          .run(content, timestamp, id, scope.museumId, input.version);
        if (!saved.changes) throw new ApiError("LATER_NOTE_VERSION_CONFLICT", 409);
        break;
      }
      case "trash":
        db.prepare(
          "UPDATE later_notes SET trashed_at=?,updated_at=?,version=version+1 WHERE id=? AND museum_id=?",
        ).run(timestamp, timestamp, id, scope.museumId);
        break;
      case "restore":
        db.prepare(
          "UPDATE later_notes SET trashed_at=NULL,updated_at=?,version=version+1 WHERE id=? AND museum_id=?",
        ).run(timestamp, id, scope.museumId);
        break;
      case "permanent":
        if (input.confirm !== true) throw new ApiError("LATER_NOTE_CONFIRMATION_REQUIRED", 400);
        redactObjectAuditInDatabase(db, scope.museumId, "laterNote", id);
        db.prepare("DELETE FROM later_notes WHERE id=? AND museum_id=?").run(id, scope.museumId);
        break;
    }
    db.prepare(
      "UPDATE memories SET version=version+1,updated_at=?,last_edited_by_user_id=? WHERE id=? AND museum_id=?",
    ).run(timestamp, scope.userId, String(note.memory_id), scope.museumId);
    writeAuditLogInDatabase(db, {
      actorUserId: scope.userId,
      museumId: scope.museumId,
      action: `laterNote.${input.action}`,
      objectType: "laterNote",
      objectId: id,
    });
    return input.action === "permanent" ? null : Number(note.version) + 1;
  });
}
