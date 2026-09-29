import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import {
  createOwnInviteInDatabase,
  revokeOwnInviteInDatabase,
} from "../src/data/invite-management.ts";
import { acceptInviteInDatabase } from "../src/data/invite-acceptance.ts";
import { leaveMuseumInDatabase } from "../src/data/museum-leave.ts";
import { requireMuseumAccessInDatabase } from "../src/data/museum-access.ts";
import { withTransaction } from "../src/data/transaction.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "member", "other", "no-museum"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      passwordHash: "private-password-hash",
      displayName: name,
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const museums = users.slice(0, 3).map((user) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      name: user.displayName,
      slug: user.displayName,
    }),
  );
  const invite = (maxUses: number | null = 1) =>
    createOwnInviteInDatabase(db, users[0].id, {
      useMode: maxUses === 1 ? "single-use" : "multi-use",
      maxUses,
      expiresAt: null,
    });
  return { db, users, museums, invite };
}

function snapshot(db: DatabaseSync) {
  return ["invite_links", "museum_memberships", "audit_logs"].map((table) =>
    db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  );
}

function failAudit(db: DatabaseSync) {
  db.exec(
    "CREATE TRIGGER fail_membership_audit AFTER INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failure'); END",
  );
}

test("invite creation and revocation record trusted owner metadata but never the token or hash", () => {
  const { db, users, museums, invite } = fixture();
  try {
    const created = invite();
    const revoked = revokeOwnInviteInDatabase(db, users[0].id, created.invite.id);
    assert.ok(revoked.revokedAt);
    assert.deepEqual(revokeOwnInviteInDatabase(db, users[0].id, created.invite.id), revoked);
    const events = db.prepare("SELECT * FROM audit_logs ORDER BY rowid").all();
    assert.deepEqual(
      events.map((row) => row.action),
      ["invite.create", "invite.revoke"],
    );
    for (const event of events) {
      assert.equal(event.actor_user_id, users[0].id);
      assert.equal(event.museum_id, museums[0].id);
      assert.equal(event.object_type, "invite");
      assert.equal(event.object_id, created.invite.id);
    }
    assert.deepEqual(JSON.parse(String(events[0].diff)), {
      useMode: "single-use",
      maxUses: 1,
      expiresAt: null,
    });
    assert.equal(events[1].diff, null);
    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes(created.token), false);
    assert.equal(
      serialized.includes(createHash("sha256").update(created.token).digest("hex")),
      false,
    );
    assert.doesNotMatch(serialized, /token|password|@example.com/);
  } finally {
    db.close();
  }
});

test("invite creation cannot leave a live credential when its audit insertion fails", () => {
  const { db, invite } = fixture();
  try {
    const before = snapshot(db);
    failAudit(db);
    assert.throws(() => invite(), /audit failure/);
    assert.deepEqual(snapshot(db), before);
    db.exec("DROP TRIGGER fail_membership_audit");
    const created = invite();
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM invite_links").get()?.n, 1);
    assert.equal(
      db.prepare("SELECT object_id FROM audit_logs").get()?.object_id,
      created.invite.id,
    );
  } finally {
    db.close();
  }
});

test("failed revoke audit restores the usable invite and original event history", () => {
  const { db, users, invite } = fixture();
  try {
    const created = invite();
    const before = snapshot(db);
    failAudit(db);
    assert.throws(
      () => revokeOwnInviteInDatabase(db, users[0].id, created.invite.id),
      /audit failure/,
    );
    assert.deepEqual(snapshot(db), before);
    db.exec("DROP TRIGGER fail_membership_audit");
    assert.equal(acceptInviteInDatabase(db, users[1].id, created.token).alreadyMember, false);
  } finally {
    db.close();
  }
});

test("join retries do not consume uses or events; leaving and rejoining create distinct transitions", () => {
  const { db, users, museums, invite } = fixture();
  try {
    const created = invite(3);
    const first = acceptInviteInDatabase(db, users[1].id, created.token);
    assert.equal(first.alreadyMember, false);
    const saved = snapshot(db);
    assert.equal(acceptInviteInDatabase(db, users[1].id, created.token).alreadyMember, true);
    assert.deepEqual(snapshot(db), saved);
    leaveMuseumInDatabase(db, users[1].id, first.museum.id);
    const left = snapshot(db);
    assert.deepEqual(leaveMuseumInDatabase(db, users[1].id, first.museum.id), { ok: true });
    assert.deepEqual(snapshot(db), left);
    assert.equal(acceptInviteInDatabase(db, users[1].id, created.token).alreadyMember, false);
    const events = db
      .prepare("SELECT * FROM audit_logs WHERE object_type='membership' ORDER BY rowid")
      .all();
    assert.deepEqual(
      events.map((row) => row.action),
      ["membership.join", "membership.leave", "membership.join"],
    );
    for (const event of events) {
      assert.equal(event.actor_user_id, users[1].id);
      assert.equal(event.object_id, users[1].id);
      assert.equal(event.museum_id, museums[0].id);
    }
    assert.deepEqual(JSON.parse(String(events[0].diff)), {
      inviteId: created.invite.id,
      status: { before: null, after: "active" },
    });
    assert.deepEqual(JSON.parse(String(events[1].diff)), {
      status: { before: "active", after: "revoked" },
    });
    assert.deepEqual(JSON.parse(String(events[2].diff)), {
      inviteId: created.invite.id,
      status: { before: "revoked", after: "active" },
    });
    assert.equal(db.prepare("SELECT usage_count FROM invite_links").get()?.usage_count, 2);
    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes(created.token), false);
    assert.equal(
      serialized.includes(createHash("sha256").update(created.token).digest("hex")),
      false,
    );
    assert.doesNotMatch(serialized, /token|password|@example.com/);
  } finally {
    db.close();
  }
});

