import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const owner = createUserInDatabase(db, {
    email: "invite@example.com",
    displayName: "馆长",
    passwordHash: "hash",
  });
  const museum = createMuseumInDatabase(db, { ownerId: owner.id, name: "人生馆", slug: "invite" });
  return { db, museum };
}

test("single-use invite has nullable expiry/revocation, defaults to zero uses and cannot exceed one use", () => {
  const { db, museum } = fixture();
  try {
    db.prepare(
      "INSERT INTO invite_links (id,museum_id,token_hash,created_at) VALUES ('invite',?,?, 'now')",
    ).run(museum.id, "a".repeat(64));
    const row = db.prepare("SELECT * FROM invite_links WHERE id = 'invite'").get();
    assert.equal(row?.use_mode, "single-use");
    assert.equal(row?.usage_count, 0);
    assert.equal(row?.max_uses, 1);
    assert.equal(row?.expires_at, null);
    assert.equal(row?.revoked_at, null);
    db.exec(
      "UPDATE invite_links SET usage_count = 1, expires_at = '2026-10-01T00:00:00.000Z', revoked_at = '2026-09-26T00:00:00.000Z' WHERE id = 'invite'",
    );
    assert.throws(
      () => db.exec("UPDATE invite_links SET usage_count = 2 WHERE id = 'invite'"),
      /CHECK/,
    );
    assert.throws(
      () => db.exec("UPDATE invite_links SET max_uses = NULL WHERE id = 'invite'"),
      /CHECK/,
    );
    assert.throws(
      () => db.exec("UPDATE invite_links SET max_uses = 2 WHERE id = 'invite'"),
      /CHECK/,
    );
  } finally {
    db.close();
  }
});

test("multi-use invites support bounded and unlimited usage but reject invalid counters", () => {
  const { db, museum } = fixture();
  try {
    const insert = db.prepare(
      "INSERT INTO invite_links (id,museum_id,token_hash,use_mode,max_uses,usage_count,created_at) VALUES (?,?,?,'multi-use',?,?,'now')",
    );
    insert.run("limited", museum.id, "a".repeat(64), 3, 3);
    insert.run("unlimited", museum.id, "b".repeat(64), null, 100);
    assert.throws(
      () => db.exec("UPDATE invite_links SET usage_count = 4 WHERE id = 'limited'"),
      /CHECK/,
    );
    for (const [maxUses, usageCount] of [
      [0, 0],
      [-1, 0],
      [2, -1],
      [2, 3],
      [2, 0.5],
      [1.5, 0],
    ]) {
      assert.throws(
        () => insert.run("invalid", museum.id, "c".repeat(64), maxUses, usageCount),
        /CHECK/,
      );
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM museum_memberships").get()?.count, 0);
  } finally {
    db.close();
  }
});

test("invite credentials are unique hashes and Museum references and modes are constrained", () => {
  const { db, museum } = fixture();
  try {
    const insert = db.prepare(
      "INSERT INTO invite_links (id,museum_id,token_hash,use_mode,created_at) VALUES (?,?,?,?,'now')",
    );
    insert.run("valid", museum.id, "a".repeat(64), "single-use");
    assert.throws(() => insert.run("duplicate", museum.id, "a".repeat(64), "single-use"), /UNIQUE/);
    for (const tokenHash of [
      "plaintext-token",
      "g".repeat(64),
      "A".repeat(64),
      "a".repeat(63),
      null,
    ]) {
      assert.throws(() => insert.run("bad-hash", museum.id, tokenHash, "single-use"));
    }
    assert.throws(
      () => insert.run("bad-museum", "missing", "b".repeat(64), "single-use"),
      /FOREIGN KEY/,
    );
    assert.throws(() => insert.run("bad-mode", museum.id, "b".repeat(64), "unknown"), /CHECK/);
    assert.throws(() => insert.run(null, museum.id, "b".repeat(64), "single-use"), /NOT NULL/);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("migration 15 preserves existing Museum/Membership data and is idempotent", () => {
  const { db, museum } = fixture();
  try {
    db.exec("DROP TABLE invite_links; DELETE FROM schema_migrations WHERE version = 15");
    const collaborator = createUserInDatabase(db, {
      email: "collaborator@example.com",
      displayName: "协作者",
      passwordHash: "hash",
    });
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
    ).run(museum.id, collaborator.id);
    const membershipsBefore = db.prepare("SELECT * FROM museum_memberships").all();
    const before = db.prepare("SELECT * FROM museums").all();
    runDatabaseMigrations(db);
    runDatabaseMigrations(db);
    assert.deepEqual(db.prepare("SELECT * FROM museum_memberships").all(), membershipsBefore);
    assert.deepEqual(db.prepare("SELECT * FROM museums").all(), before);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 15").get()?.count,
      1,
    );
    db.prepare(
      "INSERT INTO invite_links (id,museum_id,token_hash,created_at) VALUES ('invite',?,?,'now')",
    ).run(museum.id, "a".repeat(64));
    runDatabaseMigrations(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM invite_links").get()?.count, 1);
    db.prepare("DELETE FROM museums WHERE id = ?").run(museum.id);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM invite_links").get()?.count, 0);
  } finally {
    db.close();
  }
});
