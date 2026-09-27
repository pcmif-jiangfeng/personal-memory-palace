import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";

export interface MuseumAccess {
  museumId: string;
  userId: string;
  role: "owner" | "collaborator";
  status: "active" | "pending_deletion";
}

/** Checks current database state; this result is not a reusable authorization token. */
export function requireMuseumAccessInDatabase(
  database: DatabaseSync,
  userId: string | null,
  museumId: string,
): MuseumAccess {
  if (!userId) throw new ApiError("USER_REQUIRED", 401);
  const user = database.prepare("SELECT email_verified FROM users WHERE id=?").get(userId);
  if (!user) throw new ApiError("USER_REQUIRED", 401);
  if (user.email_verified !== 1) throw new ApiError("EMAIL_VERIFICATION_REQUIRED", 403);
  const museum = database.prepare(`SELECT m.owner_id, m.status,
    membership.status AS membership_status, membership.role AS membership_role
    FROM museums m LEFT JOIN museum_memberships membership
      ON membership.museum_id=m.id AND membership.user_id=?
    WHERE m.id=?`).get(userId,museumId);
  // Missing and inaccessible Museums share a response, without disclosing their existence.
  if (!museum) throw new ApiError("MUSEUM_NOT_FOUND", 404);
  const role = museum.owner_id === userId ? "owner" : "collaborator";
  if (role === "collaborator" &&
    (museum.membership_status !== "active" || museum.membership_role !== "collaborator"))
    throw new ApiError("MUSEUM_NOT_FOUND", 404);
  // Owners retain lifecycle access while pending; business writes must check returned status.
  if (museum.status !== "active" && !(role === "owner" && museum.status === "pending_deletion"))
    throw new ApiError("MUSEUM_NOT_FOUND", 404);
  return { museumId, userId, role, status: museum.status };
}

export function requireMuseumOwnerInDatabase(database: DatabaseSync, userId: string | null, museumId: string): MuseumAccess {
  const access = requireMuseumAccessInDatabase(database,userId,museumId);
  if (access.role !== "owner") throw new ApiError("MUSEUM_OWNER_REQUIRED", 403);
  return access;
}
