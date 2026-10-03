import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { requireMuseumOwnerInDatabase } from "./museum-access.ts";
import { findMuseumByIdInDatabase } from "./museum-repository.ts";
import { withTransaction } from "./transaction.ts";
import { queueMuseumDeletionNotificationInDatabase } from "./museum-deletion-notifications.ts";
import { invalidateOwnerTransfersInDatabase } from "./owner-transfer-requests.ts";

export interface MuseumDeletionConfirmation {
  confirm: true;
  version: number;
}

export function readMuseumDeletionInDatabase(
  database: DatabaseSync,
  userId: string | null,
  museumId: string,
) {
  requireMuseumOwnerInDatabase(database, userId, museumId);
  const museum = findMuseumByIdInDatabase(database, museumId)!;
  const cleanup = database
    .prepare(
      "SELECT deletion_attempts,deletion_last_error,deletion_next_attempt_at FROM museums WHERE id=?",
    )
    .get(museumId)!;
  const canCancel =
    museum.museumType === "shared" &&
    museum.status === "pending_deletion" &&
    museum.deletionScheduledAt !== null &&
    Number.isFinite(Date.parse(museum.deletionScheduledAt)) &&
    Date.parse(museum.deletionScheduledAt) > Date.now() &&
    !database
      .prepare("SELECT 1 FROM museum_permanent_deletion_jobs WHERE museum_id=?")
      .get(museumId);
  return {
    museumId: museum.id,
    museumType: museum.museumType,
    name: museum.name,
    status: museum.status,
    version: museum.version,
    deletionScheduledAt: museum.deletionScheduledAt,
    canCancel,
    cleanupAttempts: Number(cleanup.deletion_attempts),
    cleanupFailed: cleanup.deletion_last_error !== null,
    cleanupNextAttemptAt:
      typeof cleanup.deletion_next_attempt_at === "string"
        ? cleanup.deletion_next_attempt_at
        : null,
  };
}

export function scheduleMuseumDeletionInDatabase(
  database: DatabaseSync,
  userId: string | null,
  museumId: string,
  input: MuseumDeletionConfirmation,
  now = new Date(),
) {
  return withTransaction(database, () => {
    const access = requireMuseumOwnerInDatabase(database, userId, museumId);
    const museum = readMuseumDeletionInDatabase(database, access.userId, museumId);
    if (museum.museumType !== "shared") throw new ApiError("PRIVATE_PALACE_DELETION_DISABLED", 410);
    validateConfirmation(input, museum.version);
    // Retrying a current pending state must never extend its deadline or duplicate its audit.
    if (museum.status === "pending_deletion") return museum;
    if (!Number.isFinite(now.getTime())) throw new ApiError("INVALID_DELETION_TIME", 400);
    const deadline = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = database
      .prepare(
        `UPDATE museums SET status='pending_deletion',
      deletion_scheduled_at=?,version=version+1,updated_at=?,last_edited_by_user_id=?
      WHERE id=? AND owner_id=? AND status='active' AND version=?`,
      )
      .run(deadline, now.toISOString(), access.userId, museumId, access.userId, input.version);
    if (!result.changes) throw new ApiError("MUSEUM_VERSION_CONFLICT", 409);
    invalidateOwnerTransfersInDatabase(database, museumId);
    const event = writeAuditLogInDatabase(database, {
      actorUserId: access.userId,
      museumId,
      action: "museum.deletionScheduled",
      objectType: "museum",
      objectId: museumId,
      diff: {
        status: { before: museum.status, after: "pending_deletion" },
        deletionScheduledAt: { before: museum.deletionScheduledAt, after: deadline },
      },
    });
    queueMuseumDeletionNotificationInDatabase(database, event.id, museumId, "initiated", deadline);
    return readMuseumDeletionInDatabase(database, access.userId, museumId);
  });
}

export function cancelMuseumDeletionInDatabase(
  database: DatabaseSync,
  userId: string | null,
  museumId: string,
  input: MuseumDeletionConfirmation,
  now = new Date(),
) {
  return withTransaction(database, () => {
    const access = requireMuseumOwnerInDatabase(database, userId, museumId);
    const museum = readMuseumDeletionInDatabase(database, access.userId, museumId);
    if (museum.museumType !== "shared") throw new ApiError("PRIVATE_PALACE_DELETION_DISABLED", 410);
    validateConfirmation(input, museum.version);
    if (museum.status === "active") return museum;
    if (
      database
        .prepare("SELECT 1 FROM museum_permanent_deletion_jobs WHERE museum_id=?")
        .get(museumId)
    )
      throw new ApiError("MUSEUM_DELETE_IN_PROGRESS", 409);
    if (!Number.isFinite(now.getTime())) throw new ApiError("INVALID_DELETION_TIME", 400);
    if (!museum.deletionScheduledAt || !Number.isFinite(Date.parse(museum.deletionScheduledAt)))
      throw new ApiError("DELETION_DEADLINE_UNKNOWN", 409);
    if (Date.parse(museum.deletionScheduledAt) <= now.getTime())
      throw new ApiError("DELETION_DEADLINE_PASSED", 409);
    const result = database
      .prepare(
        `UPDATE museums SET status='active',deletion_scheduled_at=NULL,
      version=version+1,updated_at=?,last_edited_by_user_id=?
      WHERE id=? AND owner_id=? AND status='pending_deletion' AND version=?`,
      )
      .run(now.toISOString(), access.userId, museumId, access.userId, input.version);
    if (!result.changes) throw new ApiError("MUSEUM_VERSION_CONFLICT", 409);
    const event = writeAuditLogInDatabase(database, {
      actorUserId: access.userId,
      museumId,
      action: "museum.deletionCancelled",
      objectType: "museum",
      objectId: museumId,
      diff: {
        status: { before: museum.status, after: "active" },
        deletionScheduledAt: { before: museum.deletionScheduledAt, after: null },
      },
    });
    database
      .prepare(
        `UPDATE museum_notifications SET status='cancelled'
      WHERE museum_id=? AND status='pending' AND kind IN ('deletion.initiated','deletion.approachingExpiry')`,
      )
      .run(museumId);
    queueMuseumDeletionNotificationInDatabase(database, event.id, museumId, "cancelled", null);
    return readMuseumDeletionInDatabase(database, access.userId, museumId);
  });
}

function validateConfirmation(input: MuseumDeletionConfirmation, version: number) {
  if (input.confirm !== true) throw new ApiError("DELETION_CONFIRMATION_REQUIRED", 400);
  if (!Number.isSafeInteger(input.version) || input.version < 1)
    throw new ApiError("INVALID_MUSEUM_VERSION", 400);
  // Protect against stale requests, including cancellation from a previous deletion cycle.
  if (input.version !== version) throw new ApiError("MUSEUM_VERSION_CONFLICT", 409);
}
