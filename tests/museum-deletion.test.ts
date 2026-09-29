import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase, findMuseumByIdInDatabase } from "../src/data/museum-repository.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import {
  cancelMuseumDeletionInDatabase as cancel,
  readMuseumDeletionInDatabase as read,
  scheduleMuseumDeletionInDatabase as schedule,
} from "../src/data/museum-deletion.ts";
import { parseMuseumDeletionConfirmation } from "../src/http/museum-deletion.ts";
import { requireMuseumAccessInDatabase } from "../src/data/museum-access.ts";
import { listSwitcherMuseumsInDatabase } from "../src/data/museum-switcher.ts";
import { readScopedMemory } from "../src/data/scoped-memory.ts";
import { readScopedStage } from "../src/data/scoped-stage.ts";
import {
  findMemoryByIdInDatabase,
  findStageByIdInDatabase,
} from "../src/data/memory-repository.ts";
import { isPublicImageAccessibleInDatabase } from "../src/data/publication-repository.ts";
import {
  canReadMuseumPhoto,
  isPhotoMediaAvailable,
  museumPhotoStorageKey,
} from "../src/data/photo-access.ts";
import { configureScopedShare } from "../src/data/scoped-share.ts";
import { getSharedMemoryInDatabase } from "../src/data/share-repository.ts";
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
  const museumId = museums[0].id;
  const owner = { userId: users[0].id, museumId };
  const member = { userId: users[1].id, museumId };
  const join = (id = museumId) =>
    db
      .prepare(
        "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
      )
      .run(id, users[1].id);
  db.prepare(
    "INSERT INTO stages (id,museum_id,title,created_at,updated_at) VALUES ('stage',?,'STAGE','now','now')",
  ).run(museumId);
  db.prepare(
    "INSERT INTO memories (id,museum_id,stage_id,title,story,created_at,updated_at) VALUES ('memory',?,'stage','TITLE','STORY','now','now')",
  ).run(museumId);
  const key = museumPhotoStorageKey(museumId);
  db.prepare(
    "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES ('photo',?,'Photo','image/webp',?,1,1,'now')",
  ).run(museumId, key);
  db.prepare("INSERT INTO stage_covers (stage_id,storage_key,museum_id) VALUES ('stage',?,?)").run(
    key,
    museumId,
  );
  const content = () =>
    [
      "users",
      "museum_memberships",
      "memories",
      "stages",
      "uploaded_photos",
      "stage_covers",
      "share_configs",
      "pending_uploads",
      "photo_deletion_jobs",
    ].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  return { db, users, museums, owner, member, join, key, content };
}

const confirmed = (version: number) => ({ confirm: true as const, version });
const code = (expected: string) => (error: unknown) =>
  error instanceof ApiError && error.code === expected;

test("migration 23 is additive, repeatable and preserves legacy pending rows without fabricating dates", (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(f.owner.museumId);
  const content = f.content();
  f.db.exec(
    "ALTER TABLE museums DROP COLUMN deletion_scheduled_at; DELETE FROM schema_migrations WHERE version=23",
  );
  runDatabaseMigrations(f.db);
  runDatabaseMigrations(f.db);
  assert.equal(findMuseumByIdInDatabase(f.db, f.owner.museumId)!.deletionScheduledAt, null);
  assert.equal(read(f.db, f.owner.userId, f.owner.museumId).status, "pending_deletion");
  assert.deepEqual(f.content(), content);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE version=23").get()!.n,
    1,
  );
});

test("scheduling records exactly 30 days, one audit and a new version, without deleting content or accounts", (t) => {
  const f = fixture(t);
  const content = f.content();
  const other = findMuseumByIdInDatabase(f.db, f.museums[2].id);
  const result = schedule(
    f.db,
    f.owner.userId,
    f.owner.museumId,
    confirmed(1),
    new Date("2026-09-29T03:00:00.000Z"),
  );
  assert.equal(result.status, "pending_deletion");
  assert.equal(result.deletionScheduledAt, "2026-10-29T03:00:00.000Z");
  assert.equal(result.version, 2);
  assert.deepEqual(f.content(), content);
  assert.deepEqual(findMuseumByIdInDatabase(f.db, f.museums[2].id), other);
  const audit = f.db.prepare("SELECT actor_user_id,action,diff FROM audit_logs").get()!;
  assert.equal(audit.actor_user_id, f.owner.userId);
  assert.equal(audit.action, "museum.deletionScheduled");
  assert.equal(
    JSON.parse(String(audit.diff)).deletionScheduledAt.after,
    result.deletionScheduledAt,
  );
  assert.doesNotMatch(JSON.stringify(result), /ownerId|PRIVATE-HASH|STORY/);
});

