import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { adjustMuseumQuotaInDatabase } from "../src/data/platform-admin-quota.ts";
import { parseQuotaAdjustment } from "../src/http/platform-admin-quota.ts";
import { reservePhotoStorageInDatabase } from "../src/data/photo-storage-quota.ts";
import { museumPhotoStorageKey } from "../src/storage/photo-storage-key.ts";
import { withTransaction } from "../src/data/transaction.ts";
import { listMuseumActivityInDatabase } from "../src/data/museum-activity.ts";
import { requireMemoryAccessInDatabase } from "../src/data/memory-access.ts";
import { ApiError } from "../src/http/errors.ts";

function fixture(t: TestContext) {
  const previous = process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID;
  const db = initializeDatabase(":memory:", false);
  const [admin, owner, other] = ["admin", "owner", "other"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "SECRET-HASH",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID = admin.id;
  const museum = createMuseumInDatabase(db, {
    ownerId: owner.id,
    name: "Private",
    slug: "private",
    storageQuotaBytes: 100,
  });
  const second = createMuseumInDatabase(db, {
    ownerId: other.id,
    name: "Other",
    slug: "other",
    storageQuotaBytes: 77,
  });
  t.after(() => {
    if (previous === undefined) delete process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID;
    else process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID = previous;
    db.close();
  });
  const quota = () =>
    db.prepare("SELECT storage_quota_bytes FROM users WHERE id=?").get(owner.id)!
      .storage_quota_bytes;
  const auditCount = () => db.prepare("SELECT COUNT(*) AS count FROM audit_logs").get()!.count;
  const adjust = (bytes: number, expected = 100, userId: string | null = admin.id) =>
    adjustMuseumQuotaInDatabase(db, userId, museum.id, {
      storageQuotaBytes: bytes,
      expectedQuotaBytes: expected,
      expectedOwnerId: owner.id,
    });
  return { db, admin, owner, other, museum, second, adjust, quota, auditCount };
}

test("account quota applies across all owned palaces and rejects a stale owner selection", (t) => {
  const f = fixture(t);
  const id = randomUUID();
  f.db
    .prepare(
      `INSERT INTO museums(id,owner_id,museum_type,name,slug,created_at,updated_at,storage_usage_ready)
    VALUES (?,?,'shared','Shared',?,'now','now',1)`,
    )
    .run(id, f.owner.id, id);
  f.adjust(150);
  withTransaction(f.db, () =>
    reservePhotoStorageInDatabase(f.db, id, museumPhotoStorageKey(id), 150),
  );
  assert.throws(
    () =>
      withTransaction(f.db, () =>
        reservePhotoStorageInDatabase(f.db, f.museum.id, museumPhotoStorageKey(f.museum.id), 1),
      ),
    (error) => error instanceof ApiError && error.code === "STORAGE_QUOTA_EXCEEDED",
  );
  f.db.prepare("UPDATE museums SET owner_id=? WHERE id=?").run(f.other.id, id);
  assert.throws(
    () =>
      adjustMuseumQuotaInDatabase(f.db, f.admin.id, id, {
        storageQuotaBytes: 200,
        expectedQuotaBytes: 77,
        expectedOwnerId: f.owner.id,
      }),
    (error) => error instanceof ApiError && error.code === "STORAGE_QUOTA_OWNER_CONFLICT",
  );
  assert.equal(
    f.db.prepare("SELECT storage_quota_bytes FROM users WHERE id=?").get(f.other.id)!
      .storage_quota_bytes,
    77,
  );
  assert.equal(f.auditCount(), 1);
});

test("quota and minimal trusted audit commit atomically without changing content metadata or another Museum", (t) => {
  const f = fixture(t);
  const before = f.db.prepare("SELECT * FROM museums WHERE id=?").get(f.museum.id)!;
  assert.deepEqual(f.adjust(200), { id: f.museum.id, storageQuotaBytes: 200 });
  const after = f.db.prepare("SELECT * FROM museums WHERE id=?").get(f.museum.id)!;
  assert.deepEqual(after, before);
  assert.equal(
    f.db.prepare("SELECT storage_quota_bytes FROM museums WHERE id=?").get(f.second.id)!
      .storage_quota_bytes,
    77,
  );
  const audit = f.db.prepare("SELECT * FROM audit_logs").get()!;
  assert.equal(audit.actor_user_id, f.admin.id);
  assert.equal(audit.museum_id, f.museum.id);
  assert.equal(audit.action, "admin.quota.update");
  assert.equal(audit.object_type, "account");
  assert.equal(audit.object_id, f.owner.id);
  assert.deepEqual(JSON.parse(String(audit.diff)), { beforeQuotaBytes: 100, afterQuotaBytes: 200 });
  assert.equal(listMuseumActivityInDatabase(f.db, f.owner.id, f.museum.id).total, 0);
});

test("unauthenticated, ordinary Owner, unrelated User, revoked verification and disabled admin cannot change quota", (t) => {
  const f = fixture(t);
  for (const id of [null, f.owner.id, f.other.id])
    assert.throws(() => f.adjust(200, 100, id), ApiError);
  f.db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(f.admin.id);
  assert.throws(() => f.adjust(200), ApiError);
  delete process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID;
  assert.throws(() => f.adjust(200), ApiError);
  assert.equal(f.quota(), 100);
  assert.equal(f.auditCount(), 0);
});

test("invalid byte counts never update or audit; zero and safe integer maximum remain explicit bounded quotas", (t) => {
  const f = fixture(t);
  for (const value of [
    -1,
    -0.5,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "10",
    null,
    undefined,
    true,
  ]) {
    assert.throws(() => f.adjust(value as number), ApiError);
    assert.throws(
      () =>
        adjustMuseumQuotaInDatabase(f.db, f.admin.id, f.museum.id, {
          storageQuotaBytes: 200,
          expectedQuotaBytes: value as number,
          expectedOwnerId: f.owner.id,
        }),
      ApiError,
    );
  }
  assert.equal(f.quota(), 100);
  assert.equal(f.auditCount(), 0);
  f.adjust(0);
  assert.equal(f.quota(), 0);
  f.adjust(Number.MAX_SAFE_INTEGER, 0);
  assert.equal(f.quota(), Number.MAX_SAFE_INTEGER);
});

test("stale quota is rejected, no-op produces no event, and missing Museum produces no mutation", (t) => {
  const f = fixture(t);
  f.adjust(100);
  assert.equal(f.auditCount(), 0);
  f.adjust(200);
  assert.throws(
    () => f.adjust(300),
    (e) => e instanceof ApiError && e.status === 409,
  );
  assert.equal(f.quota(), 200);
  assert.equal(f.auditCount(), 1);
  assert.throws(
    () =>
      adjustMuseumQuotaInDatabase(f.db, f.admin.id, randomUUID(), {
        storageQuotaBytes: 200,
        expectedQuotaBytes: 100,
        expectedOwnerId: f.owner.id,
      }),
    (e) => e instanceof ApiError && e.status === 404,
  );
  assert.equal(f.auditCount(), 1);
});

test("an audit insert failure rolls the quota update back", (t) => {
  const f = fixture(t);
  f.db.exec(
    "CREATE TRIGGER fail_admin_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
  );
  assert.throws(() => f.adjust(200), /audit unavailable/);
  assert.equal(f.quota(), 100);
  assert.equal(f.auditCount(), 0);
});

test("new quota immediately governs reservations, including below-use and zero; existing data and membership are untouched", (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE museums SET storage_used_bytes=80 WHERE id=?").run(f.museum.id);
  f.db
    .prepare(
      "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES ('private',?,'Private','PRIVATE-STORY','now','now')",
    )
    .run(f.museum.id);
  const reserve = (bytes: number) =>
    withTransaction(f.db, () =>
      reservePhotoStorageInDatabase(f.db, f.museum.id, museumPhotoStorageKey(f.museum.id), bytes),
    );
  assert.throws(
    () => reserve(21),
    (e) => e instanceof ApiError && e.status === 507,
  );
  f.adjust(200);
  reserve(21);
  f.adjust(50, 200);
  assert.throws(
    () => reserve(1),
    (e) => e instanceof ApiError && e.status === 507,
  );
  f.adjust(0, 50);
  assert.throws(
    () => reserve(1),
    (e) => e instanceof ApiError && e.status === 507,
  );
  assert.equal(
    f.db.prepare("SELECT storage_used_bytes FROM museums WHERE id=?").get(f.museum.id)!
      .storage_used_bytes,
    80,
  );
  assert.equal(
    f.db.prepare("SELECT story FROM memories WHERE id='private'").get()!.story,
    "PRIVATE-STORY",
  );
  assert.throws(
    () => requireMemoryAccessInDatabase(f.db, f.admin.id, f.museum.id, "private", "read"),
    ApiError,
  );
});

test("JSON request boundary rejects malformed, missing, fractional, coerced and actor-spoofing values", async () => {
  const request = (body: string) =>
    new Request("https://local.example/api/admin/quota", { method: "PATCH", body });
  for (const body of [
    "{",
    "[]",
    "null",
    "{}",
    '{"storageQuotaBytes":2}',
    '{"storageQuotaBytes":"2","expectedQuotaBytes":1}',
    '{"storageQuotaBytes":-1,"expectedQuotaBytes":1}',
    '{"storageQuotaBytes":2.1,"expectedQuotaBytes":1}',
    '{"storageQuotaBytes":2,"expectedQuotaBytes":1,"actorUserId":"attacker"}',
    '{"storageQuotaBytes":1e99,"expectedQuotaBytes":1}',
  ]) {
    let payload = body;
    try {
      const object = JSON.parse(body);
      if (object !== null && !Array.isArray(object) && typeof object === "object")
        payload = JSON.stringify({
          expectedOwnerId: "11111111-1111-4111-8111-111111111111",
          ...object,
        });
    } catch {
      /* Keep malformed JSON for the boundary test. */
    }
    await assert.rejects(() => parseQuotaAdjustment(request(payload)), ApiError);
  }
  for (const expectedOwnerId of [undefined, null, 123, "wrong", ""]) {
    await assert.rejects(
      () =>
        parseQuotaAdjustment(
          request(
            JSON.stringify({
              storageQuotaBytes: 100,
              expectedQuotaBytes: 100,
              expectedOwnerId,
            }),
          ),
        ),
      ApiError,
    );
  }
  assert.deepEqual(
    await parseQuotaAdjustment(
      request(
        '{"storageQuotaBytes":0,"expectedQuotaBytes":100,"expectedOwnerId":"11111111-1111-4111-8111-111111111111"}',
      ),
    ),
    {
      storageQuotaBytes: 0,
      expectedQuotaBytes: 100,
      expectedOwnerId: "11111111-1111-4111-8111-111111111111",
    },
  );
});
