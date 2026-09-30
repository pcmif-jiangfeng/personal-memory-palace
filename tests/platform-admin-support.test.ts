import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import {
  grantOwnerSupportAccessInDatabase,
  grantIncidentSupportAccessInDatabase,
  revokeOwnerSupportAccessInDatabase,
  readSupportMemoryInDatabase,
} from "../src/data/platform-admin-support.ts";
import { requireMemoryAccessInDatabase } from "../src/data/memory-access.ts";
import { listPlatformMetadataInDatabase } from "../src/data/platform-admin-metadata.ts";
import { parseOwnerSupportAccess, parseSupportRead } from "../src/http/museum-support-access.ts";
import { transferMuseumOwnerInDatabase } from "../src/data/museum-owner-transfer.ts";

function fixture(t: TestContext) {
  const previous = process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID;
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "admin", "other"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "PRIVATE-HASH",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID = users[1].id;
  t.after(() => {
    if (previous === undefined) delete process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID;
    else process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID = previous;
    db.close();
  });
  const museum = createMuseumInDatabase(db, {
    ownerId: users[0].id,
    name: "Museum",
    slug: "museum",
  });
  const otherMuseum = createMuseumInDatabase(db, {
    ownerId: users[2].id,
    name: "Other",
    slug: "other",
  });
  for (const [id, mid] of [
    ["memory", museum.id],
    ["foreign", otherMuseum.id],
  ])
    db.prepare(
      "INSERT INTO memories (id,museum_id,title,story,is_public,visibility,created_at,updated_at) VALUES (?,?,'PRIVATE-TITLE','PRIVATE-STORY',0,'private','now','now')",
    ).run(id, mid);
  const now = new Date("2026-09-30T00:00:00.000Z");
  const grant = () =>
    grantOwnerSupportAccessInDatabase(db, users[0].id, museum.id, "memory", true, now);
  const read = (grantId: string, at = now) =>
    readSupportMemoryInDatabase(db, users[1].id, museum.id, "memory", grantId, at);
  return { db, users, museum, otherMuseum, now, grant, read };
}

test("K5 defaults deny; Owner permission is explicit, scoped and temporary without granting ordinary content access", (t) => {
  const f = fixture(t);
  assert.throws(() => f.read("missing"), /SUPPORT_ACCESS_REQUIRED/);
  assert.throws(
    () => grantOwnerSupportAccessInDatabase(f.db, f.users[0].id, f.museum.id, "memory", false),
    /CONFIRMATION/,
  );
  const grant = f.grant();
  assert.equal(Date.parse(grant.expiresAt) - f.now.getTime(), 30 * 60000);
  assert.equal(f.read(grant.grantId).story, "PRIVATE-STORY");
  assert.throws(
    () => requireMemoryAccessInDatabase(f.db, f.users[1].id, f.museum.id, "memory", "read"),
    /MUSEUM_NOT_FOUND/,
  );
  assert.throws(() => f.read(grant.grantId, new Date(grant.expiresAt)), /SUPPORT_ACCESS_REQUIRED/);
  assert.throws(
    () =>
      readSupportMemoryInDatabase(
        f.db,
        f.users[1].id,
        f.otherMuseum.id,
        "foreign",
        grant.grantId,
        f.now,
      ),
    /SUPPORT_ACCESS_REQUIRED/,
  );
  assert.throws(
    () =>
      readSupportMemoryInDatabase(f.db, f.users[2].id, f.museum.id, "memory", grant.grantId, f.now),
    /PLATFORM_ADMIN_REQUIRED/,
  );
});

test("K5 each private read is audited and no private content, file keys or credentials enter the log/dashboard", (t) => {
  const f = fixture(t);
  const grant = f.grant();
  f.read(grant.grantId);
  f.read(grant.grantId);
  const rows = f.db.prepare("SELECT * FROM audit_logs WHERE action='support.privateRead'").all();
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every((row) => row.actor_user_id === f.users[1].id && row.museum_id === f.museum.id),
  );
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE-STORY|PRIVATE-TITLE|PRIVATE-HASH/);
  assert.doesNotMatch(
    JSON.stringify(listPlatformMetadataInDatabase(f.db, f.users[1].id)),
    /PRIVATE-STORY|PRIVATE-TITLE|support_access/,
  );
  assert.deepEqual(Object.keys(f.read(grant.grantId)).sort(), [
    "memoryId",
    "museumId",
    "story",
    "title",
  ]);
});

