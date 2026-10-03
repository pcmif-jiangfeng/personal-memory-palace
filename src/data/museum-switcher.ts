import type { DatabaseSync } from "node:sqlite";
import type { SwitcherMuseum } from "../domain/museum-switcher.ts";

// Navigation metadata only: choosing an entry does not grant content permissions.
export function listSwitcherMuseumsInDatabase(
  database: DatabaseSync,
  userId: string,
): SwitcherMuseum[] {
  return database
    .prepare(
      `SELECT m.id, m.name, m.museum_type,
        CASE WHEN m.owner_id=u.id THEN 'owner' ELSE 'collaborator' END AS role
      FROM museums m JOIN users u ON u.id=? AND u.email_verified=1
      LEFT JOIN museum_memberships membership ON membership.museum_id=m.id AND membership.user_id=u.id
      WHERE (m.owner_id=u.id AND m.status IN ('active','pending_deletion'))
        OR (m.status='active' AND membership.role='collaborator' AND membership.status='active')
      ORDER BY m.created_at, m.id`,
    )
    .all(userId)
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      role: row.role as SwitcherMuseum["role"],
      museumType: row.museum_type as SwitcherMuseum["museumType"],
    }));
}
