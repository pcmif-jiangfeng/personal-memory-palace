import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createLegacySecondaryTables } from "./legacy-secondary-tables.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";

function versionTenDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE museums (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id),
      slug TEXT NOT NULL UNIQUE
    );
    CREATE TABLE memories (id TEXT PRIMARY KEY);
    CREATE TABLE stages (id TEXT PRIMARY KEY);
    CREATE TABLE uploaded_photos (id TEXT PRIMARY KEY);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO users VALUES ('owner-1'), ('owner-2');
  `);
  createLegacySecondaryTables(database);
  const record = database.prepare("INSERT INTO schema_migrations VALUES (?, '2026-09-25')");
  for (let version = 1; version <= 10; version++) record.run(version);
  return database;
}

test("migration 11 keeps existing Museums and prevents a second Museum for one owner", () => {
  const database = versionTenDatabase();
  try {
    database.exec(
      "INSERT INTO museums (id, owner_id, slug) VALUES ('museum-1', 'owner-1', 'first')",
    );
    runDatabaseMigrations(database);
    runDatabaseMigrations(database);
    assert.throws(() =>
      database.exec(
        "INSERT INTO museums (id, owner_id, slug) VALUES ('museum-2', 'owner-1', 'second')",
      ),
    );
    database.exec(
      "INSERT INTO museums (id, owner_id, slug) VALUES ('museum-2', 'owner-2', 'second')",
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM museums").get() as { count: number }).count,
      2,
    );
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 11")
          .get() as { count: number }
      ).count,
      1,
    );
  } finally {
    database.close();
  }
});

test("migration 11 stops without deleting pre-existing duplicate Museums", () => {
  const database = versionTenDatabase();
  try {
    database.exec(`
      INSERT INTO museums VALUES ('museum-1', 'owner-1', 'first');
      INSERT INTO museums VALUES ('museum-2', 'owner-1', 'second');
    `);
    assert.throws(() => runDatabaseMigrations(database), /duplicate Museum owners/);
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM museums").get() as { count: number }).count,
      2,
    );
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 11")
          .get() as { count: number }
      ).count,
      0,
    );
  } finally {
    database.close();
  }
});
