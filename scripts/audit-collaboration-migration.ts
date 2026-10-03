import { lstatSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const operationTables = [
  "pending_uploads",
  "photo_deletion_jobs",
  "museum_permanent_deletion_jobs",
] as const;

/** Operational inventory only: no application initializer, migration, or mutation mode. */
export function auditCollaborationMigration(databasePath: string) {
  const file = lstatSync(databasePath);
  if (!file.isFile() || file.isSymbolicLink())
    throw new Error("Expected an existing database file");
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    // All sections describe one SQLite snapshot, even if another process commits meanwhile.
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN");
    function columns(table: string) {
      return new Set(
        db
          .prepare("SELECT name FROM pragma_table_info(?)")
          .all(table)
          .map((row) => String(row.name)),
      );
    }
    const required: Record<string, string[]> = {
      users: ["id", "email", "email_verified"],
      museums: [
        "id",
        "owner_id",
        "status",
        "storage_quota_bytes",
        "storage_used_bytes",
        "storage_usage_ready",
      ],
      museum_memberships: ["museum_id", "status"],
      invite_links: ["museum_id", "revoked_at"],
      memories: ["museum_id", "created_by_user_id"],
      later_notes: ["museum_id"],
      schema_migrations: ["version"],
      pending_uploads: ["museum_id"],
      photo_deletion_jobs: ["museum_id"],
      museum_permanent_deletion_jobs: ["museum_id"],
    };
    for (const [table, names] of Object.entries(required)) {
      const actual = columns(table);
      if (names.some((name) => !actual.has(name))) throw new Error("Unsupported audit schema");
    }
    const count = (sql: string, ...values: string[]) => Number(db.prepare(sql).get(...values)!.n);
    const museumColumns = columns("museums");
    const typeColumn = museumColumns.has("museum_type") ? "m.museum_type" : "NULL";
    const issues = new Set<string>();
    const rows = db
      .prepare(
        `SELECT m.id,m.owner_id,m.status,m.storage_quota_bytes,
      m.storage_used_bytes,m.storage_usage_ready,${typeColumn} AS museum_type,
      u.email,u.email_verified FROM museums m LEFT JOIN users u ON u.id=m.owner_id ORDER BY m.id`,
      )
      .all();
    const ownerCounts = new Map<string, number>();
    for (const row of rows) {
      const ownerId = String(row.owner_id);
      ownerCounts.set(ownerId, (ownerCounts.get(ownerId) ?? 0) + 1);
    }
    const museums = rows.map((row) => {
      const ownerId = String(row.owner_id);
      const ownedCount = ownerCounts.get(ownerId)!;
      const currentType = typeof row.museum_type === "string" ? row.museum_type : null;
      const ownerExists = typeof row.email === "string";
      if (!ownerExists) issues.add("MISSING_OWNER");
      if (row.email_verified !== 1) issues.add("UNVERIFIED_OWNER");
      if (ownedCount > 1 && currentType === null) issues.add("AMBIGUOUS_MUSEUM_TYPES");
      if (currentType !== null && currentType !== "private" && currentType !== "shared")
        issues.add("UNKNOWN_MUSEUM_TYPE");
      if (row.status !== "active") issues.add("MUSEUM_LIFECYCLE_REVIEW_REQUIRED");
      if (row.storage_usage_ready !== 1) issues.add("STORAGE_USAGE_NOT_READY");
      return {
        id: String(row.id),
        ownerId,
        ownerEmail: ownerExists ? String(row.email) : null,
        ownerVerified: row.email_verified === 1,
        currentType,
        suggestedType: !ownerExists
          ? null
          : currentType === "private" || currentType === "shared"
            ? currentType
            : currentType === null && ownedCount === 1 && ownerExists
              ? "private"
              : null,
        status: String(row.status),
        recordedQuotaBytes: Number(row.storage_quota_bytes),
        recordedUsedBytes: Number(row.storage_used_bytes),
        usageReady: row.storage_usage_ready === 1,
        activeMemberships: count(
          "SELECT COUNT(*) AS n FROM museum_memberships WHERE museum_id=? AND status='active'",
          String(row.id),
        ),
        unrevokedInvites: count(
          "SELECT COUNT(*) AS n FROM invite_links WHERE museum_id=? AND revoked_at IS NULL",
          String(row.id),
        ),
      };
    });
    const owners = [...new Set(museums.map((museum) => museum.ownerId))].sort().map((ownerId) => {
      const owned = museums.filter((museum) => museum.ownerId === ownerId);
      const accountQuota = columns("users").has("storage_quota_bytes")
        ? db.prepare("SELECT storage_quota_bytes FROM users WHERE id=?").get(ownerId)
            ?.storage_quota_bytes
        : null;
      const assignedQuota = typeof accountQuota === "number" ? accountQuota : null;
      if (owned.length > 1 && assignedQuota === null) issues.add("AMBIGUOUS_ACCOUNT_QUOTA");
      return {
        ownerId,
        museumIds: owned.map((museum) => museum.id),
        currentAccountQuotaBytes: assignedQuota,
        suggestedQuotaBytes:
          assignedQuota ??
          (owned.length === 1 && owned[0].ownerEmail !== null ? owned[0].recordedQuotaBytes : null),
      };
    });
    const pendingOperations = Object.fromEntries(
      operationTables.map((table) => [table, count(`SELECT COUNT(*) AS n FROM ${table}`)]),
    );
    if (Object.values(pendingOperations).some((total) => total > 0))
      issues.add("PENDING_FILE_OPERATIONS");
    const noteColumns = columns("later_notes");
    const noteAuthorColumn = noteColumns.has("author_user_id")
      ? "author_user_id"
      : noteColumns.has("created_by_user_id")
        ? "created_by_user_id"
        : null;
    const unknownAuthors = {
      memories: count("SELECT COUNT(*) AS n FROM memories WHERE created_by_user_id IS NULL"),
      laterNotes: count(
        noteAuthorColumn
          ? `SELECT COUNT(*) AS n FROM later_notes WHERE ${noteAuthorColumn} IS NULL`
          : "SELECT COUNT(*) AS n FROM later_notes",
      ),
    };
    if (Object.values(unknownAuthors).some((total) => total > 0))
      issues.add("UNKNOWN_HISTORICAL_AUTHORS");
    const inventory = db
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
      .all()
      .map((row) => String(row.name))
      .filter((table) => columns(table).has("museum_id"))
      .map((table) => {
        // Names come from metadata, not our allowlist: quote rather than interpolate raw names.
        const quoted = `"${table.replaceAll('"', '""')}"`;
        return {
          table,
          total: count(`SELECT COUNT(*) AS n FROM ${quoted}`),
          unassigned: count(`SELECT COUNT(*) AS n FROM ${quoted} WHERE museum_id IS NULL`),
        };
      });
    const unassigned = Object.fromEntries(
      inventory.map((entry) => [entry.table, entry.unassigned]),
    );
    if (Object.values(unassigned).some((total) => total > 0)) issues.add("UNASSIGNED_RECORDS");
    const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all().length;
    const integrityOk = db.prepare("PRAGMA integrity_check").get()?.integrity_check === "ok";
    if (!integrityOk || foreignKeyViolations > 0) issues.add("DATABASE_INTEGRITY_REVIEW_REQUIRED");
    return {
      mode: "read-only" as const,
      schemaVersion: Number(
        db.prepare("SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations").get()!
          .version,
      ),
      museums,
      owners,
      unknownAuthors,
      pendingOperations,
      inventory,
      unassigned,
      integrity: { integrityOk, foreignKeyViolations },
      issues: [...issues].sort(),
      notes: [
        "Suggested mappings are proposals, not applied decisions.",
        "Recorded usage is not a measurement of physical files.",
        "Unrevoked invitations may already be expired or exhausted.",
        "This local operational report contains owner emails; do not publish it.",
      ],
    };
  } finally {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--database" || !args[1] || args[1].startsWith("--")) {
      throw new Error(
        "Usage: node --experimental-strip-types scripts/audit-collaboration-migration.ts --database <existing.sqlite>",
      );
    }
    console.log(JSON.stringify(auditCollaborationMigration(path.resolve(args[1])), null, 2));
  } catch {
    // Do not echo SQLite rows, paths, secrets, or arbitrary database error text.
    console.error(
      "Audit failed: supply --database with an existing, supported SQLite file. No migration was applied.",
    );
    process.exitCode = 1;
  }
}
