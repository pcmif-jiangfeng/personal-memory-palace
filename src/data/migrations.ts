import type { DatabaseSync } from "node:sqlite";
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
        database.exec("ALTER TABLE memory_images ADD COLUMN exhibit_title TEXT NOT NULL DEFAULT ''");
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
        database.exec("ALTER TABLE stages ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1))");
      }
      if (!hasColumn(database, "memories", "is_public")) {
        database.exec("ALTER TABLE memories ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1))");
      }
      database.exec("CREATE INDEX IF NOT EXISTS memory_images_storage_key ON memory_images(storage_key)");
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
    (database.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map(
      (row) => row.version,
    ),
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
