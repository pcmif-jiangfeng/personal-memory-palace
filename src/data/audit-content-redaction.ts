import type { DatabaseSync } from "node:sqlite";

export function redactObjectAuditInDatabase(
  db: DatabaseSync,
  museumId: string | null,
  objectType: "memory" | "stage" | "photo" | "laterNote",
  objectId: string,
) {
  if (!db.isTransaction)
    throw new Error("Audit redaction must share the permanent-delete transaction");
  if (museumId === null) return;
  db.prepare(
    "UPDATE audit_logs SET diff=NULL WHERE museum_id=? AND object_type=? AND object_id=?",
  ).run(museumId, objectType, objectId);
}

export function redactMemoryAuditInDatabase(
  db: DatabaseSync,
  museumId: string | null,
  memoryId: string,
) {
  redactObjectAuditInDatabase(db, museumId, "memory", memoryId);
  for (const row of db
    .prepare("SELECT id FROM later_notes WHERE memory_id=? AND museum_id IS ?")
    .all(memoryId, museumId))
    redactObjectAuditInDatabase(db, museumId, "laterNote", String(row.id));
}
