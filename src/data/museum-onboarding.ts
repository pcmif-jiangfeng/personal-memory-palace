import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import {
  createMuseumInDatabase,
  findMuseumByOwnerIdInDatabase,
  type Museum,
  type MuseumType,
} from "./museum-repository.ts";
import { withTransaction } from "./transaction.ts";

export function createOwnMuseumInDatabase(
  database: DatabaseSync,
  ownerId: string,
  input: { name: string; slug: string; description: string; museumType?: MuseumType },
): Museum {
  return withTransaction(database, () => {
    const user = database.prepare("SELECT email_verified FROM users WHERE id=?").get(ownerId);
    if (!user) throw new ApiError("USER_REQUIRED", 401);
    if (user.email_verified !== 1) throw new ApiError("EMAIL_VERIFICATION_REQUIRED", 403);
    const museumType = input.museumType ?? "private";
    if (museumType !== "private" && museumType !== "shared") throw new ApiError("INVALID_MUSEUM_TYPE", 400);
    if (museumType === "private" && findMuseumByOwnerIdInDatabase(database, ownerId)) {
      throw new ApiError("MUSEUM_ALREADY_EXISTS", 409);
    }
    try {
      return createMuseumInDatabase(database, { ownerId, name: input.name, slug: input.slug, description: input.description, museumType });
    } catch (error) {
      // The transaction serializes first-Museum creation; slug uniqueness remains authoritative.
      if (museumType === "private" && findMuseumByOwnerIdInDatabase(database, ownerId)) {
        throw new ApiError("MUSEUM_ALREADY_EXISTS", 409);
      }
      if (database.prepare("SELECT id FROM museums WHERE slug = ?").get(input.slug)) {
        throw new ApiError("SLUG_TAKEN", 409);
      }
      throw error;
    }
  });
}
