import { randomBytes, createHash } from "node:crypto";
import { getDatabase } from "./database";
import { findMemoryDetails } from "./memory-repository";

export type ShareMode = "link" | "password";

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function setMemoryVisibility(memoryId: string, shared: boolean) {
  const result = getDatabase().prepare("UPDATE memories SET visibility = ?, updated_at = ? WHERE id = ? AND trashed_at IS NULL")
    .run(shared ? "shared" : "private", new Date().toISOString(), memoryId);
  if (!result.changes) throw new Error("MEMORY_NOT_FOUND");
}

export function configureShare(memoryId: string, mode: ShareMode, password?: string) {
  if (mode === "password" && !password?.trim()) throw new Error("PASSWORD_REQUIRED");
  const database = getDatabase();
  const memory = database.prepare("SELECT id FROM memories WHERE id = ? AND trashed_at IS NULL").get(memoryId);
  if (!memory) throw new Error("MEMORY_NOT_FOUND");
  setMemoryVisibility(memoryId, true);
  const existing = database.prepare("SELECT id FROM share_configs WHERE memory_id = ?").get(memoryId) as { id: string } | undefined;
  const token = existing?.id ?? randomBytes(18).toString("base64url");
  const now = new Date().toISOString();
  if (existing) database.prepare("UPDATE share_configs SET enabled = 1, access_mode = ?, password_hash = ?, updated_at = ? WHERE memory_id = ?")
    .run(mode, mode === "password" ? hash(password!) : null, now, memoryId);
  else database.prepare("INSERT INTO share_configs (id, memory_id, enabled, access_mode, password_hash, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)")
    .run(token, memoryId, mode, mode === "password" ? hash(password!) : null, now, now);
  return token;
}

export function disableShare(memoryId: string) {
  getDatabase().prepare("UPDATE share_configs SET enabled = 0, updated_at = ? WHERE memory_id = ?").run(new Date().toISOString(), memoryId);
  setMemoryVisibility(memoryId, false);
}

function accessDigest(token: string, passwordHash: string) { return hash(`${token}:${passwordHash}`); }
export function getShareAccessCookieValue(token: string) {
  const row = getDatabase().prepare("SELECT password_hash FROM share_configs WHERE id = ? AND enabled = 1").get(token) as { password_hash: string | null } | undefined;
  return row?.password_hash ? accessDigest(token, row.password_hash) : null;
}
export function getSharedMemory(token: string, password?: string, accessCookie?: string) {
  const row = getDatabase().prepare(`SELECT share_configs.*, memories.visibility, memories.trashed_at
    FROM share_configs JOIN memories ON memories.id = share_configs.memory_id
    WHERE share_configs.id = ? AND share_configs.enabled = 1`).get(token) as { memory_id: string; access_mode: ShareMode; password_hash: string | null; visibility: string; trashed_at: string | null } | undefined;
  const granted = row?.password_hash && accessCookie === accessDigest(token, row.password_hash);
  if (!row || row.visibility !== "shared" || row.trashed_at || (row.access_mode === "password" && !granted && hash(password ?? "") !== row.password_hash)) return null;
  return findMemoryDetails(row.memory_id);
}

export function getShareConfig(memoryId: string) {
  return getDatabase().prepare("SELECT id, enabled, access_mode FROM share_configs WHERE memory_id = ?").get(memoryId) as { id: string; enabled: number; access_mode: ShareMode } | undefined;
}

export function shareTokenExists(token: string) {
  return Boolean(getDatabase().prepare("SELECT id FROM share_configs WHERE id = ? AND enabled = 1").get(token));
}
