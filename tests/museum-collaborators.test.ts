import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import sharp from "sharp";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import {
  listMuseumCollaboratorsInDatabase,
  removeMuseumCollaboratorInDatabase,
} from "../src/data/museum-collaborators.ts";
import { listSwitcherMuseumsInDatabase } from "../src/data/museum-switcher.ts";
import { requireMemoryAccessInDatabase } from "../src/data/memory-access.ts";
import { requirePhotoMuseum } from "../src/data/photo-access.ts";
import { listMuseumActivityInDatabase } from "../src/data/museum-activity.ts";
import { uploadScopedPhoto } from "../src/application/scoped-photo-upload.ts";
import { recoverPendingUploads } from "../src/data/photo-deletion-service.ts";
import { ApiError } from "../src/http/errors.ts";

function fixture(t: TestContext) {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  const users = ["owner", "member", "other", "outsider"].map((name) =>
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
      storageQuotaBytes: 1000000,
    }),
  );
  for (const [museum, user] of [
    [museums[0], users[1]],
    [museums[0], users[2]],
    [museums[2], users[1]],
  ]) {
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'original','original')",
    ).run(museum.id, user.id);
  }
  db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES ('memory',?,'PRIVATE-TITLE','PRIVATE-STORY','now','now')",
  ).run(museums[0].id);
  const remove = (
    target = users[1].id,
    actor: string | null = users[0].id,
    museum = museums[0].id,
  ) => removeMuseumCollaboratorInDatabase(db, actor, museum, target);
  return { db, users, museums, remove };
}

test("Owner removes only the selected membership, switcher and captured content scopes immediately reject it; data stays intact", (t) => {
  const f = fixture(t);
  const before = f.db.prepare("SELECT * FROM museums WHERE id=?").get(f.museums[0].id);
  requireMemoryAccessInDatabase(f.db, f.users[1].id, f.museums[0].id, "memory", "read");
  assert.deepEqual(f.remove(), { ok: true });
  assert.deepEqual(
    listSwitcherMuseumsInDatabase(f.db, f.users[1].id)
      .map((m) => m.id)
      .sort(),
    [f.museums[1].id, f.museums[2].id].sort(),
  );
  for (const operation of ["read", "update"] as const)
    assert.throws(
      () =>
        requireMemoryAccessInDatabase(f.db, f.users[1].id, f.museums[0].id, "memory", operation),
      ApiError,
    );
  assert.throws(
    () => requirePhotoMuseum(f.db, { userId: f.users[1].id, museumId: f.museums[0].id }),
    ApiError,
  );
  const membership = f.db
    .prepare("SELECT * FROM museum_memberships WHERE museum_id=? AND user_id=?")
    .get(f.museums[0].id, f.users[1].id)!;
  assert.equal(membership.status, "revoked");
  assert.equal(membership.created_at, "original");
  assert.notEqual(membership.updated_at, "original");
  assert.deepEqual(f.db.prepare("SELECT * FROM museums WHERE id=?").get(f.museums[0].id), before);
  assert.equal(
    f.db.prepare("SELECT story FROM memories WHERE id='memory'").get()!.story,
    "PRIVATE-STORY",
  );
  assert.equal(
    f.db
      .prepare("SELECT status FROM museum_memberships WHERE museum_id=? AND user_id=?")
      .get(f.museums[0].id, f.users[2].id)!.status,
    "active",
  );
  assert.equal(
    f.db
      .prepare("SELECT status FROM museum_memberships WHERE museum_id=? AND user_id=?")
      .get(f.museums[2].id, f.users[1].id)!.status,
    "active",
  );
  const audit = f.db.prepare("SELECT * FROM audit_logs WHERE action='membership.remove'").get()!;
  assert.equal(audit.actor_user_id, f.users[0].id);
  assert.equal(audit.museum_id, f.museums[0].id);
  assert.equal(audit.object_id, f.users[1].id);
  assert.equal(audit.object_type, "membership");
  assert.deepEqual(JSON.parse(String(audit.diff)), {
    status: { before: "active", after: "revoked" },
  });
  assert.equal(listMuseumActivityInDatabase(f.db, f.users[2].id, f.museums[0].id).total, 0);
  f.remove();
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()!.n, 1);
  assert.equal(
    f.db
      .prepare("SELECT updated_at FROM museum_memberships WHERE museum_id=? AND user_id=?")
      .get(f.museums[0].id, f.users[1].id)!.updated_at,
    membership.updated_at,
  );
});

