import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { findMuseumByIdInDatabase, type Museum } from "./museum-repository.ts";
import { selectOwnedMuseumInDatabase } from "./museum-owner-selection.ts";
import { withTransaction } from "./transaction.ts";

export function updateOwnMuseumSlugInDatabase(
  database: DatabaseSync,
  ownerId: string,
  slug: string,
  museumId?: string | null,
): Museum {
  return withTransaction(database, () => {
    const museum = selectOwnedMuseumInDatabase(database, ownerId, museumId);
    if (museum.slug === slug) return museum;
    try {
      database
        .prepare(
          "UPDATE museums SET slug = ?, version = version + 1, updated_at = ?, last_edited_by_user_id = ? WHERE id = ? AND owner_id = ?",
        )
        .run(slug, new Date().toISOString(), ownerId, museum.id, ownerId);
    } catch (error) {
      // The case-insensitive unique index protects concurrent updates and legacy slugs.
      if (
        database.prepare("SELECT id FROM museums WHERE slug = ? AND id <> ?").get(slug, museum.id)
      ) {
        throw new ApiError("SLUG_TAKEN", 409);
      }
      throw error;
    }
    return findMuseumByIdInDatabase(database, museum.id)!;
  });
}
