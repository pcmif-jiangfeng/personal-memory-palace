import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { checkAccountDeletionPreconditionsInDatabase as check } from "../src/data/account-deletion-preconditions.ts";
import { transferMuseumOwnerInDatabase } from "../src/data/museum-owner-transfer.ts";
import { removeMuseumCollaboratorInDatabase } from "../src/data/museum-collaborators.ts";
import { readAccountDeletionPage } from "../src/http/account-deletion-preconditions.ts";
import { ApiError } from "../src/http/errors.ts";

function fixture(t: TestContext) {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  const users = ["owner", "member", "other"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "PRIVATE-HASH",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const museums = users.map((user) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      name: user.displayName,
      slug: user.displayName,
    }),
  );
  const join = (museumId = museums[0].id, userId = users[1].id) =>
    db
      .prepare(
        "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
      )
      .run(museumId, userId);
  return { db, users, museums, join };
}

test("no collaborators allows the flow, with zero or multiple owned Museums, without changing any data", (t) => {
  const f = fixture(t);
  createMuseumInDatabase(f.db, { ownerId: f.users[0].id, name: "second", slug: "second" });
  f.db
    .prepare(
      "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES ('private',?,'PRIVATE-TITLE','PRIVATE-STORY','now','now')",
    )
    .run(f.museums[0].id);
  const tables = [
    "users",
    "museums",
    "museum_memberships",
    "memories",
    "audit_logs",
    "user_sessions",
    "schema_migrations",
  ];
  const snapshot = () =>
    tables.map((table) => f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const before = snapshot();
  const result = check(f.db, f.users[0].id);
  assert.equal(result.canEnterDeletionFlow, true);
  assert.equal(result.reason, null);
  assert.equal(result.ownedMuseumCount, 2);
  assert.equal(result.blockedMuseumCount, 0);
  assert.deepEqual(snapshot(), before);
  assert.doesNotMatch(
    JSON.stringify(result),
    /PRIVATE-HASH|PRIVATE-TITLE|PRIVATE-STORY|password|email/,
  );
  const empty = createUserInDatabase(f.db, {
    email: "empty@example.com",
    displayName: "empty",
    passwordHash: "hash",
  });
  f.db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(empty.id);
  const noMuseum = check(f.db, empty.id);
  assert.equal(noMuseum.canEnterDeletionFlow, true);
  assert.equal(noMuseum.ownedMuseumCount, 0);
  assert.deepEqual(noMuseum.museums, []);
});

test("any active collaborator blocks; revoked, self and merely joined Museums do not", (t) => {
  const f = fixture(t);
  f.join();
  const result = check(f.db, f.users[0].id);
  assert.equal(result.canEnterDeletionFlow, false);
  assert.equal(result.reason, "TRANSFER_OWNERSHIP_REQUIRED");
  assert.equal(result.blockedMuseumCount, 1);
  assert.equal(result.museums[0].collaboratorCount, 1);
  f.join(f.museums[0].id, f.users[0].id);
  f.db.prepare("UPDATE museum_memberships SET status='revoked' WHERE user_id=?").run(f.users[1].id);
  f.join(f.museums[2].id, f.users[0].id);
  assert.equal(check(f.db, f.users[0].id).canEnterDeletionFlow, true);
  assert.equal(check(f.db, f.users[0].id).museums.length, 1);
  assert.equal(check(f.db, f.users[2].id).canEnterDeletionFlow, false);
  f.db
    .prepare("UPDATE museum_memberships SET status='active' WHERE museum_id=? AND user_id=?")
    .run(f.museums[0].id, f.users[1].id);
  f.db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(f.users[1].id);
  // A temporarily unverified collaborator still has a retained active relationship.
  assert.equal(check(f.db, f.users[0].id).canEnterDeletionFlow, false);
});

test("all owned Museums, including blockers beyond the selected page or pending deletion, must be checked", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 25; i++) {
    const museum = createMuseumInDatabase(f.db, {
      ownerId: f.users[0].id,
      name: `Extra ${i}`,
      slug: `extra-${i}`,
    });
    f.db
      .prepare("UPDATE museums SET created_at=? WHERE id=?")
      .run(`later-${String(i).padStart(2, "0")}`, museum.id);
    if (i === 24) {
      f.join(museum.id);
      f.db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museum.id);
    }
  }
  const first = check(f.db, f.users[0].id);
  const second = check(f.db, f.users[0].id, 2);
  assert.equal(first.museums.length, 25);
  assert.equal(second.museums.length, 1);
  assert.equal(first.ownedMuseumCount, 26);
  assert.equal(first.canEnterDeletionFlow, false);
  assert.equal(first.blockedMuseumCount, 1);
  assert.equal(
    first.museums.every((m) => m.collaboratorCount === 0),
    true,
  );
  assert.equal(second.canEnterDeletionFlow, false);
  assert.equal(second.museums[0].status, "pending_deletion");
  assert.equal(new Set([...first.museums, ...second.museums].map((m) => m.id)).size, 26);
});

test("removal and ownership transfer immediately update the result without deleting an account or changing other Museums", (t) => {
  const f = fixture(t);
  f.join();
  assert.equal(check(f.db, f.users[0].id).canEnterDeletionFlow, false);
  removeMuseumCollaboratorInDatabase(f.db, f.users[0].id, f.museums[0].id, f.users[1].id);
  assert.equal(check(f.db, f.users[0].id).canEnterDeletionFlow, true);
  f.db.exec("UPDATE museum_memberships SET status='active'");
  transferMuseumOwnerInDatabase(f.db, f.users[0].id, f.museums[0].id, {
    confirm: true,
    targetUserId: f.users[1].id,
    oldOwnerDisposition: "stay",
    version: 1,
  });
  const original = check(f.db, f.users[0].id);
  const target = check(f.db, f.users[1].id);
  assert.equal(original.canEnterDeletionFlow, true);
  assert.equal(original.ownedMuseumCount, 0);
  assert.equal(target.canEnterDeletionFlow, false);
  assert.equal(target.ownedMuseumCount, 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM users").get()!.n, 3);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM museums").get()!.n, 3);
});

test("unauthenticated, unknown or unverified actors fail, and invalid pages cannot alter the all-Museum guard", (t) => {
  const f = fixture(t);
  for (const user of [null, "unknown"])
    assert.throws(
      () => check(f.db, user),
      (e) => e instanceof ApiError && e.status === 401,
    );
  f.db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(f.users[0].id);
  assert.throws(
    () => check(f.db, f.users[0].id),
    (e) => e instanceof ApiError && e.status === 403,
  );
  f.db.exec("UPDATE users SET email_verified=1");
  for (const page of [0, -1, 1.5, NaN, Infinity, 1000000])
    assert.throws(() => check(f.db, f.users[0].id, page), ApiError);
  assert.equal(readAccountDeletionPage(undefined), 1);
  assert.equal(readAccountDeletionPage("2"), 2);
  for (const value of ["0", "-1", "1.5", "", "01", "1000000", ["1", "2"]])
    assert.throws(() => readAccountDeletionPage(value), ApiError);
});
