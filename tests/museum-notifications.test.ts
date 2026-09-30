import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { createOwnInviteInDatabase } from "../src/data/invite-management.ts";
import { acceptInviteInDatabase } from "../src/data/invite-acceptance.ts";
import { leaveMuseumInDatabase } from "../src/data/museum-leave.ts";
import { removeMuseumCollaboratorInDatabase } from "../src/data/museum-collaborators.ts";
import { transferMuseumOwnerInDatabase } from "../src/data/museum-owner-transfer.ts";
import { deliverMuseumNotifications } from "../src/email/museum-notifications.ts";
import { withTransaction } from "../src/data/transaction.ts";

const configuration = { apiKey: "fixture-key", from: "Museum <test@example.com>" };
function fixture(t: TestContext) {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  const users = ["owner", "member", "outsider"].map((name) =>
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
      name: '<Museum & "private">',
      slug: user.displayName,
    }),
  );
  const invite = createOwnInviteInDatabase(db, users[0].id, {
    useMode: "multi-use",
    maxUses: null,
    expiresAt: null,
  });
  const join = () => acceptInviteInDatabase(db, users[1].id, invite.token);
  const rows = () =>
    db.prepare("SELECT * FROM museum_notifications ORDER BY kind,recipient_user_id").all();
  return { db, users, museums, invite, join, rows };
}

test("K3 migration is additive/idempotent and joins notify only owner and member once", (t) => {
  const f = fixture(t);
  const before = f.db.prepare("SELECT * FROM museums ORDER BY id").all();
  f.db.exec("DROP TABLE museum_notifications; DELETE FROM schema_migrations WHERE version=24");
  runDatabaseMigrations(f.db);
  runDatabaseMigrations(f.db);
  assert.deepEqual(f.db.prepare("SELECT * FROM museums ORDER BY id").all(), before);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE version=24").get()!.n,
    1,
  );
  f.join();
  f.join();
  assert.equal(f.rows().length, 2);
  assert.deepEqual(
    new Set(f.rows().map((row) => row.recipient_user_id)),
    new Set(f.users.slice(0, 2).map((user) => user.id)),
  );
  assert.ok(f.rows().every((row) => row.kind === "collaboration.join"));
  assert.ok(f.rows().every((row) => !String(row.body).includes(f.invite.token)));
});

test("K3 leave/remove retries do not duplicate notifications; transfers notify old and new owners", (t) => {
  const f = fixture(t);
  f.join();
  const museumId = f.museums[0].id;
  leaveMuseumInDatabase(f.db, f.users[1].id, museumId);
  leaveMuseumInDatabase(f.db, f.users[1].id, museumId);
  assert.equal(f.rows().filter((row) => row.kind === "collaboration.leave").length, 2);
  f.join();
  removeMuseumCollaboratorInDatabase(f.db, f.users[0].id, museumId, f.users[1].id);
  removeMuseumCollaboratorInDatabase(f.db, f.users[0].id, museumId, f.users[1].id);
  assert.equal(f.rows().filter((row) => row.kind === "collaboration.removed").length, 2);
  f.join();
  transferMuseumOwnerInDatabase(f.db, f.users[0].id, museumId, {
    confirm: true,
    version: 1,
    targetUserId: f.users[1].id,
    oldOwnerDisposition: "leave",
  });
  assert.equal(f.rows().filter((row) => row.kind === "collaboration.ownerTransfer").length, 2);
});

test("K3 notification failure rolls back the membership, invite use and audit, with no email I/O", (t) => {
  const f = fixture(t);
  f.db.exec(
    "CREATE TRIGGER reject_notification BEFORE INSERT ON museum_notifications BEGIN SELECT RAISE(ABORT,'notification failure'); END",
  );
  assert.throws(f.join, /notification failure/);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM museum_memberships").get()!.n, 0);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='membership.join'").get()!.n,
    0,
  );
  assert.equal(
    f.db.prepare("SELECT usage_count FROM invite_links WHERE id=?").get(f.invite.invite.id)!
      .usage_count,
    0,
  );
});

