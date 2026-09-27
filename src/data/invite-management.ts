import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CreateInviteInput, InviteSummary } from "../domain/invites.ts";
import { ApiError } from "../http/errors.ts";
import { findMuseumByOwnerIdInDatabase } from "./museum-repository.ts";

function ownMuseumId(database: DatabaseSync, ownerId: string) {
  const museum = findMuseumByOwnerIdInDatabase(database, ownerId);
  if (!museum) throw new ApiError("OWNER_REQUIRED", 403);
  return museum.id;
}

const summaryColumns = `id, use_mode AS useMode, max_uses AS maxUses, expires_at AS expiresAt,
  usage_count AS usageCount, revoked_at AS revokedAt, created_at AS createdAt`;

function readSummary(database: DatabaseSync, museumId: string, id: string): InviteSummary {
  const row = database.prepare(`SELECT ${summaryColumns} FROM invite_links WHERE id = ? AND museum_id = ?`).get(id, museumId);
  if (!row) throw new ApiError("INVITE_NOT_FOUND", 404);
  return { ...row } as unknown as InviteSummary;
}

export function createOwnInviteInDatabase(database: DatabaseSync, ownerId: string, input: CreateInviteInput) {
  const museumId = ownMuseumId(database, ownerId);
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  database.prepare("INSERT INTO invite_links (id,museum_id,token_hash,use_mode,max_uses,expires_at,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, museumId, tokenHash, input.useMode, input.maxUses, input.expiresAt, new Date().toISOString());
  return { invite: readSummary(database, museumId, id), token };
}

export function listOwnInvitesInDatabase(database: DatabaseSync, ownerId: string, page: number) {
  const museumId = ownMuseumId(database, ownerId);
  const rows = database.prepare(`SELECT ${summaryColumns} FROM invite_links WHERE museum_id = ? ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ?`).all(museumId, (page - 1) * 20);
  const total = database.prepare("SELECT COUNT(*) AS count FROM invite_links WHERE museum_id = ?").get(museumId)!.count as number;
  return { invites: rows.map(row => ({ ...row }) as unknown as InviteSummary), total, page, pageSize: 20 };
}

export function revokeOwnInviteInDatabase(database: DatabaseSync, ownerId: string, id: string) {
  const museumId = ownMuseumId(database, ownerId);
  // Repeated revocation preserves its original timestamp.
  database.prepare("UPDATE invite_links SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND museum_id = ?").run(new Date().toISOString(), id, museumId);
  return readSummary(database, museumId, id);
}
