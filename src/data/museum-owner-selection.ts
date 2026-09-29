import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { requireMuseumOwnerInDatabase } from "./museum-access.ts";
import { findMuseumByIdInDatabase, findMuseumByOwnerIdInDatabase } from "./museum-repository.ts";

/** Writes must name their Museum when the account owns more than one. */
export function selectOwnedMuseumInDatabase(
  database: DatabaseSync,
  userId: string,
  museumId?: string | null,
) {
  if (museumId == null) {
    const count = database
      .prepare("SELECT COUNT(*) AS n FROM museums WHERE owner_id=?")
      .get(userId)!.n;
    if (Number(count) > 1) throw new ApiError("MUSEUM_SELECTION_REQUIRED", 409);
    museumId = findMuseumByOwnerIdInDatabase(database, userId)?.id;
  }
  if (!museumId) throw new ApiError("MUSEUM_NOT_FOUND", 404);
  const access = requireMuseumOwnerInDatabase(database, userId, museumId);
  if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
  return findMuseumByIdInDatabase(database, museumId)!;
}
