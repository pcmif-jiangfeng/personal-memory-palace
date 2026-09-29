import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { withTransaction } from "./transaction.ts";
import type { CreateInviteInput, InviteSummary } from "../domain/invites.ts";
import { ApiError } from "../http/errors.ts";
import { selectOwnedMuseumInDatabase } from "./museum-owner-selection.ts";

function ownMuseumId(database: DatabaseSync, ownerId: string, selectedId?: string | null) {
  try {
    return selectOwnedMuseumInDatabase(database, ownerId, selectedId).id;
  } catch (error) {
    if (selectedId == null && error instanceof ApiError && error.message === "MUSEUM_NOT_FOUND")
      throw new ApiError("OWNER_REQUIRED", 403);
    throw error;
  }
}

const summaryColumns = `id, use_mode AS useMode, max_uses AS maxUses, expires_at AS expiresAt,
  usage_count AS usageCount, revoked_at AS revokedAt, created_at AS createdAt`;

function readSummary(database: DatabaseSync, museumId: string, id: string): InviteSummary {
  const row = database
    .prepare(`SELECT ${summaryColumns} FROM invite_links WHERE id = ? AND museum_id = ?`)
    .get(id, museumId);
  if (!row) throw new ApiError("INVITE_NOT_FOUND", 404);
  return { ...row } as unknown as InviteSummary;
}

export function createOwnInviteInDatabase(
  database: DatabaseSync,
  ownerId: string,
  input: CreateInviteInput,
  selectedId?: string | null,
) {
  return withTransaction(database, () => {
    const museumId = ownMuseumId(database, ownerId, selectedId);
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    database
      .prepare(
        "INSERT INTO invite_links (id,museum_id,token_hash,use_mode,max_uses,expires_at,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        id,
        museumId,
        tokenHash,
        input.useMode,
        input.maxUses,
        input.expiresAt,
        new Date().toISOString(),
      );
    writeAuditLogInDatabase(database, {
      actorUserId: ownerId,
      museumId,
      action: "invite.create",
      objectType: "invite",
      objectId: id,
      diff: { useMode: input.useMode, maxUses: input.maxUses, expiresAt: input.expiresAt },
    });
    return { invite: readSummary(database, museumId, id), token };
  });
}

export function listOwnInvitesInDatabase(
  database: DatabaseSync,
  ownerId: string,
  page: number,
  selectedId?: string | null,
) {
  const museumId = ownMuseumId(database, ownerId, selectedId);
  const rows = database
    .prepare(
      `SELECT ${summaryColumns} FROM invite_links WHERE museum_id = ? ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ?`,
    )
    .all(museumId, (page - 1) * 20);
  const total = database
    .prepare("SELECT COUNT(*) AS count FROM invite_links WHERE museum_id = ?")
    .get(museumId)!.count as number;
  return {
    invites: rows.map((row) => ({ ...row }) as unknown as InviteSummary),
    total,
    page,
    pageSize: 20,
  };
}

export function revokeOwnInviteInDatabase(
  database: DatabaseSync,
  ownerId: string,
  id: string,
  selectedId?: string | null,
) {
  return withTransaction(database, () => {
    const museumId = ownMuseumId(database, ownerId, selectedId);
    // Repeated revocation preserves its timestamp and does not duplicate the event.
    const result = database
      .prepare(
        "UPDATE invite_links SET revoked_at = ? WHERE id = ? AND museum_id = ? AND revoked_at IS NULL",
      )
      .run(new Date().toISOString(), id, museumId);
    const invite = readSummary(database, museumId, id);
    if (result.changes) {
      writeAuditLogInDatabase(database, {
        actorUserId: ownerId,
        museumId,
        action: "invite.revoke",
        objectType: "invite",
        objectId: id,
      });
    }
    return invite;
  });
}
