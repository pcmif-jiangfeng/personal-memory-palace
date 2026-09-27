import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { initializeDatabase } from "../src/data/database.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";

const secondaryTables = [
  "stage_covers",
  "memory_images",
  "memory_relations",
  "later_notes",
  "share_configs",
  "photo_deletion_jobs",
  "pending_uploads",
] as const;

test("Museum-owned secondary records can reference only an existing Museum", () => {
  const database = initializeDatabase(":memory:", false);
  try {
    const owner = createUserInDatabase(database, {
      email: "secondary-owner@example.com",
      passwordHash: "scrypt-hash",
      displayName: "馆长",
    });
    const museum = createMuseumInDatabase(database, {
      ownerId: owner.id,
      name: "人生博物馆",
      slug: "secondary-museum",
    });
    const now = "2026-09-25T00:00:00.000Z";
    database
      .prepare(
        "INSERT INTO stages (id, title, created_at, updated_at) VALUES ('stage-1', '阶段', ?, ?)",
      )
      .run(now, now);
    database
      .prepare(
        "INSERT INTO memories (id, title, story, created_at, updated_at) VALUES ('memory-1', '回忆', '故事', ?, ?), ('memory-2', '回忆二', '故事二', ?, ?)",
      )
      .run(now, now, now, now);
    database
      .prepare(
        "INSERT INTO uploaded_photos (id, original_name, mime_type, optimized_storage_key, width, height, created_at) VALUES ('photo-1', 'photo.jpg', 'image/jpeg', 'optimized/photo-1.webp', 100, 100, ?)",
      )
      .run(now);

    database
      .prepare(
        "INSERT INTO stage_covers (stage_id, storage_key, museum_id) VALUES ('stage-1', 'cover.webp', ?)",
      )
      .run(museum.id);
    database
      .prepare(
        "INSERT INTO memory_images (id, memory_id, storage_key, created_at, museum_id) VALUES ('image-1', 'memory-1', 'image.webp', ?, ?)",
      )
      .run(now, museum.id);
    database
      .prepare(
        "INSERT INTO memory_relations (memory_id, related_memory_id, created_at, museum_id) VALUES ('memory-1', 'memory-2', ?, ?)",
      )
      .run(now, museum.id);
    database
      .prepare(
        "INSERT INTO later_notes (id, memory_id, content, created_at, museum_id) VALUES ('note-1', 'memory-1', '后来', ?, ?)",
      )
      .run(now, museum.id);
    database
      .prepare(
        "INSERT INTO share_configs (id, memory_id, created_at, updated_at, museum_id) VALUES ('share-1', 'memory-1', ?, ?, ?)",
      )
      .run(now, now, museum.id);
    database
      .prepare(
        "INSERT INTO photo_deletion_jobs (photo_id, optimized_storage_key, created_at, museum_id) VALUES ('photo-1', 'optimized/photo-1.webp', ?, ?)",
      )
      .run(now, museum.id);
    database
      .prepare(
        "INSERT INTO pending_uploads (id, storage_key, created_at, museum_id) VALUES ('pending-1', 'pending/photo.webp', ?, ?)",
      )
      .run(now, museum.id);

    for (const table of secondaryTables) {
      const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
        table: string;
        from: string;
        to: string;
      }>;
      assert.ok(
        foreignKeys.some(
          (key) => key.table === "museums" && key.from === "museum_id" && key.to === "id",
        ),
        table,
      );
      assert.equal(
        database.prepare(`SELECT museum_id FROM ${table}`).get()?.museum_id,
        museum.id,
        table,
      );
      assert.throws(
        () => database.prepare(`UPDATE ${table} SET museum_id = 'missing'`).run(),
        /FOREIGN KEY constraint failed/,
        table,
      );
    }
  } finally {
    database.close();
  }
});

test("migration 13 preserves legacy secondary rows without assigning a Museum", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(
      "PRAGMA foreign_keys = ON; CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE museums (id TEXT PRIMARY KEY); CREATE TABLE memories (id TEXT PRIMARY KEY); CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    for (const table of secondaryTables) {
      database.exec(
        `CREATE TABLE ${table} (id TEXT PRIMARY KEY); INSERT INTO ${table} VALUES ('legacy')`,
      );
    }
    const record = database.prepare("INSERT INTO schema_migrations VALUES (?, '2026-09-25')");
    database.exec("CREATE TABLE stages (id TEXT PRIMARY KEY)");
    for (let version = 1; version <= 12; version++) record.run(version);
    runDatabaseMigrations(database);
    runDatabaseMigrations(database);

    for (const table of secondaryTables) {
      const row = database.prepare(`SELECT id, museum_id FROM ${table}`).get() as {
        id: string;
        museum_id: string | null;
      };
      assert.equal(row.id, "legacy", table);
      assert.equal(row.museum_id, null, table);
    }
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 13").get()
        ?.count,
      1,
    );
  } finally {
    database.close();
  }
});