test("K5 revoke, Owner change, admin reconfiguration and pending deletion immediately invalidate access", (t) => {
  const f = fixture(t);
  const grant = f.grant();
  revokeOwnerSupportAccessInDatabase(f.db, f.users[0].id, f.museum.id, grant.grantId);
  revokeOwnerSupportAccessInDatabase(f.db, f.users[0].id, f.museum.id, grant.grantId);
  assert.throws(() => f.read(grant.grantId), /SUPPORT_ACCESS_REQUIRED/);
  const again = f.grant();
  f.db.prepare("UPDATE museums SET owner_id=? WHERE id=?").run(f.users[2].id, f.museum.id);
  assert.throws(() => f.read(again.grantId), /SUPPORT_ACCESS_REQUIRED/);
  f.db.prepare("UPDATE museums SET owner_id=? WHERE id=?").run(f.users[0].id, f.museum.id);
  process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID = f.users[2].id;
  assert.throws(() => f.read(again.grantId), /PLATFORM_ADMIN_REQUIRED/);
  process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID = f.users[1].id;
  f.db.exec("UPDATE museums SET status='pending_deletion'");
  assert.throws(() => f.read(again.grantId), /SUPPORT_ACCESS_REQUIRED/);
});

test("K5 audit write failure blocks private content and rolls back grant creation", (t) => {
  const f = fixture(t);
  const grant = f.grant();
  f.db.exec(
    "CREATE TRIGGER deny_support_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'support audit unavailable'); END",
  );
  assert.throws(() => f.read(grant.grantId), /audit unavailable/);
  assert.throws(f.grant, /audit unavailable/);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM museum_support_access").get()!.n, 1);
});

test("K5 incident permits require configured admin, allowed purpose and a case reference; wrong owners cannot grant", (t) => {
  const f = fixture(t);
  assert.throws(
    () => grantOwnerSupportAccessInDatabase(f.db, f.users[2].id, f.museum.id, "memory", true),
    /MUSEUM_NOT_FOUND/,
  );
  assert.throws(
    () =>
      grantIncidentSupportAccessInDatabase(
        f.db,
        f.users[1].id,
        f.museum.id,
        "memory",
        "browsing",
        "INC-123",
      ),
    /INVALID_SUPPORT_INCIDENT/,
  );
  assert.throws(
    () =>
      grantIncidentSupportAccessInDatabase(
        f.db,
        f.users[1].id,
        f.museum.id,
        "memory",
        "fault_handling",
        "",
      ),
    /INVALID_SUPPORT_INCIDENT/,
  );
  for (const purpose of ["fault_handling", "security_incident"]) {
    const grant = grantIncidentSupportAccessInDatabase(
      f.db,
      f.users[1].id,
      f.museum.id,
      "memory",
      purpose,
      "INC-123",
      f.now,
    );
    assert.equal(f.read(grant.grantId).title, "PRIVATE-TITLE");
  }
});

test("K5 migration preserves existing content and is idempotent", (t) => {
  const f = fixture(t);
  const before = f.db.prepare("SELECT * FROM memories").all();
  f.db.exec("DROP TABLE museum_support_access; DELETE FROM schema_migrations WHERE version=25");
  runDatabaseMigrations(f.db);
  runDatabaseMigrations(f.db);
  assert.deepEqual(f.db.prepare("SELECT * FROM memories").all(), before);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE version=25").get()!.n,
    1,
  );
});

test("K5 HTTP input rejects spoofed actor/purpose/expiry and forged resource IDs", async () => {
  const request = (input: unknown) =>
    new Request("http://localhost/api", { method: "POST", body: JSON.stringify(input) });
  for (const input of [
    { memoryId: "memory", confirm: true, adminUserId: "spoof" },
    { memoryId: "memory", confirm: true, purpose: "fault_handling" },
    { memoryId: "../file", confirm: true },
    { memoryId: "memory", confirm: true, expiresAt: "2099" },
  ])
    await assert.rejects(parseOwnerSupportAccess(request(input), false));
  await assert.rejects(
    parseSupportRead(request({ grantId: "id", memoryId: "memory", actorUserId: "admin" })),
  );
  assert.deepEqual(await parseSupportRead(request({ grantId: "id", memoryId: "memory" })), {
    grantId: "id",
    memoryId: "memory",
  });
});

test("K5 real ownership transfer permanently revokes previous support permits in the same transaction", (t) => {
  const f = fixture(t);
  const grant = f.grant();
  f.db
    .prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
    )
    .run(f.museum.id, f.users[2].id);
  transferMuseumOwnerInDatabase(f.db, f.users[0].id, f.museum.id, {
    confirm: true,
    version: 1,
    targetUserId: f.users[2].id,
    oldOwnerDisposition: "stay",
  });
  assert.equal(
    typeof f.db
      .prepare("SELECT revoked_at FROM museum_support_access WHERE id=?")
      .get(grant.grantId)!.revoked_at,
    "string",
  );
  assert.throws(() => f.read(grant.grantId), /SUPPORT_ACCESS_REQUIRED/);
});
