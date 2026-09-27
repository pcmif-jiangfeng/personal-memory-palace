import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { createMuseumInDatabase, findMuseumByOwnerIdInDatabase, type Museum } from "./museum-repository.ts";

export function createOwnMuseumInDatabase(
  database: DatabaseSync,
  ownerId: string,
  input: { name: string; slug: string; description: string },
): Museum {
  if (findMuseumByOwnerIdInDatabase(database, ownerId)) {
    throw new ApiError("MUSEUM_ALREADY_EXISTS", 409);
  }
  try {
    return createMuseumInDatabase(database, { ownerId, ...input });
  } catch (error) {
    // Unique indexes remain authoritative when concurrent requests race.
    if (findMuseumByOwnerIdInDatabase(database, ownerId)) {
      throw new ApiError("MUSEUM_ALREADY_EXISTS", 409);
    }
    if (database.prepare("SELECT id FROM museums WHERE slug = ?").get(input.slug)) {
      throw new ApiError("SLUG_TAKEN", 409);
    }
    throw error;
  }
}
