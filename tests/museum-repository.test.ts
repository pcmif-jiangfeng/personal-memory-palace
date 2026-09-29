import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { initializeDatabase } from "../src/data/database.ts";
import { createLegacySecondaryTables } from "./legacy-secondary-tables.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { createMuseumInDatabase, findMuseumByIdInDatabase } from "../src/data/museum-repository.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";

test("Museum requires an existing owner, keeps slugs unique, and starts with version and quota defaults", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-museum-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  try {
    const owner = createUserInDatabase(database, {
      email: "owner@example.com",
      passwordHash: "scrypt-hash",
      displayName: "馆长",
    });
    const museum = createMuseumInDatabase(database, {
      ownerId: owner.id,
      name: "我的人生博物馆",
      slug: "my-museum",
      description: "保存值得重逢的时光",
    });
    assert.equal(museum.ownerId, owner.id);
    assert.equal(museum.version, 1);
    assert.equal(museum.status, "active");
    assert.equal(museum.storageQuotaBytes, 0);
    assert.equal(museum.storageUsedBytes, 0);
    assert.equal(museum.coverPhotoId, null);
    assert.deepEqual(findMuseumByIdInDatabase(database, museum.id), museum);
    assert.equal(findMuseumByIdInDatabase(database, "missing"), null);

    assert.throws(() =>
      createMuseumInDatabase(database, {
        ownerId: "missing-user",
        name: "无主博物馆",
        slug: "orphan",
      }),
    );
    assert.throws(() =>
      createMuseumInDatabase(database, {
        ownerId: owner.id,
        name: "重复地址",
        slug: "MY-MUSEUM",
      }),
    );
    assert.doesNotThrow(() =>
      createMuseumInDatabase(database, {
        ownerId: owner.id,
        name: "第二座自有博物馆",
        slug: "second-museum",
      }),
    );
    const otherOwner = createUserInDatabase(database, {
      email: "another@example.com",
      passwordHash: "scrypt-hash-two",
      displayName: "另一位馆长",
    });
    const second = createMuseumInDatabase(database, {
      ownerId: otherOwner.id,
      name: "另一位用户的博物馆",
      slug: "other-museum",
    });
    assert.notEqual(second.id, museum.id);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 10 adds Museum without changing existing User or Memory rows", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL);
      CREATE TABLE memories (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE stages (id TEXT PRIMARY KEY);
      CREATE TABLE uploaded_photos (id TEXT PRIMARY KEY);
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO users VALUES ('user-1', 'owner@example.com');
      INSERT INTO memories VALUES ('memory-1', '旧回忆');
    `);
    createLegacySecondaryTables(database);
    const record = database.prepare("INSERT INTO schema_migrations VALUES (?, '2026-09-25')");
    for (let version = 1; version <= 9; version++) record.run(version);

    runDatabaseMigrations(database);
    runDatabaseMigrations(database);

    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM museums").get() as { count: number }).count,
      0,
    );
    assert.equal(
      (
        database.prepare("SELECT title FROM memories WHERE id = 'memory-1'").get() as {
          title: string;
        }
      ).title,
      "旧回忆",
    );
    assert.equal(
      (database.prepare("SELECT email FROM users WHERE id = 'user-1'").get() as { email: string })
        .email,
      "owner@example.com",
    );
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 10")
          .get() as { count: number }
      ).count,
      1,
    );
  } finally {
    database.close();
  }
});
