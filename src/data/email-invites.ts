import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { requireMuseumOwnerInDatabase } from "./museum-access.ts";
import { readNullableString, readNumber, readString } from "./row-readers.ts";
import { withTransaction } from "./transaction.ts";

export interface EmailInviteSummary {
  id: string;
  targetEmail: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

function activeOwner(database: DatabaseSync, ownerId: string, museumId: string) {
  if (requireMuseumOwnerInDatabase(database, ownerId, museumId).status !== "active")
    throw new ApiError("MUSEUM_NOT_FOUND", 404);
}

function summary(row: Record<string, unknown>, now: string): EmailInviteSummary {
  const storedStatus = readString(row, "status");
  if (!["pending", "accepted", "revoked", "expired"].includes(storedStatus))
    throw new TypeError("Invalid invitation status");
  const expiresAt = readString(row, "expires_at");
  // Expiry is effective even if no writer has materialized the expired state yet.
  const status = storedStatus === "pending" && expiresAt <= now ? "expired" : storedStatus;
  return {
    id: readString(row, "id"),
    targetEmail: readString(row, "target_email"),
    status: status as EmailInviteSummary["status"],
    createdAt: readString(row, "created_at"),
    expiresAt,
    acceptedAt: readNullableString(row, "accepted_at"),
    revokedAt: readNullableString(row, "revoked_at"),
  };
}

export function createEmailInviteInDatabase(
  database: DatabaseSync,
  ownerId: string,
  museumId: string,
  targetEmail: string,
) {
  if (typeof targetEmail !== "string") throw new ApiError("INVALID_EMAIL", 400);
  const email = targetEmail.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new ApiError("INVALID_EMAIL", 400);
  return withTransaction(database, () => {
    activeOwner(database, ownerId, museumId);
    const existingMember = database
      .prepare(
        `SELECT u.id FROM users u JOIN museums m ON m.id=?
      LEFT JOIN museum_memberships mm ON mm.museum_id=m.id AND mm.user_id=u.id
      WHERE u.email=? AND (u.id=m.owner_id OR (mm.status='active' AND mm.role='collaborator'))`,
      )
      .get(museumId, email);
    if (existingMember) throw new ApiError("ALREADY_MUSEUM_MEMBER", 409);
    const now = new Date().toISOString();
    database
      .prepare(
        "UPDATE collaboration_invites SET status='expired' WHERE museum_id=? AND target_email=? AND status='pending' AND expires_at<=?",
      )
      .run(museumId, email, now);
    const current = database
      .prepare(
        "SELECT * FROM collaboration_invites WHERE museum_id=? AND target_email=? AND status='pending'",
      )
      .get(museumId, email);
    if (current) return { invite: summary(current, now), created: false };
    const id = randomUUID();
    const expiresAt = new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString();
    database
      .prepare(
        "INSERT INTO collaboration_invites(id,museum_id,target_email,created_at,expires_at) VALUES (?,?,?,?,?)",
      )
      .run(id, museumId, email, now, expiresAt);
    writeAuditLogInDatabase(database, {
      actorUserId: ownerId,
      museumId,
      action: "invite.create",
      objectType: "invite",
      objectId: id,
      diff: { expiresAt },
    });
    return {
      invite: summary(
        database.prepare("SELECT * FROM collaboration_invites WHERE id=?").get(id)!,
        now,
      ),
      created: true,
    };
  });
}

export function listEmailInvitesInDatabase(
  database: DatabaseSync,
  ownerId: string,
  museumId: string,
  page: number,
) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 999999)
    throw new ApiError("INVALID_PAGE", 400);
  return withTransaction(database, () => {
    activeOwner(database, ownerId, museumId);
    const now = new Date().toISOString();
    const rows = database
      .prepare(
        "SELECT * FROM collaboration_invites WHERE museum_id=? ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?",
      )
      .all(museumId, (page - 1) * 20);
    const total = readNumber(
      database
        .prepare("SELECT COUNT(*) AS n FROM collaboration_invites WHERE museum_id=?")
        .get(museumId)!,
      "n",
    );
    return { invites: rows.map((row) => summary(row, now)), total, page, pageSize: 20 };
  });
}

export function revokeEmailInviteInDatabase(
  database: DatabaseSync,
  ownerId: string,
  museumId: string,
  id: string,
) {
  return withTransaction(database, () => {
    activeOwner(database, ownerId, museumId);
    const row = database
      .prepare("SELECT * FROM collaboration_invites WHERE museum_id=? AND id=?")
      .get(museumId, id);
    if (!row) throw new ApiError("INVITE_NOT_FOUND", 404);
    const now = new Date().toISOString();
    const invite = summary(row, now);
    if (invite.status === "accepted") throw new ApiError("INVITE_ALREADY_ACCEPTED", 409);
    if (invite.status !== "pending") return invite;
    database
      .prepare("UPDATE collaboration_invites SET status='revoked',revoked_at=? WHERE id=?")
      .run(now, id);
    writeAuditLogInDatabase(database, {
      actorUserId: ownerId,
      museumId,
      action: "invite.revoke",
      objectType: "invite",
      objectId: id,
    });
    return summary(
      database.prepare("SELECT * FROM collaboration_invites WHERE id=?").get(id)!,
      now,
    );
  });
}
