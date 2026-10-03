import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { initializeDatabase } from "../src/data/database.ts";
import { createLegacySecondaryTables } from "./legacy-secondary-tables.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { createUserInDatabase, findUserByIdInDatabase } from "../src/data/user-repository.ts";

test("creates Users with distinct emails and duplicate display names without a plaintext password column", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-users-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);

  try {
    const first = createUserInDatabase(database, {
      email: "first@example.com",
      passwordHash: "scrypt-hash-one",
      displayName: "馆长",
    });
    const second = createUserInDatabase(database, {
      email: "second@example.com",
      passwordHash: "scrypt-hash-two",
      displayName: "馆长",
    });

    assert.notEqual(first.id, second.id);
    assert.equal(first.emailVerified, false);
    assert.equal(first.displayName, second.displayName);
    assert.equal(first.passwordHash, "scrypt-hash-one");
    assert.deepEqual(findUserByIdInDatabase(database, first.id), first);
    assert.equal(findUserByIdInDatabase(database, "missing"), null);

    const columns = database.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    assert.deepEqual(
      columns.map((column) => column.name),
      [
        "id",
        "email",
        "password_hash",
        "display_name",
        "email_verified",
        "storage_quota_bytes",
        "created_at",
        "updated_at",
      ],
    );
    assert.throws(() =>
      createUserInDatabase(database, {
        email: "FIRST@example.com",
        passwordHash: "scrypt-hash-three",
        displayName: "Another name",
      }),
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 6 adds Users to a database with previous migrations applied", () => {
  const database = new DatabaseSync(":memory:");

  try {
    database.exec(`
      CREATE TABLE memories (id TEXT PRIMARY KEY);
      CREATE TABLE stages (id TEXT PRIMARY KEY);
      CREATE TABLE uploaded_photos (id TEXT PRIMARY KEY);
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations (version, applied_at)
      VALUES (1, '2026-09-01'), (2, '2026-09-01'), (3, '2026-09-01'),
             (4, '2026-09-01'), (5, '2026-09-01');
    `);
    createLegacySecondaryTables(database);
    runDatabaseMigrations(database);
    runDatabaseMigrations(database);

    const usersTable = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
      .get() as { name: string } | undefined;
    const migrationCount = database
      .prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 6")
      .get() as { count: number };
    assert.equal(usersTable?.name, "users");
    assert.equal(migrationCount.count, 1);
  } finally {
    database.close();
  }
});
