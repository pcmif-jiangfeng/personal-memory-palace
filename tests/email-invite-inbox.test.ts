import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { createEmailInviteInDatabase } from "../src/data/email-invites.ts";
import { readEmailInviteInboxInDatabase } from "../src/data/email-invite-inbox.ts";

test("verified invitation inbox exposes only the current recipient's safe metadata and does not accept invitations", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const users = ["owner", "target", "other"].map((name) =>
      createUserInDatabase(db, {
        email: `${name}@example.com`,
        displayName: name,
        passwordHash: "hash",
      }),
    );
    db.exec("UPDATE users SET email_verified=1");
    const museum = createMuseumInDatabase(db, {
      ownerId: users[0].id,
      name: "一起记忆",
      slug: "together",
      museumType: "shared",
    });
    const invite = createEmailInviteInDatabase(db, users[0].id, museum.id, users[1].email).invite;
    createEmailInviteInDatabase(db, users[0].id, museum.id, users[2].email);
    const inbox = readEmailInviteInboxInDatabase(db, users[1].id, 1);
    assert.equal(inbox.total, 1);
    assert.equal(inbox.invites[0].id, invite.id);
    assert.equal(inbox.invites[0].museum.name, "一起记忆");
    assert.equal(inbox.invites[0].status, "pending");
    assert.equal(JSON.stringify(inbox).includes("@"), false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM museum_memberships").get()?.n, 0);
    assert.equal(readEmailInviteInboxInDatabase(db, users[2].id, 1, invite.id).total, 0);
    assert.throws(() => readEmailInviteInboxInDatabase(db, null, 1), /USER_REQUIRED/);
    db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(users[1].id);
    assert.throws(
      () => readEmailInviteInboxInDatabase(db, users[1].id, 1),
      /EMAIL_VERIFICATION_REQUIRED/,
    );
    db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(users[1].id);
    db.prepare(
      "UPDATE collaboration_invites SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    ).run(invite.id);
    assert.equal(readEmailInviteInboxInDatabase(db, users[1].id, 1).invites[0].status, "expired");
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museum.id);
    assert.equal(readEmailInviteInboxInDatabase(db, users[1].id, 1).total, 0);
    assert.throws(() => readEmailInviteInboxInDatabase(db, users[1].id, 0), /INVALID_PAGE/);
  } finally {
    db.close();
  }
});
