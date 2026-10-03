import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import {
  createEmailInviteInDatabase,
  listEmailInvitesInDatabase,
  revokeEmailInviteInDatabase,
} from "../src/data/email-invites.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "member", "outsider"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "hash",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const museum = createMuseumInDatabase(db, {
    ownerId: users[0].id,
    name: "共同回忆",
    slug: "together",
    museumType: "shared",
  });
  return { db, users, museum };
}

test("email invite normalizes its target, lasts exactly seven days, and a repeat never extends it", () => {
  const { db, users, museum } = fixture();
  try {
    const first = createEmailInviteInDatabase(db, users[0].id, museum.id, "  NEW@Example.com  ");
    assert.equal(first.invite.targetEmail, "new@example.com");
    assert.equal(
      Date.parse(first.invite.expiresAt) - Date.parse(first.invite.createdAt),
      7 * 24 * 60 * 60 * 1000,
    );
    assert.equal(first.created, true);
    const repeat = createEmailInviteInDatabase(db, users[0].id, museum.id, "new@example.com");
    assert.deepEqual(repeat.invite, first.invite);
    assert.equal(repeat.created, false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM collaboration_invites").get()?.n, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='invite.create'").get()?.n,
      1,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM invite_links").get()?.n, 0);
    assert.equal("token" in first, false);
    assert.deepEqual(listEmailInvitesInDatabase(db, users[0].id, museum.id, 1).invites, [
      first.invite,
    ]);
  } finally {
    db.close();
  }
});

test("only the active palace owner manages invites, and owners and active members cannot be invited", () => {
  const { db, users, museum } = fixture();
  try {
    db.prepare(
      "INSERT INTO museum_memberships(museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
    ).run(museum.id, users[1].id);
    for (const email of [users[0].email, users[1].email])
      assert.throws(
        () => createEmailInviteInDatabase(db, users[0].id, museum.id, email),
        /ALREADY_MUSEUM_MEMBER/,
      );
    for (const user of users.slice(1)) {
      assert.throws(() => createEmailInviteInDatabase(db, user.id, museum.id, "new@example.com"));
      assert.throws(() => listEmailInvitesInDatabase(db, user.id, museum.id, 1));
    }
    db.prepare("UPDATE museum_memberships SET status='revoked'").run();
    const invite = createEmailInviteInDatabase(db, users[0].id, museum.id, users[1].email).invite;
    assert.throws(() => revokeEmailInviteInDatabase(db, users[2].id, museum.id, invite.id));
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museum.id);
    assert.throws(
      () => createEmailInviteInDatabase(db, users[0].id, museum.id, "new@example.com"),
      /MUSEUM_NOT_FOUND/,
    );
    assert.throws(
      () => revokeEmailInviteInDatabase(db, users[0].id, museum.id, invite.id),
      /MUSEUM_NOT_FOUND/,
    );
    assert.throws(
      () => listEmailInvitesInDatabase(db, users[0].id, museum.id, 1),
      /MUSEUM_NOT_FOUND/,
    );
  } finally {
    db.close();
  }
});

test("revocation is idempotent; revoked and expired invitations get fresh identities without reactivation", () => {
  const { db, users, museum } = fixture();
  try {
    const first = createEmailInviteInDatabase(db, users[0].id, museum.id, "new@example.com").invite;
    const revoked = revokeEmailInviteInDatabase(db, users[0].id, museum.id, first.id);
    assert.equal(revoked.status, "revoked");
    assert.deepEqual(revokeEmailInviteInDatabase(db, users[0].id, museum.id, first.id), revoked);
    const second = createEmailInviteInDatabase(
      db,
      users[0].id,
      museum.id,
      first.targetEmail,
    ).invite;
    assert.notEqual(second.id, first.id);
    db.prepare(
      "UPDATE collaboration_invites SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    ).run(second.id);
    assert.equal(
      listEmailInvitesInDatabase(db, users[0].id, museum.id, 1).invites.find(
        (i) => i.id === second.id,
      )?.status,
      "expired",
    );
    const third = createEmailInviteInDatabase(db, users[0].id, museum.id, first.targetEmail).invite;
    assert.notEqual(third.id, second.id);
    assert.equal(
      db.prepare("SELECT status FROM collaboration_invites WHERE id=?").get(second.id)?.status,
      "expired",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='invite.revoke'").get()?.n,
      1,
    );
  } finally {
    db.close();
  }
});

test("malformed targets/pages are rejected and invitation writes roll back with audit failure", () => {
  const { db, users, museum } = fixture();
  try {
    for (const email of ["", "invalid", "a b@example.com", "a@b", "x".repeat(255) + "@example.com"])
      assert.throws(
        () => createEmailInviteInDatabase(db, users[0].id, museum.id, email),
        /INVALID_EMAIL/,
      );
    for (const page of [0, -1, 1.5, Number.NaN])
      assert.throws(
        () => listEmailInvitesInDatabase(db, users[0].id, museum.id, page),
        /INVALID_PAGE/,
      );
    db.exec(
      "CREATE TRIGGER reject_invite_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failed'); END",
    );
    assert.throws(
      () => createEmailInviteInDatabase(db, users[0].id, museum.id, "new@example.com"),
      /audit failed/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM collaboration_invites").get()?.n, 0);
    db.exec("DROP TRIGGER reject_invite_audit");
    const invite = createEmailInviteInDatabase(
      db,
      users[0].id,
      museum.id,
      "new@example.com",
    ).invite;
    db.exec(
      "CREATE TRIGGER reject_invite_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failed'); END",
    );
    assert.throws(
      () => revokeEmailInviteInDatabase(db, users[0].id, museum.id, invite.id),
      /audit failed/,
    );
    assert.equal(
      db.prepare("SELECT status FROM collaboration_invites WHERE id=?").get(invite.id)?.status,
      "pending",
    );
  } finally {
    db.close();
  }
});

test("migration 31 creates isolated email invitations, leaves old links untouched and is idempotent", () => {
  const { db, users, museum } = fixture();
  try {
    db.prepare(
      "INSERT INTO invite_links(id,museum_id,token_hash,created_at,revoked_at) VALUES ('old',?,?,'before','revoked')",
    ).run(museum.id, "a".repeat(64));
    const before = db.prepare("SELECT * FROM invite_links").all();
    db.exec("DELETE FROM schema_migrations WHERE version=31; DROP TABLE collaboration_invites");
    runDatabaseMigrations(db);
    assert.deepEqual(db.prepare("SELECT * FROM invite_links").all(), before);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM collaboration_invites").get()?.n, 0);
    const created = createEmailInviteInDatabase(db, users[0].id, museum.id, "new@example.com");
    runDatabaseMigrations(db);
    assert.deepEqual(listEmailInvitesInDatabase(db, users[0].id, museum.id, 1).invites, [
      created.invite,
    ]);
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO collaboration_invites(id,museum_id,target_email,created_at,expires_at) VALUES ('duplicate',?,?,'now','later')",
          )
          .run(museum.id, created.invite.targetEmail),
      /UNIQUE/,
    );
  } finally {
    db.close();
  }
});
