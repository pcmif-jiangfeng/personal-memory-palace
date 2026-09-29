import type { DatabaseSync } from "node:sqlite";
import type { SwitcherMuseum } from "../domain/museum-switcher.ts";

// Navigation metadata only: choosing an entry does not grant content permissions.
export function listSwitcherMuseumsInDatabase(
  database: DatabaseSync,
  userId: string,
): SwitcherMuseum[] {
  return database
    .prepare(
      `SELECT id, name, 'owner' AS role, created_at FROM museums WHERE owner_id=?
    UNION ALL
    SELECT m.id, m.name, 'collaborator' AS role, m.created_at FROM museums m
    JOIN museum_memberships membership ON membership.museum_id=m.id
    WHERE membership.user_id=? AND membership.status='active' AND m.status='active'
      AND m.owner_id<>?
    ORDER BY role DESC, created_at, id`,
    )
    .all(userId, userId, userId)
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      role: row.role as SwitcherMuseum["role"],
    }));
}
