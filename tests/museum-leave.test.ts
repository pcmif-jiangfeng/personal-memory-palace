import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { listSwitcherMuseumsInDatabase } from "../src/data/museum-switcher.ts";
import { leaveMuseumInDatabase } from "../src/data/museum-leave.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "guest", "other"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "hash",
    }),
  );
  const museums = users.map((user) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      name: user.displayName,
      slug: user.displayName,
    }),
  );
  for (const user of users.slice(1))
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'original','original')",
    ).run(museums[0].id, user.id);
  return { db, users, museums };
}

test("collaborator leave revokes only self and disappears from switcher without deleting museum", () => {
  const { db, users, museums } = fixture();
  try {
    assert.equal(listSwitcherMuseumsInDatabase(db, users[1].id).length, 1);
    assert.deepEqual(leaveMuseumInDatabase(db, users[1].id, museums[0].id), { ok: true });
    const row = db
      .prepare("SELECT * FROM museum_memberships WHERE museum_id=? AND user_id=?")
      .get(museums[0].id, users[1].id)!;
    assert.equal(row.status, "revoked");
    assert.equal(row.created_at, "original");
    assert.notEqual(row.updated_at, "original");
    assert.deepEqual(
      listSwitcherMuseumsInDatabase(db, users[1].id).map((m) => m.id),
      [museums[1].id],
    );
    assert.equal(
      db.prepare("SELECT status FROM museum_memberships WHERE user_id=?").get(users[2].id)?.status,
      "active",
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM museums").get()?.count, 3);
    assert.equal(
      db.prepare("SELECT owner_id FROM museums WHERE id=?").get(museums[0].id)?.owner_id,
      users[0].id,
    );
    assert.deepEqual(leaveMuseumInDatabase(db, users[1].id, museums[0].id), { ok: true });
    assert.equal(
      db.prepare("SELECT updated_at FROM museum_memberships WHERE user_id=?").get(users[1].id)
        ?.updated_at,
      row.updated_at,
    );
  } finally {
    db.close();
  }
});

test("owners and nonmembers cannot leave or change other members", () => {
  const { db, users, museums } = fixture();
  try {
    assert.throws(
      () => leaveMuseumInDatabase(db, users[0].id, museums[0].id),
      /OWNER_CANNOT_LEAVE/,
    );
    assert.throws(
      () => leaveMuseumInDatabase(db, users[0].id, museums[1].id),
      /MEMBERSHIP_NOT_FOUND/,
    );
    assert.throws(() => leaveMuseumInDatabase(db, users[1].id, "unknown"), /MEMBERSHIP_NOT_FOUND/);
    assert.throws(
      () => leaveMuseumInDatabase(db, "unknown", museums[0].id),
      /MEMBERSHIP_NOT_FOUND/,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM museum_memberships WHERE status='active'").get()
        ?.count,
      2,
    );
  } finally {
    db.close();
  }
});

test("collaborator can leave pending-deletion Museum and failed write rolls back", () => {
  const { db, users, museums } = fixture();
  try {
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museums[0].id);
    db.exec(
      "CREATE TRIGGER fail_leave BEFORE UPDATE ON museum_memberships BEGIN SELECT RAISE(ABORT,'test failure'); END;",
    );
    assert.throws(() => leaveMuseumInDatabase(db, users[1].id, museums[0].id), /test failure/);
    assert.equal(
      db.prepare("SELECT status FROM museum_memberships WHERE user_id=?").get(users[1].id)?.status,
      "active",
    );
    db.exec("DROP TRIGGER fail_leave");
    leaveMuseumInDatabase(db, users[1].id, museums[0].id);
    assert.equal(
      db.prepare("SELECT status FROM museum_memberships WHERE user_id=?").get(users[1].id)?.status,
      "revoked",
    );
  } finally {
    db.close();
  }
});
