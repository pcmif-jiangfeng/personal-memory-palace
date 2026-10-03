import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { queueCollaborationNotificationInDatabase } from "./museum-notifications.ts";
import { readString } from "./row-readers.ts";
import { withTransaction } from "./transaction.ts";

export function acceptEmailInviteInDatabase(
  database: DatabaseSync,
  userId: string | null,
  inviteId: string,
) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inviteId))
    throw new ApiError("INVALID_INVITE_ID", 400);
  return withTransaction(database, () => {
    if (!userId) throw new ApiError("USER_REQUIRED", 401);
    const user = database.prepare("SELECT email,email_verified FROM users WHERE id=?").get(userId);
    if (!user) throw new ApiError("USER_REQUIRED", 401);
    if (user.email_verified !== 1) throw new ApiError("EMAIL_VERIFICATION_REQUIRED", 403);
    const invite = database
      .prepare(
        `SELECT i.id,i.museum_id,i.status AS invite_status,i.expires_at,
      m.owner_id,m.name,m.slug,m.status AS museum_status
      FROM collaboration_invites i JOIN museums m ON m.id=i.museum_id
      WHERE i.id=? AND i.target_email=?`,
      )
      .get(inviteId, readString(user, "email").trim().toLowerCase());
    // Wrong recipients must not learn the palace identity from a forwarded locator.
    if (!invite) throw new ApiError("INVITE_NOT_FOUND", 404);
    if (invite.museum_status !== "active") throw new ApiError("INVITE_UNAVAILABLE", 410);
    const museum = {
      id: readString(invite, "museum_id"),
      name: readString(invite, "name"),
      slug: readString(invite, "slug"),
    };
    const membership = database
      .prepare("SELECT status FROM museum_memberships WHERE museum_id=? AND user_id=?")
      .get(museum.id, userId);
    if (invite.invite_status === "accepted") {
      // Retry a lost success response, but never re-enable a departed member using consumed invitations.
      if (membership?.status === "active" || invite.owner_id === userId)
        return { museum, alreadyMember: true };
      throw new ApiError("INVITE_UNAVAILABLE", 410);
    }
    const now = new Date().toISOString();
    if (invite.invite_status !== "pending" || readString(invite, "expires_at") <= now)
      throw new ApiError("INVITE_UNAVAILABLE", 410);
    if (invite.owner_id === userId || membership?.status === "active")
      throw new ApiError("ALREADY_MUSEUM_MEMBER", 409);
    database
      .prepare(
        `INSERT INTO museum_memberships(museum_id,user_id,role,status,created_at,updated_at)
      VALUES (?,?,'collaborator','active',?,?) ON CONFLICT(museum_id,user_id)
      DO UPDATE SET role='collaborator',status='active',updated_at=excluded.updated_at`,
      )
      .run(museum.id, userId, now, now);
    database
      .prepare("UPDATE collaboration_invites SET status='accepted',accepted_at=? WHERE id=?")
      .run(now, inviteId);
    const event = writeAuditLogInDatabase(database, {
      actorUserId: userId,
      museumId: museum.id,
      action: "membership.join",
      objectType: "membership",
      objectId: userId,
      diff: {
        inviteId,
        status: { before: membership ? readString(membership, "status") : null, after: "active" },
      },
    });
    queueCollaborationNotificationInDatabase(database, event.id, museum.id, "join", userId);
    return { museum, alreadyMember: false };
  });
}