for (const reactivating of [false, true]) {
  test(`join audit failure rolls back membership and usage (${reactivating ? "reactivation" : "new member"})`, () => {
    const { db, users, museums, invite } = fixture();
    try {
      const created = invite(3);
      if (reactivating)
        db.prepare(
          `INSERT INTO museum_memberships
        (museum_id,user_id,status,created_at,updated_at) VALUES (?,?,'revoked','original','original')`,
        ).run(museums[0].id, users[1].id);
      const before = snapshot(db);
      failAudit(db);
      assert.throws(() => acceptInviteInDatabase(db, users[1].id, created.token), /audit failure/);
      assert.deepEqual(snapshot(db), before);
      db.exec("DROP TRIGGER fail_membership_audit");
      assert.equal(acceptInviteInDatabase(db, users[1].id, created.token).alreadyMember, false);
      assert.equal(db.prepare("SELECT usage_count FROM invite_links").get()?.usage_count, 1);
    } finally {
      db.close();
    }
  });
}

test("failed leave audit preserves access; a successful leave of a pending museum is logged once", () => {
  const { db, users, museums, invite } = fixture();
  try {
    const created = invite(null);
    acceptInviteInDatabase(db, users[1].id, created.token);
    const before = snapshot(db);
    failAudit(db);
    assert.throws(() => leaveMuseumInDatabase(db, users[1].id, museums[0].id), /audit failure/);
    assert.deepEqual(snapshot(db), before);
    assert.equal(
      requireMuseumAccessInDatabase(db, users[1].id, museums[0].id).role,
      "collaborator",
    );
    db.exec("DROP TRIGGER fail_membership_audit");
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museums[0].id);
    leaveMuseumInDatabase(db, users[1].id, museums[0].id);
    leaveMuseumInDatabase(db, users[1].id, museums[0].id);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='membership.leave'").get()?.n,
      1,
    );
    assert.throws(() => requireMuseumAccessInDatabase(db, users[1].id, museums[0].id));
  } finally {
    db.close();
  }
});

test("unauthorized invitation changes and invalid leave attempts cannot write success events", () => {
  const { db, users, museums, invite } = fixture();
  try {
    const created = invite();
    const before = snapshot(db);
    assert.throws(
      () => revokeOwnInviteInDatabase(db, users[1].id, created.invite.id),
      /INVITE_NOT_FOUND/,
    );
    assert.throws(
      () =>
        createOwnInviteInDatabase(db, users[3].id, {
          useMode: "single-use",
          maxUses: 1,
          expiresAt: null,
        }),
      /OWNER_REQUIRED/,
    );
    assert.throws(() => revokeOwnInviteInDatabase(db, users[0].id, "missing"), /INVITE_NOT_FOUND/);
    assert.throws(
      () => leaveMuseumInDatabase(db, users[0].id, museums[0].id),
      /OWNER_CANNOT_LEAVE/,
    );
    assert.throws(
      () => leaveMuseumInDatabase(db, users[1].id, museums[0].id),
      /MEMBERSHIP_NOT_FOUND/,
    );
    assert.throws(
      () => leaveMuseumInDatabase(db, "missing", museums[0].id),
      /MEMBERSHIP_NOT_FOUND/,
    );
    assert.deepEqual(snapshot(db), before);
  } finally {
    db.close();
  }
});

test("invalid, expired, revoked, exhausted or ineligible join requests leave no join event", () => {
  const { db, users, museums, invite } = fixture();
  try {
    const created = invite();
    const before = snapshot(db);
    for (const token of ["invalid", "a".repeat(43)])
      assert.throws(() => acceptInviteInDatabase(db, users[1].id, token));
    for (const userId of [users[0].id, users[3].id, "missing"])
      assert.throws(() => acceptInviteInDatabase(db, userId, created.token));
    assert.deepEqual(snapshot(db), before);
    for (const sql of [
      "UPDATE users SET email_verified=0",
      "UPDATE invite_links SET expires_at='2000-01-01T00:00:00.000Z'",
      "UPDATE invite_links SET revoked_at='revoked'",
      "UPDATE invite_links SET usage_count=1",
      "UPDATE museums SET status='pending_deletion'",
    ]) {
      db.exec(sql);
      const denied = snapshot(db);
      assert.throws(() => acceptInviteInDatabase(db, users[1].id, created.token));
      assert.deepEqual(snapshot(db), denied);
      db.exec(
        "UPDATE users SET email_verified=1; UPDATE invite_links SET expires_at=NULL,revoked_at=NULL,usage_count=0; UPDATE museums SET status='active'",
      );
    }
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='membership.join'").get()?.n,
      0,
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS n FROM museum_memberships WHERE museum_id=?")
        .get(museums[0].id)?.n,
      0,
    );
  } finally {
    db.close();
  }
});

test("nested invite/join/leave transactions cannot commit audit events past an outer rollback", () => {
  const { db, users, museums, invite } = fixture();
  try {
    const before = snapshot(db);
    assert.throws(
      () =>
        withTransaction(db, () => {
          const created = invite();
          acceptInviteInDatabase(db, users[1].id, created.token);
          leaveMuseumInDatabase(db, users[1].id, museums[0].id);
          throw new Error("outer failure");
        }),
      /outer failure/,
    );
    assert.deepEqual(snapshot(db), before);
  } finally {
    db.close();
  }
});
