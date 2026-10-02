import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { cancelMuseumDeletionInDatabase as cancel } from "../src/data/museum-deletion.ts";
import {
  requireMuseumAccessInDatabase,
  requireMuseumOwnerInDatabase,
} from "../src/data/museum-access.ts";
import { listSwitcherMuseumsInDatabase } from "../src/data/museum-switcher.ts";
import { readScopedMemory, manageScopedMemory } from "../src/data/scoped-memory.ts";
import { ApiError } from "../src/http/errors.ts";

function fixture(t: TestContext) {
  const db = initializeDatabase(":memory:", false);
  // Exercise stale ownership in the historical pre-13B schema, not a live transfer.
  db.exec("DROP INDEX museums_owner_unique");
  t.after(() => db.close());
  const users = ["owner", "active", "revoked", "outsider"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "fixture-hash",
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
  const id = museums[0].id;
  // Historical pending fixture: J3 forbids initiating a new deletion with active collaborators.
  db.prepare(
    "UPDATE museums SET status='pending_deletion',deletion_scheduled_at='2026-10-29T00:00:00.000Z',version=7 WHERE id=?",
  ).run(id);
  for (const [user, status] of [
    [users[1], "active"],
    [users[2], "revoked"],
  ] as const)
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,status,created_at,updated_at) VALUES (?,?,?,'original-created','original-updated')",
    ).run(id, user.id, status);
  db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,is_public,created_at,updated_at) VALUES ('private',?,'PRIVATE','PRIVATE-STORY',0,'now','now')",
  ).run(id);
  db.prepare(
    "INSERT INTO invite_links (id,museum_id,token_hash,created_at) VALUES ('invite',?,?, 'now')",
  ).run(id, "a".repeat(64));
  const museum = () => db.prepare("SELECT * FROM museums WHERE id=?").get(id)!;
  const unaffected = () =>
    [
      "users",
      "museum_memberships",
      "memories",
      "uploaded_photos",
      "invite_links",
      "share_configs",
      "pending_uploads",
      "photo_deletion_jobs",
    ].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  return { db, users, museums, id, museum, unaffected };
}

const confirmed = { confirm: true as const, version: 7 };
const code = (expected: string) => (error: unknown) =>
  error instanceof ApiError && error.code === expected;

test("J5 cancellation restores only active collaborators, preserves all membership fields and unrelated Museums", (t) => {
  const f = fixture(t);
  const before = f.unaffected();
  const otherMuseums = f.db.prepare("SELECT * FROM museums WHERE id<>? ORDER BY id").all(f.id);
  assert.equal(
    listSwitcherMuseumsInDatabase(f.db, f.users[1].id).some((m) => m.id === f.id),
    false,
  );
  const result = cancel(f.db, f.users[0].id, f.id, confirmed);
  assert.equal(result.status, "active");
  assert.equal(result.deletionScheduledAt, null);
  assert.equal(result.version, 8);
  assert.deepEqual(f.unaffected(), before);
  assert.deepEqual(
    f.db.prepare("SELECT * FROM museums WHERE id<>? ORDER BY id").all(f.id),
    otherMuseums,
  );
  assert.equal(
    listSwitcherMuseumsInDatabase(f.db, f.users[1].id).some((m) => m.id === f.id),
    false,
  );
  for (const user of [f.users[2], f.users[3]]) {
    assert.equal(
      listSwitcherMuseumsInDatabase(f.db, user.id).some((m) => m.id === f.id),
      false,
    );
    assert.throws(
      () => requireMuseumAccessInDatabase(f.db, user.id, f.id),
      code("MUSEUM_NOT_FOUND"),
    );
  }
  const scope = { userId: f.users[1].id, museumId: f.id };
  assert.equal(readScopedMemory(f.db, scope, "private").story, "PRIVATE-STORY");
  assert.throws(
    () => requireMuseumOwnerInDatabase(f.db, scope.userId, f.id),
    code("MUSEUM_OWNER_REQUIRED"),
  );
  manageScopedMemory(f.db, scope, "private", { action: "trash" });
  assert.throws(
    () => manageScopedMemory(f.db, scope, "private", { action: "permanent", confirm: true }),
    code("MUSEUM_OWNER_REQUIRED"),
  );
});

test("J5 cancellation records one precise audit and retries never rewrite membership or duplicate history", (t) => {
  const f = fixture(t);
  const result = cancel(f.db, f.users[0].id, f.id, confirmed);
  const audit = f.db.prepare("SELECT * FROM audit_logs").get()!;
  assert.equal(audit.actor_user_id, f.users[0].id);
  assert.equal(audit.museum_id, f.id);
  assert.equal(audit.object_type, "museum");
  assert.equal(audit.object_id, f.id);
  assert.equal(audit.action, "museum.deletionCancelled");
  assert.ok(Number.isFinite(Date.parse(String(audit.timestamp))));
  assert.deepEqual(JSON.parse(String(audit.diff)), {
    status: { before: "pending_deletion", after: "active" },
    deletionScheduledAt: { before: "2026-10-29T00:00:00.000Z", after: null },
  });
  const snapshot = f.unaffected();
  const museum = f.museum();
  assert.throws(
    () => cancel(f.db, f.users[0].id, f.id, confirmed),
    code("MUSEUM_VERSION_CONFLICT"),
  );
  assert.deepEqual(
    cancel(f.db, f.users[0].id, f.id, { confirm: true, version: result.version }),
    result,
  );
  assert.deepEqual(f.unaffected(), snapshot);
  assert.deepEqual(f.museum(), museum);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs").get()!.n, 1);
});

test("J5 cancellation rechecks current ownership and verification after an earlier management-page read", (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE museums SET owner_id=? WHERE id=?").run(f.users[3].id, f.id);
  assert.throws(() => cancel(f.db, f.users[0].id, f.id, confirmed), code("MUSEUM_NOT_FOUND"));
  f.db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(f.users[3].id);
  assert.throws(
    () => cancel(f.db, f.users[3].id, f.id, confirmed),
    code("EMAIL_VERIFICATION_REQUIRED"),
  );
  assert.equal(f.museum().status, "pending_deletion");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs").get()!.n, 0);
  f.db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(f.users[3].id);
  assert.equal(cancel(f.db, f.users[3].id, f.id, confirmed).status, "active");
  assert.equal(
    f.db.prepare("SELECT actor_user_id FROM audit_logs").get()!.actor_user_id,
    f.users[3].id,
  );
});

test("J5 database-update or audit failure leaves pending state, deadline, version and relationships unchanged", (t) => {
  const f = fixture(t);
  const museum = f.museum();
  const unaffected = f.unaffected();
  f.db.exec(
    "CREATE TRIGGER fail_cancel BEFORE UPDATE ON museums BEGIN SELECT RAISE(ABORT,'update failure'); END",
  );
  assert.throws(() => cancel(f.db, f.users[0].id, f.id, confirmed), /update failure/);
  assert.deepEqual(f.museum(), museum);
  assert.deepEqual(f.unaffected(), unaffected);
  f.db.exec(
    "DROP TRIGGER fail_cancel; CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failure'); END",
  );
  assert.throws(() => cancel(f.db, f.users[0].id, f.id, confirmed), /audit failure/);
  assert.deepEqual(f.museum(), museum);
  assert.deepEqual(f.unaffected(), unaffected);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs").get()!.n, 0);
});
