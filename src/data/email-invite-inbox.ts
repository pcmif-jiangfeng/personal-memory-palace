import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { readString, readNumber } from "./row-readers.ts";
import { withTransaction } from "./transaction.ts";

export interface ReceivedEmailInvite {
  id: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  museum: { id: string; name: string; museumType: "private" | "shared" };
}

export function readEmailInviteInboxInDatabase(
  database: DatabaseSync,
  userId: string | null,
  page: number,
  inviteId?: string | null,
) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 999999)
    throw new ApiError("INVALID_PAGE", 400);
  if (
    inviteId != null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inviteId)
  )
    throw new ApiError("INVALID_INVITE_ID", 400);
  return withTransaction(database, () => {
    if (!userId) throw new ApiError("USER_REQUIRED", 401);
    const user = database.prepare("SELECT email,email_verified FROM users WHERE id=?").get(userId);
    if (!user) throw new ApiError("USER_REQUIRED", 401);
    if (user.email_verified !== 1) throw new ApiError("EMAIL_VERIFICATION_REQUIRED", 403);
    const email = readString(user, "email").trim().toLowerCase();
    const now = new Date().toISOString();
    const scope =
      "FROM collaboration_invites i JOIN museums m ON m.id=i.museum_id WHERE i.target_email=? AND m.status='active' AND (? IS NULL OR i.id=?)";
    const rows = database
      .prepare(
        `SELECT i.id,i.status,i.expires_at,m.id AS museum_id,m.name,m.museum_type ${scope} ORDER BY i.created_at DESC,i.id DESC LIMIT 20 OFFSET ?`,
      )
      .all(email, inviteId ?? null, inviteId ?? null, (page - 1) * 20);
    const total = readNumber(
      database
        .prepare(`SELECT COUNT(*) AS n ${scope}`)
        .get(email, inviteId ?? null, inviteId ?? null)!,
      "n",
    );
    const invites = rows.map((row): ReceivedEmailInvite => {
      const status = readString(row, "status");
      const museumType = readString(row, "museum_type");
      if (
        status !== "pending" &&
        status !== "accepted" &&
        status !== "revoked" &&
        status !== "expired"
      )
        throw new TypeError("Invalid invitation status");
      if (museumType !== "private" && museumType !== "shared")
        throw new TypeError("Invalid palace type");
      const expiresAt = readString(row, "expires_at");
      return {
        id: readString(row, "id"),
        status: status === "pending" && expiresAt <= now ? "expired" : status,
        expiresAt,
        museum: { id: readString(row, "museum_id"), name: readString(row, "name"), museumType },
      };
    });
    return { invites, total, page, pageSize: 20 };
  });
}
