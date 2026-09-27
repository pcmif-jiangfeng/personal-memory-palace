import type { DatabaseSync } from "node:sqlite";
import type { MemoryScope } from "./scoped-memory.ts";
import { requireMemoryAccessInDatabase } from "./memory-access.ts";
import {
  configureShareInDatabase,
  disableShareInDatabase,
  type ShareMode,
} from "./share-repository.ts";
import { withTransaction } from "./transaction.ts";
import { ApiError } from "../http/errors.ts";

export function configureScopedShare(
  db: DatabaseSync,
  scope: MemoryScope,
  memoryId: string,
  input: { enabled: boolean; mode: ShareMode; password?: string; rotate?: boolean },
) {
  return withTransaction(db, () => {
    const access = requireMemoryAccessInDatabase(
      db,
      scope.userId,
      scope.museumId,
      memoryId,
      "update",
    );
    if (access.role !== "owner") throw new ApiError("MUSEUM_OWNER_REQUIRED", 403);
    const existing = db
      .prepare("SELECT museum_id FROM share_configs WHERE memory_id=?")
      .get(memoryId);
    if (existing && existing.museum_id !== scope.museumId)
      throw new ApiError("INVALID_SHARE_BINDING", 400);
    if (!input.enabled) {
      disableShareInDatabase(db, memoryId);
      db.prepare("UPDATE memories SET last_edited_by_user_id=?, version=version+1 WHERE id=?").run(
        scope.userId,
        memoryId,
      );
      return null;
    }
    const token = configureShareInDatabase(db, memoryId, input.mode, input.password, input.rotate);
    db.prepare("UPDATE memories SET last_edited_by_user_id=?, version=version+1 WHERE id=?").run(
      scope.userId,
      memoryId,
    );
    return token;
  });
}
