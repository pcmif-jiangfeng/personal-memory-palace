import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getSessionSecret } from "../config.ts";
import { getDatabase } from "./database.ts";
import { findMemoryDetails } from "./memory-repository.ts";
import { withTransaction } from "./transaction.ts";
import { DomainError } from "../domain/errors.ts";

export type ShareMode = "link" | "password";

type ShareAccessRow = {
  memory_id: string;
  access_mode: ShareMode;
  password_hash: string | null;
  visibility: string;
  trashed_at: string | null;
};

function legacyHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashPassword(value: string): string {
  const salt = randomBytes(16);
  const digest = scryptSync(value, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

function verifyPassword(value: string, storedHash: string): boolean {
  if (!storedHash.startsWith("scrypt$")) {
    const expected = Buffer.from(storedHash);
    const actual = Buffer.from(legacyHash(value));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  const [, encodedSalt, encodedDigest] = storedHash.split("$");
  if (!encodedSalt || !encodedDigest) return false;
  try {
    const expected = Buffer.from(encodedDigest, "base64url");
    const actual = scryptSync(value, Buffer.from(encodedSalt, "base64url"), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function setMemoryVisibilityInDatabase(database: DatabaseSync, memoryId: string, shared: boolean) {
  const result = database.prepare("UPDATE memories SET visibility = ?, updated_at = ? WHERE id = ? AND trashed_at IS NULL")
    .run(shared ? "shared" : "private", new Date().toISOString(), memoryId);
  if (!result.changes) throw new DomainError("MEMORY_NOT_FOUND");
}

export function setMemoryVisibility(memoryId: string, shared: boolean) {
  setMemoryVisibilityInDatabase(getDatabase(), memoryId, shared);
}

export function configureShareInDatabase(
  database: DatabaseSync,
  memoryId: string,
  mode: ShareMode,
  password?: string,
  rotate = false,
) {
  if (mode === "password" && !password?.trim()) throw new DomainError("PASSWORD_REQUIRED");
  const memory = database.prepare("SELECT id FROM memories WHERE id = ? AND trashed_at IS NULL").get(memoryId);
  if (!memory) throw new DomainError("MEMORY_NOT_FOUND");
  return withTransaction(database, () => {
    setMemoryVisibilityInDatabase(database, memoryId, true);
    const existing = database.prepare("SELECT id FROM share_configs WHERE memory_id = ?").get(memoryId) as { id: string } | undefined;
    const token = !existing || rotate ? randomBytes(18).toString("base64url") : existing.id;
    const now = new Date().toISOString();
    if (existing) database.prepare("UPDATE share_configs SET id = ?, enabled = 1, access_mode = ?, password_hash = ?, updated_at = ? WHERE memory_id = ?")
      .run(token, mode, mode === "password" ? hashPassword(password!) : null, now, memoryId);
    else database.prepare("INSERT INTO share_configs (id, memory_id, enabled, access_mode, password_hash, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)")
      .run(token, memoryId, mode, mode === "password" ? hashPassword(password!) : null, now, now);
    return token;
  });
}

export function configureShare(
  memoryId: string,
  mode: ShareMode,
  password?: string,
  rotate = false,
) {
  return configureShareInDatabase(getDatabase(), memoryId, mode, password, rotate);
}

export function disableShare(memoryId: string) {
  const database = getDatabase();
  withTransaction(database, () => {
    database.prepare("UPDATE share_configs SET enabled = 0, updated_at = ? WHERE memory_id = ?").run(new Date().toISOString(), memoryId);
    setMemoryVisibilityInDatabase(database, memoryId, false);
  });
}

function accessDigest(token: string, passwordHash: string): string {
  return createHmac("sha256", getSessionSecret()).update(`${token}:${passwordHash}`).digest("base64url");
}

export function shareAccessCookieName(token: string): string {
  return `memory_palace_share_${token}`;
}

function hasShareAccess(row: ShareAccessRow, token: string, password?: string, accessCookie?: string): boolean {
  if (row.access_mode === "link") return true;
  if (!row.password_hash) return false;
  if (accessCookie === accessDigest(token, row.password_hash)) return true;
  return verifyPassword(password ?? "", row.password_hash);
}

export function getShareAccessCookieValue(token: string) {
  const row = getDatabase().prepare("SELECT password_hash FROM share_configs WHERE id = ? AND enabled = 1").get(token) as { password_hash: string | null } | undefined;
  return row?.password_hash ? accessDigest(token, row.password_hash) : null;
}
export function getSharedMemory(token: string, password?: string, accessCookie?: string) {
  const row = getDatabase().prepare(`SELECT share_configs.*, memories.visibility, memories.trashed_at
    FROM share_configs JOIN memories ON memories.id = share_configs.memory_id
    WHERE share_configs.id = ? AND share_configs.enabled = 1`).get(token) as ShareAccessRow | undefined;
  if (!row || row.visibility !== "shared" || row.trashed_at || !hasShareAccess(row, token, password, accessCookie)) return null;
  return findMemoryDetails(row.memory_id);
}

export function isSharedImageAccessibleInDatabase(
  database: DatabaseSync,
  token: string,
  storageKey: string,
  accessCookie?: string,
): boolean {
  const row = database.prepare(`
    SELECT share_configs.memory_id, share_configs.access_mode, share_configs.password_hash,
      memories.visibility, memories.trashed_at
    FROM share_configs
    JOIN memories ON memories.id = share_configs.memory_id
    JOIN memory_images ON memory_images.memory_id = memories.id
    WHERE share_configs.id = ?
      AND share_configs.enabled = 1
      AND memory_images.storage_key = ?
  `).get(token, storageKey) as ShareAccessRow | undefined;
  return Boolean(row && row.visibility === "shared" && !row.trashed_at && hasShareAccess(row, token, undefined, accessCookie));
}

export function isSharedImageAccessible(token: string, storageKey: string, accessCookie?: string): boolean {
  return isSharedImageAccessibleInDatabase(getDatabase(), token, storageKey, accessCookie);
}

export function getShareConfig(memoryId: string) {
  return getDatabase().prepare("SELECT id, enabled, access_mode FROM share_configs WHERE memory_id = ?").get(memoryId) as { id: string; enabled: number; access_mode: ShareMode } | undefined;
}

export function shareTokenExists(token: string) {
  return Boolean(getDatabase().prepare("SELECT id FROM share_configs WHERE id = ? AND enabled = 1").get(token));
}