test("retries cannot extend deadlines and stale cancellation cannot undo a newer deletion cycle", (t) => {
  const f = fixture(t);
  const first = schedule(f.db, f.owner.userId, f.owner.museumId, confirmed(1));
  assert.throws(
    () => schedule(f.db, f.owner.userId, f.owner.museumId, confirmed(1)),
    code("MUSEUM_VERSION_CONFLICT"),
  );
  assert.deepEqual(
    schedule(f.db, f.owner.userId, f.owner.museumId, confirmed(2), new Date("2030-01-01")),
    first,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs").get()!.n, 1);
  const restored = cancel(f.db, f.owner.userId, f.owner.museumId, confirmed(2));
  assert.equal(restored.status, "active");
  assert.equal(restored.deletionScheduledAt, null);
  assert.equal(restored.version, 3);
  assert.deepEqual(cancel(f.db, f.owner.userId, f.owner.museumId, confirmed(3)), restored);
  schedule(f.db, f.owner.userId, f.owner.museumId, confirmed(3));
  assert.throws(
    () => cancel(f.db, f.owner.userId, f.owner.museumId, confirmed(2)),
    code("MUSEUM_VERSION_CONFLICT"),
  );
  assert.equal(read(f.db, f.owner.userId, f.owner.museumId).status, "pending_deletion");
});

test("fresh global J3 guard blocks another owned Museum's collaborators and does not trust earlier snapshots", (t) => {
  const f = fixture(t);
  const second = createMuseumInDatabase(f.db, {
    ownerId: f.owner.userId,
    name: "second",
    slug: "second",
  });
  f.join(second.id);
  assert.throws(
    () => schedule(f.db, f.owner.userId, f.owner.museumId, confirmed(1)),
    code("TRANSFER_OWNERSHIP_REQUIRED"),
  );
  f.db.exec("UPDATE museum_memberships SET status='revoked'");
  // Simulate membership changing after the management page's precheck.
  f.join();
  assert.throws(
    () => schedule(f.db, f.owner.userId, f.owner.museumId, confirmed(1)),
    code("TRANSFER_OWNERSHIP_REQUIRED"),
  );
  assert.equal(read(f.db, f.owner.userId, f.owner.museumId).version, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs").get()!.n, 0);
});

test("scheduling and cancellation require current verified Owner, confirmation and version", (t) => {
  const f = fixture(t);
  f.join();
  for (const operation of [schedule, cancel]) {
    for (const [actor, expected] of [
      [null, "USER_REQUIRED"],
      ["missing", "USER_REQUIRED"],
      [f.member.userId, "MUSEUM_OWNER_REQUIRED"],
      [f.users[2].id, "MUSEUM_NOT_FOUND"],
    ] as const)
      assert.throws(() => operation(f.db, actor, f.owner.museumId, confirmed(1)), code(expected));
    assert.throws(
      () =>
        operation(f.db, f.owner.userId, f.owner.museumId, {
          confirm: false,
          version: 1,
        } as unknown as ReturnType<typeof confirmed>),
      code("DELETION_CONFIRMATION_REQUIRED"),
    );
    for (const version of [0, 1.5, NaN])
      assert.throws(
        () => operation(f.db, f.owner.userId, f.owner.museumId, confirmed(version)),
        code("INVALID_MUSEUM_VERSION"),
      );
    assert.throws(
      () => operation(f.db, f.owner.userId, "missing", confirmed(1)),
      code("MUSEUM_NOT_FOUND"),
    );
  }
  f.db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(f.owner.userId);
  assert.throws(
    () => schedule(f.db, f.owner.userId, f.owner.museumId, confirmed(1)),
    code("EMAIL_VERIFICATION_REQUIRED"),
  );
  assert.throws(
    () => cancel(f.db, f.owner.userId, f.owner.museumId, confirmed(1)),
    code("EMAIL_VERIFICATION_REQUIRED"),
  );
});

test("audit failure rolls back both scheduling and cancellation atomically", (t) => {
  const f = fixture(t);
  const trigger = () =>
    f.db.exec(
      "CREATE TRIGGER reject_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failure'); END",
    );
  const original = findMuseumByIdInDatabase(f.db, f.owner.museumId);
  trigger();
  assert.throws(
    () => schedule(f.db, f.owner.userId, f.owner.museumId, confirmed(1)),
    /audit failure/,
  );
  assert.deepEqual(findMuseumByIdInDatabase(f.db, f.owner.museumId), original);
  f.db.exec("DROP TRIGGER reject_audit");
  schedule(f.db, f.owner.userId, f.owner.museumId, confirmed(1));
  const pending = findMuseumByIdInDatabase(f.db, f.owner.museumId);
  trigger();
  assert.throws(
    () => cancel(f.db, f.owner.userId, f.owner.museumId, confirmed(2)),
    /audit failure/,
  );
  assert.deepEqual(findMuseumByIdInDatabase(f.db, f.owner.museumId), pending);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs").get()!.n, 1);
});

test("pending Museum denies business reads, public Memory/Stage/photo/share access, and hides legacy collaborators; cancellation preserves membership", (t) => {
  const f = fixture(t);
  const token = configureScopedShare(f.db, f.owner, "memory", {
    enabled: true,
    mode: "link",
  })!;
  assert.ok(getSharedMemoryInDatabase(f.db, token));
  assert.ok(findStageByIdInDatabase(f.db, "stage", true));
  assert.equal(isPublicImageAccessibleInDatabase(f.db, f.key), true);
  schedule(f.db, f.owner.userId, f.owner.museumId, confirmed(1));
  // A retained/legacy membership exercises the access boundary, not a bypass of J3's scheduling guard.
  f.join();
  const content = f.content();
  for (const scope of [f.owner, f.member]) {
    assert.throws(() => readScopedMemory(f.db, scope, "memory"), code("MUSEUM_NOT_FOUND"));
    assert.throws(() => readScopedStage(f.db, scope, "stage"), code("MUSEUM_NOT_FOUND"));
    assert.equal(canReadMuseumPhoto(f.db, scope.userId, f.key), false);
  }
  assert.equal(isPhotoMediaAvailable(f.db, f.key), false);
  assert.equal(isPublicImageAccessibleInDatabase(f.db, f.key), false);
  assert.equal(findMemoryByIdInDatabase(f.db, "memory", true), null);
  assert.equal(findStageByIdInDatabase(f.db, "stage", true), null);
  assert.equal(getSharedMemoryInDatabase(f.db, token), null);
  assert.equal(
    listSwitcherMuseumsInDatabase(f.db, f.member.userId).some((m) => m.id === f.owner.museumId),
    false,
  );
  assert.throws(
    () => requireMuseumAccessInDatabase(f.db, f.member.userId, f.owner.museumId),
    code("MUSEUM_NOT_FOUND"),
  );
  assert.equal(
    requireMuseumAccessInDatabase(f.db, f.owner.userId, f.owner.museumId).status,
    "pending_deletion",
  );
  cancel(f.db, f.owner.userId, f.owner.museumId, confirmed(2));
  assert.deepEqual(f.content(), content);
  assert.equal(
    listSwitcherMuseumsInDatabase(f.db, f.member.userId).some((m) => m.id === f.owner.museumId),
    true,
  );
  assert.ok(readScopedMemory(f.db, f.member, "memory"));
  assert.ok(findStageByIdInDatabase(f.db, "stage", true));
  assert.ok(getSharedMemoryInDatabase(f.db, token));
  assert.equal(
    f.db.prepare("SELECT action FROM audit_logs ORDER BY rowid DESC LIMIT 1").get()!.action,
    "museum.deletionCancelled",
  );
});

test("legacy pending with no deadline and expired pending can be cancelled; no time-triggered data purge", (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(f.owner.museumId);
  f.join();
  assert.equal(cancel(f.db, f.owner.userId, f.owner.museumId, confirmed(1)).status, "active");
  f.db.exec("UPDATE museum_memberships SET status='revoked'");
  schedule(f.db, f.owner.userId, f.owner.museumId, confirmed(2), new Date("2020-01-01"));
  const content = f.content();
  assert.equal(read(f.db, f.owner.userId, f.owner.museumId).status, "pending_deletion");
  cancel(f.db, f.owner.userId, f.owner.museumId, confirmed(3));
  assert.deepEqual(f.content(), content);
});

test("invalid server time does not change Museum state", (t) => {
  const f = fixture(t);
  assert.throws(
    () => schedule(f.db, f.owner.userId, f.owner.museumId, confirmed(1), new Date(NaN)),
    code("INVALID_DELETION_TIME"),
  );
  assert.equal(read(f.db, f.owner.userId, f.owner.museumId).status, "active");
});

test("HTTP confirmation parser rejects client-supplied actors, dates, actions, extra fields and invalid versions", async () => {
  const request = (value: unknown) =>
    new Request("https://palace.example/api/museums/a/deletion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  assert.deepEqual(await parseMuseumDeletionConfirmation(request(confirmed(1))), confirmed(1));
  for (const extra of [
    { actorUserId: "owner" },
    { deletionScheduledAt: "2030-01-01" },
    { action: "permanent" },
    { museumId: "other" },
  ])
    await assert.rejects(
      parseMuseumDeletionConfirmation(request({ ...confirmed(1), ...extra })),
      code("INVALID_DELETION_INPUT"),
    );
  for (const input of [
    { confirm: false, version: 1 },
    { confirm: true, version: 0 },
    { confirm: true, version: "1" },
    [],
  ])
    await assert.rejects(parseMuseumDeletionConfirmation(request(input)), ApiError);
});
