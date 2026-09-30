import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import {
  scheduleMuseumDeletionInDatabase,
  cancelMuseumDeletionInDatabase,
} from "../src/data/museum-deletion.ts";
import { queueDueMuseumDeletionReminders } from "../src/data/museum-deletion-notifications.ts";

function fixture(t: TestContext) {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  const user = createUserInDatabase(db, {
    email: "owner@example.com",
    displayName: "Owner",
    passwordHash: "fixture",
  });
  db.exec("UPDATE users SET email_verified=1");
  const museum = createMuseumInDatabase(db, { ownerId: user.id, name: "Museum", slug: "museum" });
  const now = new Date("2026-09-01T00:00:00.000Z");
  const schedule = (version = 1, at = now) =>
    scheduleMuseumDeletionInDatabase(db, user.id, museum.id, { confirm: true, version }, at);
  const cancel = (version = 2) =>
    cancelMuseumDeletionInDatabase(db, user.id, museum.id, { confirm: true, version });
  const rows = () => db.prepare("SELECT * FROM museum_notifications ORDER BY kind").all();
  return { db, user, museum, schedule, cancel, rows };
}

test("K4 initiated/cancelled notifications accompany real transitions and retries do not duplicate", (t) => {
  const f = fixture(t);
  const pending = f.schedule();
  f.schedule(2);
  assert.equal(f.rows().length, 1);
  assert.ok(String(f.rows()[0].body).includes(pending.deletionScheduledAt!));
  f.cancel();
  f.cancel(3);
  assert.equal(f.rows().filter((row) => row.kind === "deletion.cancelled").length, 1);
  assert.equal(f.rows().find((row) => row.kind === "deletion.initiated")!.status, "cancelled");
  assert.ok(f.rows().every((row) => row.recipient_user_id === f.user.id));
});

test("K4 reminders start three days before expiry, once per cycle, and skip expired/active Museums", (t) => {
  const f = fixture(t);
  const pending = f.schedule();
  const deadline = Date.parse(pending.deletionScheduledAt!);
  assert.equal(
    queueDueMuseumDeletionReminders(f.db, new Date(deadline - 3 * 86400000 - 1)).queuedMuseums,
    0,
  );
  assert.equal(
    queueDueMuseumDeletionReminders(f.db, new Date(deadline - 3 * 86400000)).queuedMuseums,
    1,
  );
  assert.equal(queueDueMuseumDeletionReminders(f.db, new Date(deadline - 1)).queuedMuseums, 0);
  assert.equal(queueDueMuseumDeletionReminders(f.db, new Date(deadline)).queuedMuseums, 0);
  assert.equal(
    f.rows().find((row) => row.kind === "deletion.approachingExpiry")!.status,
    "cancelled",
  );
  f.cancel();
  assert.equal(
    f.rows().find((row) => row.kind === "deletion.approachingExpiry")!.status,
    "cancelled",
  );
  assert.equal(queueDueMuseumDeletionReminders(f.db, new Date(deadline - 1)).queuedMuseums, 0);
  const again = f.schedule(3, new Date(deadline));
  assert.equal(
    queueDueMuseumDeletionReminders(f.db, new Date(Date.parse(again.deletionScheduledAt!) - 1000))
      .queuedMuseums,
    1,
  );
  assert.equal(f.rows().filter((row) => row.kind === "deletion.approachingExpiry").length, 2);
});

test("K4 notification write failure rolls back lifecycle change and audit", (t) => {
  const f = fixture(t);
  f.db.exec(
    "CREATE TRIGGER fail_deletion_mail BEFORE INSERT ON museum_notifications BEGIN SELECT RAISE(ABORT,'deletion mail failure'); END",
  );
  assert.throws(f.schedule, /deletion mail failure/);
  assert.equal(f.db.prepare("SELECT status FROM museums").get()!.status, "active");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs").get()!.n, 0);
});

test("K4 reminder pass validates its time/batch and never executes deletion", (t) => {
  const f = fixture(t);
  const pending = f.schedule();
  assert.throws(() => queueDueMuseumDeletionReminders(f.db, new Date("invalid")), /window/);
  assert.throws(() => queueDueMuseumDeletionReminders(f.db, new Date(), 0), /window/);
  queueDueMuseumDeletionReminders(f.db, new Date(Date.parse(pending.deletionScheduledAt!) - 1), 1);
  assert.equal(f.db.prepare("SELECT status FROM museums").get()!.status, "pending_deletion");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM museums").get()!.n, 1);
});