test("anonymous, collaborators, outsiders, unverified Owners, self-removal and cross-Museum attempts are rejected", (t) => {
  const f = fixture(t);
  for (const actor of [null, f.users[1].id, f.users[2].id, f.users[3].id, "unknown"]) {
    assert.throws(() => f.remove(f.users[1].id, actor), ApiError);
    assert.throws(() => listMuseumCollaboratorsInDatabase(f.db, actor, f.museums[0].id), ApiError);
  }
  assert.throws(() => f.remove(f.users[0].id), /OWNER_CANNOT_BE_REMOVED/);
  assert.throws(() => f.remove("unknown"), /MEMBERSHIP_NOT_FOUND/);
  assert.throws(() => f.remove(f.users[1].id, f.users[0].id, f.museums[2].id), ApiError);
  f.db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(f.users[0].id);
  assert.throws(() => f.remove(), ApiError);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM museum_memberships WHERE status='active'").get()!.n,
    3,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()!.n, 0);
});

test("audit or membership write failure rolls the removal back, retaining access", (t) => {
  const f = fixture(t);
  for (const trigger of ["BEFORE INSERT ON audit_logs", "BEFORE UPDATE ON museum_memberships"]) {
    f.db.exec(
      `CREATE TRIGGER fail_remove ${trigger} BEGIN SELECT RAISE(ABORT,'test failure'); END`,
    );
    assert.throws(() => f.remove(), /test failure/);
    requireMemoryAccessInDatabase(f.db, f.users[1].id, f.museums[0].id, "memory", "read");
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()!.n, 0);
    f.db.exec("DROP TRIGGER fail_remove");
  }
});

test("only active collaborators appear; list is safely projected, bounded and paginated", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 25; i++) {
    const user = createUserInDatabase(f.db, {
      email: `extra${i}@example.com`,
      displayName: `Extra ${i}`,
      passwordHash: "PRIVATE-HASH",
    });
    f.db
      .prepare(
        "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
      )
      .run(f.museums[0].id, user.id);
  }
  const first = listMuseumCollaboratorsInDatabase(f.db, f.users[0].id, f.museums[0].id);
  const second = listMuseumCollaboratorsInDatabase(f.db, f.users[0].id, f.museums[0].id, 2);
  assert.equal(first.total, 27);
  assert.equal(first.entries.length, 25);
  assert.equal(second.entries.length, 2);
  assert.equal(new Set([...first.entries, ...second.entries].map((e) => e.id)).size, 27);
  assert.deepEqual(Object.keys(first.entries[0]).sort(), ["displayName", "id"]);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE-HASH|PRIVATE-STORY|PRIVATE-TITLE/);
  f.remove();
  assert.equal(listMuseumCollaboratorsInDatabase(f.db, f.users[0].id, f.museums[0].id).total, 26);
  for (const page of [0, -1, 1.5, NaN, Infinity, 1000000])
    assert.throws(
      () => listMuseumCollaboratorsInDatabase(f.db, f.users[0].id, f.museums[0].id, page),
      ApiError,
    );
  f.db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(f.museums[0].id);
  assert.throws(() => f.remove(), ApiError);
  assert.throws(
    () => listMuseumCollaboratorsInDatabase(f.db, f.users[0].id, f.museums[0].id),
    ApiError,
  );
});

test("Owner removal during asynchronous image saving cannot commit a photo; pending charge and journal remain recoverable", async (t) => {
  const f = fixture(t);
  const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#aabbcc" } })
    .webp()
    .toBuffer();
  await assert.rejects(
    () =>
      uploadScopedPhoto(
        f.db,
        { userId: f.users[1].id, museumId: f.museums[0].id },
        {
          data,
          requestedName: "revoked.webp",
        },
        {
          saveOptimized: async (image, key) => {
            assert.ok(key);
            f.remove();
            return {
              optimizedStorageKey: key,
              originalStorageKey: null,
              width: image.width,
              height: image.height,
            };
          },
        },
      ),
    ApiError,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM uploaded_photos").get()!.n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pending_uploads").get()!.n, 1);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='photo.upload'").get()!.n,
    0,
  );
  assert.equal(
    f.db.prepare("SELECT storage_used_bytes FROM museums WHERE id=?").get(f.museums[0].id)!
      .storage_used_bytes,
    data.length,
  );
  assert.equal((await recoverPendingUploads(f.db, { remove: async () => {} })).recovered, 1);
  assert.equal(
    f.db.prepare("SELECT storage_used_bytes FROM museums WHERE id=?").get(f.museums[0].id)!
      .storage_used_bytes,
    0,
  );
});
