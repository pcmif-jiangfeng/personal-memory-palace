import type { DatabaseSync } from "node:sqlite";
import { requireMuseumAccessInDatabase, type MuseumAccess } from "./museum-access.ts";
import { ApiError } from "../http/errors.ts";

export type MemoryOperation = "read" | "update" | "trash" | "restore" | "permanent";

// Mutations must call this inside the same transaction as the resource write.
export function requireMemoryAccessInDatabase(
  database: DatabaseSync,
  userId: string | null,
  museumId: string,
  memoryId: string,
  operation: MemoryOperation,
): MuseumAccess {
  const access = requireMuseumAccessInDatabase(database, userId, museumId);
  if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
  const memory = database
    .prepare("SELECT trashed_at FROM memories WHERE id = ? AND museum_id = ?")
    .get(memoryId, museumId);
  const requiresTrashed = operation === "restore" || operation === "permanent";
  if (!memory || (memory.trashed_at !== null) !== requiresTrashed)
    throw new ApiError("MEMORY_NOT_FOUND", 404);
  if (operation === "permanent" && access.role !== "owner")
    throw new ApiError("MUSEUM_OWNER_REQUIRED", 403);
  return access;
}
