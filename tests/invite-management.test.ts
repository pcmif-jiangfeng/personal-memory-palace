import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import {
  createOwnInviteInDatabase,
  listOwnInvitesInDatabase,
  revokeOwnInviteInDatabase,
} from "../src/data/invite-management.ts";
import { parseCreateInvite } from "../src/http/invite-management.ts";

test("invite input validates mode, limits and future expiry", async () => {
  const request = (body: unknown) =>
    new Request("http://localhost/api/invites", { method: "POST", body: JSON.stringify(body) });
  assert.deepEqual(
    await parseCreateInvite(request({ useMode: "single-use", maxUses: 1, expiresAt: null })),
    { useMode: "single-use", maxUses: 1, expiresAt: null },
  );
  assert.deepEqual(
    await parseCreateInvite(request({ useMode: "multi-use", maxUses: null, expiresAt: null })),
    { useMode: "multi-use", maxUses: null, expiresAt: null },
  );
  for (const body of [
    {},
    { useMode: "unknown" },
    { useMode: "single-use", maxUses: null, expiresAt: null },
    { useMode: "multi-use", maxUses: 0, expiresAt: null },
    { useMode: "multi-use", maxUses: 1.5, expiresAt: null },
    { useMode: "multi-use", maxUses: 1, expiresAt: "yesterday" },
    { useMode: "single-use", maxUses: 1, expiresAt: "2000-01-01T00:00:00.000Z" },
  ])
    await assert.rejects(parseCreateInvite(request(body)));
});

test("only Museum Owner can create/list/revoke invites and token is not stored or listed", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const users = ["one", "two", "collaborator"].map((name) =>
      createUserInDatabase(db, {
        email: `${name}@example.com`,
        displayName: name,
        passwordHash: "hash",
      }),
    );
    db.exec("UPDATE users SET email_verified=1");
    const one = createMuseumInDatabase(db, { ownerId: users[0].id, name: "一", slug: "one" });
    createMuseumInDatabase(db, { ownerId: users[1].id, name: "二", slug: "two" });
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
    ).run(one.id, users[2].id);
    const created = createOwnInviteInDatabase(db, users[0].id, {
      useMode: "single-use",
      maxUses: 1,
      expiresAt: null,
    });
    assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(
      db.prepare("SELECT token_hash FROM invite_links WHERE id = ?").get(created.invite.id)
        ?.token_hash,
      createHash("sha256").update(created.token).digest("hex"),
    );
    const listed = listOwnInvitesInDatabase(db, users[0].id, 1);
    assert.equal(listed.invites[0].id, created.invite.id);
    assert.equal(JSON.stringify(listed).includes(created.token), false);
    assert.equal("token_hash" in listed.invites[0], false);
    assert.equal(Object.getPrototypeOf(listed.invites[0]), Object.prototype);
    assert.equal(listOwnInvitesInDatabase(db, users[1].id, 1).invites.length, 0);
    assert.throws(
      () => revokeOwnInviteInDatabase(db, users[1].id, created.invite.id),
      /INVITE_NOT_FOUND/,
    );
    for (const operation of [
      () => listOwnInvitesInDatabase(db, users[2].id, 1),
      () =>
        createOwnInviteInDatabase(db, users[2].id, {
          useMode: "single-use",
          maxUses: 1,
          expiresAt: null,
        }),
      () => revokeOwnInviteInDatabase(db, users[2].id, created.invite.id),
    ])
      assert.throws(operation, /OWNER_REQUIRED/);
    const revoked = revokeOwnInviteInDatabase(db, users[0].id, created.invite.id);
    assert.ok(revoked.revokedAt);
    assert.deepEqual(revokeOwnInviteInDatabase(db, users[0].id, created.invite.id), revoked);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM museum_memberships").get()?.count, 1);
    for (let i = 0; i < 21; i++)
      createOwnInviteInDatabase(db, users[0].id, {
        useMode: "multi-use",
        maxUses: null,
        expiresAt: null,
      });
    const first = listOwnInvitesInDatabase(db, users[0].id, 1);
    const second = listOwnInvitesInDatabase(db, users[0].id, 2);
    assert.equal(first.invites.length, 20);
    assert.equal(first.total, 22);
    assert.equal(second.invites.length, 2);
    assert.equal(
      new Set([...first.invites, ...second.invites].map((invite) => invite.id)).size,
      22,
    );
  } finally {
    db.close();
  }
});

test("invite summaries reject malformed SQLite columns and roll back revocation", (t) => {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  const owner = createUserInDatabase(db, {
    email: "summary@example.com",
    displayName: "Owner",
    passwordHash: "hash",
  });
  db.exec("UPDATE users SET email_verified=1");
  createMuseumInDatabase(db, { ownerId: owner.id, name: "Summary", slug: "summary" });
  const { invite } = createOwnInviteInDatabase(db, owner.id, {
    useMode: "multi-use",
    maxUses: null,
    expiresAt: null,
  });
  assert.deepEqual(listOwnInvitesInDatabase(db, owner.id, 1).invites, [invite]);
  assert.equal(invite.maxUses, null);
  assert.equal(invite.usageCount, 0);
  // SQLite can hold a BLOB in a TEXT column; do not send it to the client as a string.
  db.prepare("UPDATE invite_links SET created_at=? WHERE id=?").run(
    new Uint8Array([1, 2, 3]),
    invite.id,
  );
  assert.throws(() => listOwnInvitesInDatabase(db, owner.id, 1), /createdAt/);
  assert.throws(() => revokeOwnInviteInDatabase(db, owner.id, invite.id), /createdAt/);
  assert.equal(
    db.prepare("SELECT revoked_at FROM invite_links WHERE id=?").get(invite.id)!.revoked_at,
    null,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='invite.revoke'").get()!.n,
    0,
  );
});
