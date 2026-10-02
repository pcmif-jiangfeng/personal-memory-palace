import type { DatabaseSync } from "node:sqlite";
import type { SwitcherMuseum } from "../domain/museum-switcher.ts";

// Navigation metadata only: choosing an entry does not grant content permissions.
export function listSwitcherMuseumsInDatabase(
  database: DatabaseSync,
  userId: string,
): SwitcherMuseum[] {
  return database
    .prepare(
      `SELECT id, name, 'owner' AS role FROM museums WHERE owner_id=? ORDER BY created_at, id`,
    )
    .all(userId)
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      role: row.role as SwitcherMuseum["role"],
    }));
}
