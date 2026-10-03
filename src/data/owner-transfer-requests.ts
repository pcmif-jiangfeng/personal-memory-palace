import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { requireMuseumAccessInDatabase, requireMuseumOwnerInDatabase } from "./museum-access.ts";
import { withTransaction } from "./transaction.ts";
import { readString, readNumber } from "./row-readers.ts";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { queueCollaborationNotificationInDatabase } from "./museum-notifications.ts";

const transferDurationMs = 7 * 24 * 60 * 60 * 1000;

function requireSharedActive(db: DatabaseSync, userId: string | null, museumId: string) {
  const access = requireMuseumAccessInDatabase(db, userId, museumId);
  if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
  const museum = db
    .prepare("SELECT museum_type,owner_id,version FROM museums WHERE id=?")
    .get(museumId)!;
  if (museum.museum_type !== "shared") throw new ApiError("PRIVATE_PALACE_TRANSFER_DISABLED", 410);
  return { access, museum };
}

function requireTarget(db: DatabaseSync, museumId: string, targetId: string) {
  const row = db
    .prepare(
      `SELECT u.id FROM museum_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.museum_id=? AND m.user_id=? AND m.status='active' AND m.role='collaborator' AND u.email_verified=1`,
    )
    .get(museumId, targetId);
  if (!row) throw new ApiError("TRANSFER_TARGET_UNAVAILABLE", 409);
}

export function invalidateOwnerTransfersInDatabase(
  db: DatabaseSync,
  museumId: string,
  targetId?: string,
) {
  if (!db.isTransaction) throw new Error("Transfer invalidation requires a transaction");
  db.prepare(
    `UPDATE owner_transfer_requests SET status='invalidated',resolved_at=?
    WHERE museum_id=? AND status='pending' ${targetId === undefined ? "" : "AND target_user_id=?"}`,
  ).run(new Date().toISOString(), museumId, ...(targetId === undefined ? [] : [targetId]));
}

export function createOwnerTransferRequestInDatabase(
  db: DatabaseSync,
  userId: string | null,
  museumId: string,
  input: { confirm: true; targetUserId: string; version: number },
) {
  return withTransaction(db, () => {
    const { access, museum } = requireSharedActive(db, userId, museumId);
    requireMuseumOwnerInDatabase(db, userId, museumId);
    if (input.confirm !== true) throw new ApiError("TRANSFER_CONFIRMATION_REQUIRED", 400);
    if (!Number.isSafeInteger(input.version) || input.version < 1)
      throw new ApiError("INVALID_MUSEUM_VERSION", 400);
    if (museum.version !== input.version) throw new ApiError("MUSEUM_VERSION_CONFLICT", 409);
    if (typeof input.targetUserId !== "string" || input.targetUserId === access.userId)
      throw new ApiError("INVALID_TRANSFER_TARGET", 400);
    requireTarget(db, museumId, input.targetUserId);
    const now = new Date();
    db.prepare(
      "UPDATE owner_transfer_requests SET status='expired',resolved_at=? WHERE museum_id=? AND status='pending' AND expires_at<=?",
    ).run(now.toISOString(), museumId, now.toISOString());
    if (
      db
        .prepare("SELECT id FROM owner_transfer_requests WHERE museum_id=? AND status='pending'")
        .get(museumId)
    )
      throw new ApiError("TRANSFER_ALREADY_PENDING", 409);
    const request = {
      id: randomUUID(),
      museumId,
      ownerUserId: access.userId,
      targetUserId: input.targetUserId,
      status: "pending" as const,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + transferDurationMs).toISOString(),
    };
    db.prepare(
      "INSERT INTO owner_transfer_requests(id,museum_id,owner_user_id,target_user_id,status,created_at,expires_at) VALUES (?,?,?,?,'pending',?,?)",
    ).run(
      request.id,
      museumId,
      access.userId,
      input.targetUserId,
      request.createdAt,
      request.expiresAt,
    );
    writeAuditLogInDatabase(db, {
      actorUserId: access.userId,
      museumId,
      action: "museum.transferRequested",
      objectType: "museum",
      objectId: museumId,
    });
    return request;
  });
}

function requireRecipientQuota(db: DatabaseSync, targetId: string, museumId: string) {
  // Upload reservations and ownership acceptance serialize on the same BEGIN IMMEDIATE.
  const quota = db.prepare("SELECT storage_quota_bytes FROM users WHERE id=?").get(targetId)!;
  if (quota.storage_quota_bytes === null) throw new ApiError("ACCOUNT_QUOTA_NOT_READY", 503);
  const usage = db
    .prepare(
      `SELECT COALESCE(SUM(storage_used_bytes),0) bytes,MIN(storage_usage_ready) ready
    FROM museums WHERE owner_id=? OR id=?`,
    )
    .get(targetId, museumId)!;
  if (usage.ready !== 1) throw new ApiError("STORAGE_USAGE_NOT_READY", 503);
  const reserved = db
    .prepare(
      `SELECT COALESCE(SUM(a.bytes),0) bytes FROM photo_asset_usage a JOIN museums m ON m.id=a.museum_id
    WHERE a.state='reserved' AND (m.owner_id=? OR m.id=?)`,
    )
    .get(targetId, museumId)!;
  const values = [
    readNumber(quota, "storage_quota_bytes"),
    readNumber(usage, "bytes"),
    readNumber(reserved, "bytes"),
  ];
  if (values.some((bytes) => !Number.isSafeInteger(bytes) || bytes < 0))
    throw new Error("Invalid photo byte accounting");
  if (values[1] > values[0] - values[2]) throw new ApiError("STORAGE_QUOTA_EXCEEDED", 507);
}