test("K3 deliveries escape HTML, use stable idempotency keys, and never repeat sent messages", async (t) => {
  const f = fixture(t);
  f.join();
  const calls: Array<{ body: Record<string, string>; key: string }> = [];
  const fetcher: typeof fetch = async (_url, init) => {
    calls.push({
      body: JSON.parse(String(init!.body)),
      key: new Headers(init!.headers).get("Idempotency-Key")!,
    });
    assert.equal(f.db.isTransaction, false);
    return new Response("{}", { status: 200 });
  };
  assert.equal((await deliverMuseumNotifications(f.db, { configuration, fetcher })).sent, 2);
  assert.equal((await deliverMuseumNotifications(f.db, { configuration, fetcher })).sent, 0);
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(
      (call) => !call.body.html.includes("<Museum") && call.body.html.includes("&lt;Museum &amp;"),
    ),
  );
  assert.equal(new Set(calls.map((call) => call.key)).size, 2);
});

test("K3 provider failures remain retryable without rolling back business; concurrent sends respect leases", async (t) => {
  const f = fixture(t);
  f.join();
  const now = new Date(Date.now() + 1000);
  const failed = await deliverMuseumNotifications(f.db, {
    configuration,
    now,
    fetcher: async () => new Response("failed", { status: 503 }),
  });
  assert.equal(failed.failed, 2);
  assert.equal(f.rows().filter((row) => row.status === "pending").length, 2);
  assert.equal(f.db.prepare("SELECT status FROM museum_memberships").get()!.status, "active");
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response("{}", { status: 200 });
  };
  const retryAt = new Date(now.getTime() + 120000);
  const results = await Promise.all(
    [0, 1].map(() => deliverMuseumNotifications(f.db, { configuration, now: retryAt, fetcher })),
  );
  assert.equal(
    results.reduce((total, result) => total + result.sent, 0),
    2,
  );
  assert.equal(requests, 2);
});

test("K3 missing mail configuration keeps pending rows; delivery is forbidden inside a transaction", async (t) => {
  const f = fixture(t);
  f.join();
  const priorKey = process.env.RESEND_API_KEY;
  const priorFrom = process.env.MEMORY_PALACE_EMAIL_FROM;
  delete process.env.RESEND_API_KEY;
  delete process.env.MEMORY_PALACE_EMAIL_FROM;
  try {
    assert.equal((await deliverMuseumNotifications(f.db)).configured, false);
  } finally {
    if (priorKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = priorKey;
    if (priorFrom === undefined) delete process.env.MEMORY_PALACE_EMAIL_FROM;
    else process.env.MEMORY_PALACE_EMAIL_FROM = priorFrom;
  }
  const pending = withTransaction(f.db, () => deliverMuseumNotifications(f.db, { configuration }));
  await assert.rejects(pending, /after commit/);
  assert.equal(f.rows().filter((row) => row.status === "pending").length, 2);
});

test("K3 expired worker leases recover, while active leases and future retries are not sent", async (t) => {
  const f = fixture(t);
  f.join();
  const now = new Date(Date.now() + 1000);
  const rows = f.rows();
  f.db
    .prepare("UPDATE museum_notifications SET lease_token='old-worker',lease_until=? WHERE id=?")
    .run(new Date(now.getTime() - 1000).toISOString(), rows[0].id);
  f.db
    .prepare("UPDATE museum_notifications SET lease_token='active-worker',lease_until=? WHERE id=?")
    .run(new Date(now.getTime() + 60000).toISOString(), rows[1].id);
  let requests = 0;
  const result = await deliverMuseumNotifications(f.db, {
    configuration,
    now,
    fetcher: async () => {
      requests++;
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(result.sent, 1);
  assert.equal(requests, 1);
  f.db
    .prepare(
      "UPDATE museum_notifications SET lease_until=NULL,next_attempt_at=? WHERE status='pending'",
    )
    .run(new Date(now.getTime() + 60000).toISOString());
  assert.equal((await deliverMuseumNotifications(f.db, { configuration, now })).sent, 0);
});
