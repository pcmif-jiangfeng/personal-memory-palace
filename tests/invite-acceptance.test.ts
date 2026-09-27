import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { createOwnInviteInDatabase } from "../src/data/invite-management.ts";
import { acceptInviteInDatabase } from "../src/data/invite-acceptance.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "first", "second", "unverified", "no-museum"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "hash",
    }),
  );
  for (const user of users) {
    if (user.displayName !== "unverified")
      db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(user.id);
    if (user.displayName !== "no-museum")
      createMuseumInDatabase(db, {
        ownerId: user.id,
        name: user.displayName,
        slug: user.displayName,
      });
  }
  const invite = (maxUses: number | null = 1) =>
    createOwnInviteInDatabase(db, users[0].id, {
      useMode: maxUses === 1 ? "single-use" : "multi-use",
      maxUses,
      expiresAt: null,
    });
  return { db, users, invite };
}

test("single-use accepts one collaborator and duplicate retry does not consume another use", () => {
  const { db, users, invite } = fixture();
  try {
    const created = invite();
    const accepted = acceptInviteInDatabase(db, users[1].id, created.token);
    assert.equal(accepted.alreadyMember, false);
    assert.equal(acceptInviteInDatabase(db, users[1].id, created.token).alreadyMember, true);
    assert.throws(
      () => acceptInviteInDatabase(db, users[2].id, created.token),
      /INVITE_UNAVAILABLE/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM museum_memberships").get()?.count, 1);
    assert.equal(
      db.prepare("SELECT usage_count FROM invite_links WHERE id=?").get(created.invite.id)
        ?.usage_count,
      1,
    );
  } finally {
    db.close();
  }
});

test("acceptance requires verified email and own museum; owner cannot consume own invite", () => {
  const { db, users, invite } = fixture();
  try {
    const created = invite();
    for (const [index, code] of [
      [3, "EMAIL_VERIFICATION_REQUIRED"],
      [4, "OWN_MUSEUM_REQUIRED"],
      [0, "OWN_INVITE"],
    ] as const)
      assert.throws(
        () => acceptInviteInDatabase(db, users[index].id, created.token),
        new RegExp(code),
      );
    assert.throws(() => acceptInviteInDatabase(db, "missing", created.token), /USER_REQUIRED/);
    assert.throws(() => acceptInviteInDatabase(db, users[1].id, "invalid"), /INVALID_INVITE_TOKEN/);
    assert.equal(db.prepare("SELECT usage_count FROM invite_links").get()?.usage_count, 0);
  } finally {
    db.close();
  }
});

test("expired, revoked, unknown and inactive museum invites cannot be accepted", () => {
  const { db, users, invite } = fixture();
  try {
    const expired = invite();
    db.prepare("UPDATE invite_links SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(
      expired.invite.id,
    );
    const revoked = invite();
    db.prepare("UPDATE invite_links SET revoked_at='now' WHERE id=?").run(revoked.invite.id);
    for (const token of [expired.token, revoked.token, "a".repeat(43)])
      assert.throws(() => acceptInviteInDatabase(db, users[1].id, token), /INVITE_UNAVAILABLE/);
    const pending = invite();
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE owner_id=?").run(users[0].id);
    assert.throws(
      () => acceptInviteInDatabase(db, users[1].id, pending.token),
      /INVITE_UNAVAILABLE/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM museum_memberships").get()?.count, 0);
  } finally {
    db.close();
  }
});

test("multi-use allows multiple users, reactivates revoked membership and enforces cap", () => {
  const { db, users, invite } = fixture();
  try {
    const created = invite(3);
    const first = acceptInviteInDatabase(db, users[1].id, created.token);
    acceptInviteInDatabase(db, users[2].id, created.token);
    db.prepare(
      "UPDATE museum_memberships SET status='revoked' WHERE museum_id=? AND user_id=?",
    ).run(first.museum.id, users[1].id);
    acceptInviteInDatabase(db, users[1].id, created.token);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM museum_memberships").get()?.count, 2);
    assert.equal(
      db.prepare("SELECT usage_count FROM invite_links WHERE id=?").get(created.invite.id)
        ?.usage_count,
      3,
    );
    db.prepare("UPDATE museum_memberships SET status='revoked' WHERE user_id=?").run(users[2].id);
    assert.throws(
      () => acceptInviteInDatabase(db, users[2].id, created.token),
      /INVITE_UNAVAILABLE/,
    );
    const unlimited = invite(null);
    acceptInviteInDatabase(db, users[2].id, unlimited.token);
    assert.equal(
      db.prepare("SELECT usage_count FROM invite_links WHERE id=?").get(unlimited.invite.id)
        ?.usage_count,
      1,
    );
  } finally {
    db.close();
  }
});

test("membership and usage update roll back together on write failure", () => {
  const { db, users, invite } = fixture();
  try {
    const created = invite();
    db.exec(
      "CREATE TRIGGER fail_usage BEFORE UPDATE ON invite_links BEGIN SELECT RAISE(ABORT,'test failure'); END;",
    );
    assert.throws(() => acceptInviteInDatabase(db, users[1].id, created.token), /test failure/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM museum_memberships").get()?.count, 0);
    assert.equal(db.prepare("SELECT usage_count FROM invite_links").get()?.usage_count, 0);
  } finally {
    db.close();
  }
});
