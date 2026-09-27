import type { DatabaseSync } from "node:sqlite";
import { inviteLinkSchemaSql } from "./invite-link-schema.ts";
import { museumMembershipSchemaSql } from "./museum-membership-schema.ts";
import { withTransaction } from "./transaction.ts";

type Migration = {
  version: number;
  migrate: (database: DatabaseSync) => void;
};

function hasColumn(database: DatabaseSync, table: string, column: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (entry) => entry.name === column,
  );
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    migrate(database) {
      if (!hasColumn(database, "memory_images", "exhibit_title")) {
        database.exec(
          "ALTER TABLE memory_images ADD COLUMN exhibit_title TEXT NOT NULL DEFAULT ''",
        );
      }
      if (!hasColumn(database, "memory_images", "exhibit_description")) {
        database.exec(
          "ALTER TABLE memory_images ADD COLUMN exhibit_description TEXT NOT NULL DEFAULT ''",
        );
      }
      database.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS memory_images_unique_photo
        ON memory_images(memory_id, storage_key)
      `);
    },
  },
  {
    version: 2,
    migrate(database) {
      if (!hasColumn(database, "uploaded_photos", "library_archived_at")) {
        database.exec("ALTER TABLE uploaded_photos ADD COLUMN library_archived_at TEXT");
      }
      database.exec(`
        UPDATE uploaded_photos
        SET used_at = (
          SELECT MIN(memory_images.created_at)
          FROM memory_images
          WHERE memory_images.storage_key = uploaded_photos.optimized_storage_key
        )
        WHERE used_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM memory_images
            WHERE memory_images.storage_key = uploaded_photos.optimized_storage_key
          );
        CREATE INDEX IF NOT EXISTS uploaded_photos_library
        ON uploaded_photos(used_at, library_archived_at, created_at DESC);
      `);
    },
  },
  {
    version: 3,
    migrate(database) {
      if (!hasColumn(database, "photo_deletion_jobs", "original_storage_key")) {
        database.exec("ALTER TABLE photo_deletion_jobs ADD COLUMN original_storage_key TEXT");
      }
      database.exec(`
        CREATE TABLE IF NOT EXISTS pending_uploads (
          id TEXT PRIMARY KEY,
          storage_key TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          last_error TEXT
        )
      `);
    },
  },
  {
    version: 4,
    migrate(database) {
      database.exec(`
        DELETE FROM memory_relations
        WHERE rowid NOT IN (
          SELECT MIN(rowid)
          FROM memory_relations
          GROUP BY min(memory_id, related_memory_id), max(memory_id, related_memory_id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS memory_relations_undirected
        ON memory_relations(min(memory_id, related_memory_id), max(memory_id, related_memory_id));
      `);
    },
  },
  {
    version: 5,
    migrate(database) {
      if (!hasColumn(database, "stages", "is_public")) {
        database.exec(
          "ALTER TABLE stages ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1))",
        );
      }
      if (!hasColumn(database, "memories", "is_public")) {
        database.exec(
          "ALTER TABLE memories ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1))",
        );
      }
      database.exec(
        "CREATE INDEX IF NOT EXISTS memory_images_storage_key ON memory_images(storage_key)",
      );
    },
  },
  {
    version: 6,
    migrate(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL COLLATE NOCASE UNIQUE,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    },
  },
  {
    version: 7,
    migrate(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
    },
  },
  {
    version: 8,
    migrate(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS user_sessions_user_id ON user_sessions(user_id);
      `);
    },
  },
  {
    version: 9,
    migrate(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
    },
  },
  {
    version: 10,
    migrate(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS museums (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          slug TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(slug)) > 0),
          description TEXT NOT NULL DEFAULT '',
          cover_photo_id TEXT REFERENCES uploaded_photos(id) ON DELETE SET NULL,
          version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          storage_quota_bytes INTEGER NOT NULL DEFAULT 0 CHECK (storage_quota_bytes >= 0),
          storage_used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (storage_used_bytes >= 0)
        )
      `);
    },
  },
  {
    version: 11,
    migrate(database) {
      const duplicate = database
        .prepare("SELECT owner_id FROM museums GROUP BY owner_id HAVING COUNT(*) > 1 LIMIT 1")
        .get();
      if (duplicate)
        throw new Error("Cannot enforce unique Museum ownership: duplicate Museum owners exist");
      database.exec("CREATE UNIQUE INDEX IF NOT EXISTS museums_owner_unique ON museums(owner_id)");
    },
  },
  {
    version: 12,
    migrate(database) {
      for (const table of ["memories", "stages", "uploaded_photos"]) {
        if (!hasColumn(database, table, "museum_id")) {
          database.exec(
            `ALTER TABLE ${table} ADD COLUMN museum_id TEXT REFERENCES museums(id) ON DELETE RESTRICT`,
          );
        }
      }
    },
  },
  {
    version: 13,
    migrate(database) {
      for (const table of [
        "stage_covers",
        "memory_images",
        "memory_relations",
        "later_notes",
        "share_configs",
        "photo_deletion_jobs",
        "pending_uploads",
      ]) {
        if (!hasColumn(database, table, "museum_id")) {
          database.exec(
            `ALTER TABLE ${table} ADD COLUMN museum_id TEXT REFERENCES museums(id) ON DELETE RESTRICT`,
          );
        }
      }
    },
  },
  {
    version: 14,
    migrate(database) {
      database.exec(museumMembershipSchemaSql);
    },
  },
  {
    version: 15,
    migrate(database) {
      database.exec(inviteLinkSchemaSql);
    },
  },
  {
    version: 16,
    migrate(database) {
      for (const column of ["created_by_user_id", "last_edited_by_user_id"]) {
        if (!hasColumn(database, "memories", column)) {
          database.exec(
            `ALTER TABLE memories ADD COLUMN ${column} TEXT REFERENCES users(id) ON DELETE SET NULL`,
          );
        }
      }
    },
  },
  {
    version: 17,
    migrate(database) {
      for (const [table, columns] of [
        ["stages", ["created_by_user_id", "last_edited_by_user_id"]],
        ["museums", ["last_edited_by_user_id"]],
      ] as const) {
        for (const column of columns) {
          if (!hasColumn(database, table, column)) {
            database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT REFERENCES users(id) ON DELETE SET NULL`);
          }
        }
      }
    },
  },
  {
    version: 18,
    migrate(database) {
      if (!hasColumn(database, "memories", "version")) {
        database.exec("ALTER TABLE memories ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)");
      }
    },
  },
  {
    version: 19,
    migrate(database) {
      if (!hasColumn(database, "stages", "version")) database.exec("ALTER TABLE stages ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)");
    },
  },
];

export function runDatabaseMigrations(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    (
      database.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>
    ).map((row) => row.version),
  );
  const record = database.prepare(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    withTransaction(database, () => {
      migration.migrate(database);
      record.run(migration.version, new Date().toISOString());
    });
  }
}
