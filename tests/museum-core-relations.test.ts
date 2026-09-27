import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { initializeDatabase } from "../src/data/database.ts";
import { createLegacySecondaryTables } from "./legacy-secondary-tables.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";

test("Memory, Stage and Photo can reference only an existing Museum", () => {
  const database = initializeDatabase(":memory:", false);
  try {
    const owner = createUserInDatabase(database, {
      email: "museum-owner@example.com",
      passwordHash: "scrypt-hash",
      displayName: "馆长",
    });
    const museum = createMuseumInDatabase(database, {
      ownerId: owner.id,
      name: "人生博物馆",
      slug: "life-museum",
    });
    const now = "2026-09-25T00:00:00.000Z";
    database
      .prepare(
        `INSERT INTO stages (id, title, created_at, updated_at, museum_id)
      VALUES ('stage-1', '人生阶段', ?, ?, ?)`,
      )
      .run(now, now, museum.id);
    database
      .prepare(
        `INSERT INTO memories (id, title, story, created_at, updated_at, museum_id)
      VALUES ('memory-1', '回忆', '故事', ?, ?, ?)`,
      )
      .run(now, now, museum.id);
    database
      .prepare(
        `INSERT INTO uploaded_photos
      (id, original_name, mime_type, optimized_storage_key, width, height, created_at, museum_id)
      VALUES ('photo-1', 'photo.jpg', 'image/jpeg', 'optimized/photo-1.webp', 100, 100, ?, ?)`,
      )
      .run(now, museum.id);

    for (const [table, id] of [
      ["memories", "memory-1"],
      ["stages", "stage-1"],
      ["uploaded_photos", "photo-1"],
    ]) {
      const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
        table: string;
        from: string;
        to: string;
      }>;
      assert.ok(
        foreignKeys.some(
          (key) => key.table === "museums" && key.from === "museum_id" && key.to === "id",
        ),
      );
      assert.equal(
        (
          database.prepare(`SELECT museum_id FROM ${table} WHERE id = ?`).get(id) as {
            museum_id: string;
          }
        ).museum_id,
        museum.id,
      );
      assert.throws(() =>
        database.prepare(`UPDATE ${table} SET museum_id = 'missing' WHERE id = ?`).run(id),
      );
    }
  } finally {
    database.close();
  }
});

test("migration 12 preserves legacy core rows without assigning a Museum", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE museums (id TEXT PRIMARY KEY);
      CREATE TABLE memories (id TEXT PRIMARY KEY);
      CREATE TABLE stages (id TEXT PRIMARY KEY);
      CREATE TABLE uploaded_photos (id TEXT PRIMARY KEY);
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO memories VALUES ('memory-legacy');
      INSERT INTO stages VALUES ('stage-legacy');
      INSERT INTO uploaded_photos VALUES ('photo-legacy');
    `);
    createLegacySecondaryTables(database);
    const record = database.prepare("INSERT INTO schema_migrations VALUES (?, '2026-09-25')");
    for (let version = 1; version <= 11; version++) record.run(version);
    runDatabaseMigrations(database);
    runDatabaseMigrations(database);

    for (const [table, id] of [
      ["memories", "memory-legacy"],
      ["stages", "stage-legacy"],
      ["uploaded_photos", "photo-legacy"],
    ]) {
      const row = database.prepare(`SELECT museum_id FROM ${table} WHERE id = ?`).get(id) as {
        museum_id: string | null;
      };
      assert.equal(row.museum_id, null);
    }
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 12")
          .get() as { count: number }
      ).count,
      1,
    );
  } finally {
    database.close();
  }
});
