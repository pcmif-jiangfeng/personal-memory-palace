import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { readString } from "./row-readers.ts";
import { ApiError } from "../http/errors.ts";
import { findMuseumByOwnerIdInDatabase } from "./museum-repository.ts";
import { withTransaction } from "./transaction.ts";

export function acceptInviteInDatabase(database: DatabaseSync, userId: string, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError("INVALID_INVITE_TOKEN", 400);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  // Serialize validity checks and both writes so one remaining use cannot admit two users.
  return withTransaction(database, () => {
    const user = database.prepare("SELECT email_verified FROM users WHERE id=?").get(userId);
    if (!user) throw new ApiError("USER_REQUIRED", 401);
    if (user.email_verified !== 1) throw new ApiError("EMAIL_VERIFICATION_REQUIRED", 403);
    if (!findMuseumByOwnerIdInDatabase(database, userId)) throw new ApiError("OWN_MUSEUM_REQUIRED", 403);
    const invite = database.prepare(`SELECT i.id, i.museum_id, i.revoked_at, i.expires_at,
      i.usage_count, i.max_uses, m.owner_id, m.name, m.slug, m.status
      FROM invite_links i JOIN museums m ON m.id=i.museum_id WHERE i.token_hash=?`).get(tokenHash);
    const now = new Date().toISOString();
    if (!invite || invite.status !== "active" || invite.revoked_at !== null ||
      (typeof invite.expires_at === "string" && invite.expires_at <= now))
      throw new ApiError("INVITE_UNAVAILABLE", 410);
    if (invite.owner_id === userId) throw new ApiError("OWN_INVITE", 409);
    const museum = { id: invite.museum_id as string, name: invite.name as string, slug: invite.slug as string };
    const membership = database.prepare("SELECT status FROM museum_memberships WHERE museum_id=? AND user_id=?").get(museum.id, userId);
    // A lost success response may be retried even after a single-use link is exhausted.
    if (membership?.status === "active") return { museum, alreadyMember: true };
    if (invite.max_uses !== null && (invite.usage_count as number) >= (invite.max_uses as number))
      throw new ApiError("INVITE_UNAVAILABLE", 410);
    database.prepare(`INSERT INTO museum_memberships (museum_id,user_id,role,status,created_at,updated_at)
      VALUES (?,?,'collaborator','active',?,?) ON CONFLICT(museum_id,user_id)
      DO UPDATE SET status='active', updated_at=excluded.updated_at`).run(museum.id, userId, now, now);
    database.prepare("UPDATE invite_links SET usage_count=usage_count+1 WHERE id=?").run(invite.id);
    writeAuditLogInDatabase(database, {
      actorUserId: userId,
      museumId: museum.id,
      action: "membership.join",
      objectType: "membership",
      // Membership is identified by museum + user; the audit row already carries museumId.
      objectId: userId,
      diff: {
        inviteId: readString(invite, "id"),
        status: { before: membership ? readString(membership, "status") : null, after: "active" },
      },
    });
    return { museum, alreadyMember: false };
  });
}
