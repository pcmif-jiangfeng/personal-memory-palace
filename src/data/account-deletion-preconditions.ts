import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { readNumber, readString } from "./row-readers.ts";
import { withTransaction } from "./transaction.ts";

export const accountDeletionPageSize = 25;

/** Advisory snapshot only. A future deletion write must recheck inside its own transaction. */
export function checkAccountDeletionPreconditionsInDatabase(
  database: DatabaseSync,
  userId: string | null,
  page = 1,
) {
  return withTransaction(database, () => {
    if (!userId) throw new ApiError("USER_REQUIRED", 401);
    const user = database.prepare("SELECT email_verified FROM users WHERE id=?").get(userId);
    if (!user) throw new ApiError("USER_REQUIRED", 401);
    if (user.email_verified !== 1) throw new ApiError("EMAIL_VERIFICATION_REQUIRED", 403);
    if (!Number.isInteger(page) || page < 1 || page > 999999)
      throw new ApiError("INVALID_DELETION_PAGE", 400);
    const totals = database
      .prepare(
        `SELECT COUNT(*) AS owned_total,
      COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM museum_memberships membership
        WHERE membership.museum_id=m.id AND membership.user_id<>m.owner_id
        AND membership.role='collaborator' AND membership.status='active') THEN 1 ELSE 0 END),0) AS blocked_total
      FROM museums m WHERE m.owner_id=?`,
      )
      .get(userId)!;
    const blockedMuseumCount = readNumber(totals, "blocked_total");
    const ownedMuseumCount = readNumber(totals, "owned_total");
    const museums = database
      .prepare(
        `SELECT m.id,m.name,m.slug,m.status,
      (SELECT COUNT(*) FROM museum_memberships membership WHERE membership.museum_id=m.id
        AND membership.user_id<>m.owner_id AND membership.role='collaborator' AND membership.status='active') AS collaborator_count
      FROM museums m WHERE m.owner_id=? ORDER BY m.created_at,m.id LIMIT ? OFFSET ?`,
      )
      .all(userId, accountDeletionPageSize, (page - 1) * accountDeletionPageSize)
      .map((row) => ({
        id: readString(row, "id"),
        name: readString(row, "name"),
        slug: readString(row, "slug"),
        status: readString(row, "status"),
        collaboratorCount: readNumber(row, "collaborator_count"),
      }));
    return {
      canEnterDeletionFlow: blockedMuseumCount === 0,
      reason: blockedMuseumCount === 0 ? null : ("TRANSFER_OWNERSHIP_REQUIRED" as const),
      ownedMuseumCount,
      blockedMuseumCount,
      museums,
      page,
      pageSize: accountDeletionPageSize,
    };
  });
}
