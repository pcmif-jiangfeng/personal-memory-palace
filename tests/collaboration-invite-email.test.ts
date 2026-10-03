import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { createAndSendEmailInviteInDatabase } from "../src/application/collaboration-invites.ts";
import { sendCollaborationInviteEmail } from "../src/email/collaboration-invites.ts";

test("failed delivery preserves a pending invitation and retry does not extend or authorize it", async () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const owner = createUserInDatabase(db, {
      email: "owner@example.com",
      displayName: "馆长",
      passwordHash: "hash",
    });
    db.exec("UPDATE users SET email_verified=1");
    const museum = createMuseumInDatabase(db, {
      ownerId: owner.id,
      name: "共同宫殿",
      slug: "together",
      museumType: "shared",
    });
    const failed = await createAndSendEmailInviteInDatabase(
      db,
      owner.id,
      museum.id,
      "target@example.com",
      async () => {
        throw new Error("provider unavailable");
      },
    );
    assert.equal(failed.delivery, "failed");
    assert.equal(failed.invite.status, "pending");
    let delivered = false;
    const retried = await createAndSendEmailInviteInDatabase(
      db,
      owner.id,
      museum.id,
      "target@example.com",
      async (invite) => {
        assert.equal(
          db.isTransaction,
          false,
          "network delivery must not hold a SQLite transaction",
        );
        assert.deepEqual(invite, failed.invite);
        delivered = true;
      },
    );
    assert.equal(delivered, true);
    assert.equal(retried.delivery, "accepted");
    assert.equal(retried.created, false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM museum_memberships").get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM collaboration_invites").get()?.n, 1);
  } finally {
    db.close();
  }
});

test("invitation mail uses the existing sender and a locator, not a bearer permission", async () => {
  const id = "14a89bc5-9cfa-4ec4-8af4-f376c3042713";
  const expiresAt = "2026-10-10T12:00:00.000Z";
  let message: Record<string, string> | undefined;
  await sendCollaborationInviteEmail(
    { id, targetEmail: "target@example.com", expiresAt },
    { apiKey: "test-only", from: "Palace <no-reply@example.com>" },
    async (_url, init) => {
      message = JSON.parse(String(init?.body));
      return Response.json({ id: "b50f37ca-7356-461b-8de0-54c654349de5" });
    },
  );
  assert.equal(message?.to, "target@example.com");
  assert.match(message!.text, /account\/invites\?inviteId=/);
  assert.ok(message!.text.includes(id));
  assert.ok(message!.text.includes(expiresAt));
  assert.ok(message!.text.includes("验证"));
  assert.equal(message!.text.includes("#"), false);
  await assert.rejects(
    sendCollaborationInviteEmail(
      { id: '\"><script>', targetEmail: "target@example.com", expiresAt },
      { apiKey: "test-only", from: "test" },
    ),
    /Invalid invitation locator/,
  );
});
