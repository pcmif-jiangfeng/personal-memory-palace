import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import {
  createMuseumInDatabase,
  findMuseumByOwnerIdInDatabase,
} from "../src/data/museum-repository.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "collaborator"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "hash",
    }),
  );
  const museum = createMuseumInDatabase(db, {
    ownerId: users[0].id,
    name: "人生馆",
    slug: "membership",
  });
  return { db, users, museum };
}

test("membership defaults to active collaborator, is unique per Museum/User and does not redefine Owner", () => {
  const { db, users, museum } = fixture();
  try {
    const insert = db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
    );
    insert.run(museum.id, users[1].id);
    const row = db.prepare("SELECT role,status FROM museum_memberships").get();
    assert.equal(row?.role, "collaborator");
    assert.equal(row?.status, "active");
    assert.throws(() => insert.run(museum.id, users[1].id), /UNIQUE/);
    db.prepare(
      "UPDATE museum_memberships SET status = 'revoked' WHERE museum_id = ? AND user_id = ?",
    ).run(museum.id, users[1].id);
    assert.throws(() => insert.run(museum.id, users[1].id), /UNIQUE/);
    assert.deepEqual(findMuseumByOwnerIdInDatabase(db, users[0].id), museum);
    assert.equal(
      db.prepare("SELECT * FROM museum_memberships WHERE user_id = ?").get(users[0].id),
      undefined,
    );
  } finally {
    db.close();
  }
});

test("membership rejects unknown states, roles, null identities and dangling references", () => {
  const { db, users, museum } = fixture();
  try {
    const insert = db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,?,'now','now')",
    );
    for (const [museumId, userId, role, status] of [
      [museum.id, users[1].id, "owner", "active"],
      [museum.id, users[1].id, "collaborator", "pending"],
      [museum.id, users[1].id, "collaborator", null],
      [null, users[1].id, "collaborator", "active"],
      [museum.id, null, "collaborator", "active"],
      ["missing", users[1].id, "collaborator", "active"],
      [museum.id, "missing", "collaborator", "active"],
    ])
      assert.throws(() => insert.run(museumId, userId, role, status));
    insert.run(museum.id, users[1].id, "collaborator", "active");
    db.prepare("DELETE FROM users WHERE id = ?").run(users[1].id);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM museum_memberships").get()?.count, 0);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("migration 14 upgrades existing Museums without changing data and runs only once", () => {
  const { db, users, museum } = fixture();
  try {
    db.exec("DROP TABLE museum_memberships; DELETE FROM schema_migrations WHERE version = 14");
    const before = db.prepare("SELECT * FROM museums").all();
    runDatabaseMigrations(db);
    runDatabaseMigrations(db);
    assert.deepEqual(db.prepare("SELECT * FROM museums").all(), before);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 14").get()?.count,
      1,
    );
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
    ).run(museum.id, users[1].id);
    runDatabaseMigrations(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM museum_memberships").get()?.count, 1);
    db.prepare("DELETE FROM museums WHERE id = ?").run(museum.id);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM museum_memberships").get()?.count, 0);
  } finally {
    db.close();
  }
});