export function resolveOwnerTransferRequestInDatabase(
  db: DatabaseSync,
  userId: string | null,
  museumId: string,
  input: { requestId: string; action: "accept" | "reject" | "cancel"; confirm: true },
) {
  return withTransaction(db, () => {
    const { access, museum } = requireSharedActive(db, userId, museumId);
    if (input.confirm !== true) throw new ApiError("TRANSFER_CONFIRMATION_REQUIRED", 400);
    if (!["accept", "reject", "cancel"].includes(input.action))
      throw new ApiError("INVALID_TRANSFER_ACTION", 400);
    const row = db
      .prepare("SELECT * FROM owner_transfer_requests WHERE id=? AND museum_id=?")
      .get(input.requestId, museumId);
    if (!row) throw new ApiError("TRANSFER_NOT_FOUND", 404);
    const isOwner = access.role === "owner" && row.owner_user_id === access.userId;
    const isRecipient = access.role === "collaborator" && row.target_user_id === access.userId;
    if (input.action === "cancel" ? !isOwner : !isRecipient)
      throw new ApiError("TRANSFER_NOT_FOUND", 404);
    if (row.status !== "pending") throw new ApiError("TRANSFER_NOT_PENDING", 409);
    const now = new Date().toISOString();
    if (readString(row, "expires_at") <= now) throw new ApiError("TRANSFER_EXPIRED", 410);
    if (row.owner_user_id !== museum.owner_id) throw new ApiError("TRANSFER_NOT_PENDING", 409);
    requireTarget(db, museumId, readString(row, "target_user_id"));
    const status =
      input.action === "accept" ? "accepted" : input.action === "reject" ? "rejected" : "cancelled";
    if (input.action === "accept") {
      requireRecipientQuota(db, access.userId, museumId);
      const previousOwner = readString(row, "owner_user_id");
      const result = db
        .prepare(
          "UPDATE museums SET owner_id=?,version=version+1,updated_at=?,last_edited_by_user_id=? WHERE id=? AND owner_id=? AND status='active'",
        )
        .run(access.userId, now, access.userId, museumId, previousOwner);
      if (result.changes !== 1) throw new ApiError("TRANSFER_NOT_PENDING", 409);
      db.prepare("DELETE FROM museum_memberships WHERE museum_id=? AND user_id=?").run(
        museumId,
        access.userId,
      );
      db.prepare(
        `INSERT INTO museum_memberships(museum_id,user_id,role,status,created_at,updated_at) VALUES (?,?,'collaborator','active',?,?)
        ON CONFLICT(museum_id,user_id) DO UPDATE SET role='collaborator',status='active',updated_at=excluded.updated_at`,
      ).run(museumId, previousOwner, now, now);
      db.prepare(
        "UPDATE museum_support_access SET revoked_at=? WHERE museum_id=? AND revoked_at IS NULL",
      ).run(now, museumId);
      const event = writeAuditLogInDatabase(db, {
        actorUserId: access.userId,
        museumId,
        action: "museum.ownerTransfer",
        objectType: "museum",
        objectId: museumId,
        diff: {
          ownerId: { before: previousOwner, after: access.userId },
          oldOwnerDisposition: "stay",
        },
      });
      queueCollaborationNotificationInDatabase(
        db,
        event.id,
        museumId,
        "ownerTransfer",
        access.userId,
        previousOwner,
      );
    } else
      writeAuditLogInDatabase(db, {
        actorUserId: access.userId,
        museumId,
        action: `museum.transfer${input.action === "reject" ? "Rejected" : "Cancelled"}`,
        objectType: "museum",
        objectId: museumId,
      });
    db.prepare(
      "UPDATE owner_transfer_requests SET status=?,resolved_at=? WHERE id=? AND status='pending'",
    ).run(status, now, input.requestId);
    return { ok: true as const, museumId, requestId: input.requestId, status };
  });
}

export function readOwnerTransferRequestInDatabase(
  db: DatabaseSync,
  userId: string | null,
  museumId: string,
) {
  const { access } = requireSharedActive(db, userId, museumId);
  const row = db
    .prepare(
      `SELECT r.id,r.owner_user_id,r.target_user_id,r.expires_at,u.display_name target_name
    FROM owner_transfer_requests r JOIN users u ON u.id=r.target_user_id
    WHERE r.museum_id=? AND r.status='pending' AND r.expires_at>?`,
    )
    .get(museumId, new Date().toISOString());
  if (!row || (access.role !== "owner" && row.target_user_id !== access.userId)) return null;
  return {
    id: readString(row, "id"),
    targetUserId: readString(row, "target_user_id"),
    targetName: readString(row, "target_name"),
    expiresAt: readString(row, "expires_at"),
  };
}
