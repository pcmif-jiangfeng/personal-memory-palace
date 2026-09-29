import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import {
  createMuseumInDatabase,
  findMuseumByIdInDatabase,
  findMuseumByOwnerIdInDatabase,
} from "../src/data/museum-repository.ts";
import { transferMuseumOwnerInDatabase } from "../src/data/museum-owner-transfer.ts";
import {
  requireMuseumAccessInDatabase,
  requireMuseumOwnerInDatabase,
} from "../src/data/museum-access.ts";
import { updateOwnMuseumProfileInDatabase } from "../src/data/museum-profile.ts";
import { updateOwnMuseumSlugInDatabase } from "../src/data/museum-slug.ts";
import {
  createOwnInviteInDatabase,
  listOwnInvitesInDatabase,
  revokeOwnInviteInDatabase,
} from "../src/data/invite-management.ts";
import { listSwitcherMuseumsInDatabase } from "../src/data/museum-switcher.ts";
import { currentSwitcherMuseum } from "../src/domain/museum-switcher.ts";
import { parseMuseumOwnerTransfer } from "../src/http/museum-owner-transfer.ts";
import { readMuseumSelection, requestMuseumSelection } from "../src/http/museum-selection.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { ApiError } from "../src/http/errors.ts";
import { createOwnMuseumInDatabase } from "../src/data/museum-onboarding.ts";

function fixture(t: TestContext) {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  const users = ["owner", "target", "other", "outsider"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "PRIVATE-HASH",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const museums = users.map((user) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      name: user.displayName,
      slug: user.displayName,
      storageQuotaBytes: 123456,
    }),
  );
  for (const user of users.slice(1, 3))
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'before','before')",
    ).run(museums[0].id, user.id);
  db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES ('private',?,'PRIVATE-TITLE','PRIVATE-STORY','before','before')",
  ).run(museums[0].id);
  const input = {
    confirm: true as const,
    targetUserId: users[1].id,
    oldOwnerDisposition: "stay" as "stay" | "leave",
    version: museums[0].version,
  };
  const transfer = (actor: string | null = users[0].id) =>
    transferMuseumOwnerInDatabase(db, actor, museums[0].id, input);
  return { db, users, museums, input, transfer };
}

test("migration 22 upgrades an existing single-owner database without changing content or permitting repeated onboarding", (t) => {
  const f = fixture(t);
  f.db.exec(
    "DELETE FROM schema_migrations WHERE version=22; DROP INDEX museums_owner_index; CREATE UNIQUE INDEX museums_owner_unique ON museums(owner_id)",
  );
  const before = f.db.prepare("SELECT * FROM museums ORDER BY id").all();
  const content = f.db.prepare("SELECT * FROM memories").all();
  runDatabaseMigrations(f.db);
  assert.deepEqual(f.db.prepare("SELECT * FROM museums ORDER BY id").all(), before);
  assert.deepEqual(f.db.prepare("SELECT * FROM memories").all(), content);
  assert.equal(
    f.db.prepare("SELECT name FROM sqlite_master WHERE name='museums_owner_unique'").get(),
    undefined,
  );
  f.transfer();
  runDatabaseMigrations(f.db);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM museums WHERE owner_id=?").get(f.users[1].id)!.n,
    2,
  );
  assert.throws(
    () =>
      createOwnMuseumInDatabase(f.db, f.users[1].id, {
        name: "Extra",
        slug: "extra",
        description: "",
      }),
    /MUSEUM_ALREADY_EXISTS/,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version=22").get()!.n,
    1,
  );
});

for (const disposition of ["stay", "leave"] as const)
  test(`transfer keeps recipient's original Museum and all content; former Owner ${disposition}`, (t) => {
    const f = fixture(t);
    f.input.oldOwnerDisposition = disposition;
    const memories = f.db.prepare("SELECT * FROM memories").all();
    const original = findMuseumByIdInDatabase(f.db, f.museums[1].id);
    f.transfer();
    const museum = findMuseumByIdInDatabase(f.db, f.museums[0].id)!;
    assert.equal(museum.ownerId, f.users[1].id);
    assert.equal(museum.version, f.museums[0].version + 1);
    for (const key of [
      "id",
      "slug",
      "name",
      "description",
      "coverPhotoId",
      "storageQuotaBytes",
      "storageUsedBytes",
      "status",
      "createdAt",
    ] as const)
      assert.equal(museum[key], f.museums[0][key]);
    assert.deepEqual(f.db.prepare("SELECT * FROM memories").all(), memories);
    assert.deepEqual(findMuseumByIdInDatabase(f.db, f.museums[1].id), original);
    assert.equal(
      listSwitcherMuseumsInDatabase(f.db, f.users[1].id).filter((m) => m.role === "owner").length,
      2,
    );
    requireMuseumOwnerInDatabase(f.db, f.users[1].id, museum.id);
    assert.throws(() => requireMuseumOwnerInDatabase(f.db, f.users[0].id, museum.id), ApiError);
    if (disposition === "stay")
      assert.equal(
        requireMuseumAccessInDatabase(f.db, f.users[0].id, museum.id).role,
        "collaborator",
      );
    else
      assert.throws(() => requireMuseumAccessInDatabase(f.db, f.users[0].id, museum.id), ApiError);
    assert.equal(
      f.db
        .prepare("SELECT * FROM museum_memberships WHERE museum_id=? AND user_id=?")
        .get(museum.id, f.users[1].id),
      undefined,
    );
    assert.equal(
      requireMuseumAccessInDatabase(f.db, f.users[2].id, museum.id).role,
      "collaborator",
    );
    const audit = f.db
      .prepare("SELECT * FROM audit_logs WHERE action='museum.ownerTransfer'")
      .get()!;
    assert.equal(audit.actor_user_id, f.users[0].id);
    assert.equal(audit.museum_id, museum.id);
    assert.deepEqual(JSON.parse(String(audit.diff)), {
      ownerId: { before: f.users[0].id, after: f.users[1].id },
      oldOwnerDisposition: disposition,
    });
    assert.throws(() => f.transfer(), ApiError);
    assert.equal(
      f.db
        .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='museum.ownerTransfer'")
        .get()!.n,
      1,
    );
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
  });

test("only the current verified Owner can transfer to an active verified collaborator, after explicit confirmation", (t) => {
  const f = fixture(t);
  for (const actor of [null, "missing", f.users[1].id, f.users[2].id, f.users[3].id])
    assert.throws(() => f.transfer(actor), ApiError);
  for (const target of [f.users[0].id, f.users[3].id, "missing"]) {
    f.input.targetUserId = target;
    assert.throws(() => f.transfer(), ApiError);
  }
  f.input.targetUserId = f.users[1].id;
  f.db
    .prepare("UPDATE museum_memberships SET status='revoked' WHERE museum_id=? AND user_id=?")
    .run(f.museums[0].id, f.users[1].id);
  assert.throws(() => f.transfer(), /TRANSFER_TARGET_UNAVAILABLE/);
  f.db.exec("UPDATE museum_memberships SET status='active'");
  for (const user of f.users.slice(0, 2)) {
    f.db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(user.id);
    assert.throws(() => f.transfer(), ApiError);
    f.db.exec("UPDATE users SET email_verified=1");
  }
  assert.throws(
    () =>
      transferMuseumOwnerInDatabase(f.db, f.users[0].id, f.museums[0].id, {
        ...f.input,
        confirm: false,
      } as never),
    /CONFIRMATION/,
  );
  assert.throws(
    () =>
      transferMuseumOwnerInDatabase(f.db, f.users[0].id, f.museums[0].id, {
        ...f.input,
        oldOwnerDisposition: "invalid",
      } as never),
    /DISPOSITION/,
  );
  f.input.version = 2;
  assert.throws(() => f.transfer(), /VERSION_CONFLICT/);
  f.input.version = 1;
  f.db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(f.museums[0].id);
  assert.throws(() => f.transfer(), ApiError);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()!.n, 0);
});

test("failed owner, promotion, former-member or audit writes roll the entire transfer back", (t) => {
  const f = fixture(t);
  const snapshot = () =>
    ["museums", "museum_memberships", "memories", "audit_logs"].map((table) =>
      f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
  const before = snapshot();
  for (const trigger of [
    "BEFORE UPDATE ON museums",
    "BEFORE DELETE ON museum_memberships",
    "BEFORE INSERT ON museum_memberships",
    "BEFORE INSERT ON audit_logs",
  ]) {
    f.db.exec(
      `CREATE TRIGGER fail_transfer ${trigger} BEGIN SELECT RAISE(ABORT,'test failure'); END`,
    );
    assert.throws(() => f.transfer(), /test failure/);
    assert.deepEqual(snapshot(), before);
    f.db.exec("DROP TRIGGER fail_transfer");
  }
});

test("multi-owned management is explicitly bound, never falls back after a transfer, and cannot cross Museums", (t) => {
  const f = fixture(t);
  f.transfer();
  const profile = { name: "Updated", description: "", coverPhotoId: null, version: 2 };
  const inviteInput = { useMode: "single-use" as const, maxUses: 1, expiresAt: null };
  for (const action of [
    () => updateOwnMuseumProfileInDatabase(f.db, f.users[1].id, profile),
    () => updateOwnMuseumSlugInDatabase(f.db, f.users[1].id, "changed"),
    () => createOwnInviteInDatabase(f.db, f.users[1].id, inviteInput),
    () => listOwnInvitesInDatabase(f.db, f.users[1].id, 1),
  ])
    assert.throws(action, /MUSEUM_SELECTION_REQUIRED/);
  const original = findMuseumByIdInDatabase(f.db, f.museums[1].id);
  assert.equal(
    updateOwnMuseumProfileInDatabase(f.db, f.users[1].id, profile, f.museums[0].id).id,
    f.museums[0].id,
  );
  assert.equal(
    updateOwnMuseumSlugInDatabase(f.db, f.users[1].id, "changed", f.museums[0].id).id,
    f.museums[0].id,
  );
  const invite = createOwnInviteInDatabase(f.db, f.users[1].id, inviteInput, f.museums[0].id);
  assert.equal(listOwnInvitesInDatabase(f.db, f.users[1].id, 1, f.museums[0].id).total, 1);
  assert.equal(listOwnInvitesInDatabase(f.db, f.users[1].id, 1, f.museums[1].id).total, 0);
  assert.throws(
    () => revokeOwnInviteInDatabase(f.db, f.users[1].id, invite.invite.id, f.museums[1].id),
    /INVITE_NOT_FOUND/,
  );
  for (const actor of [f.users[0].id, f.users[2].id, f.users[3].id]) {
    assert.throws(
      () =>
        updateOwnMuseumProfileInDatabase(f.db, actor, { ...profile, version: 4 }, f.museums[0].id),
      ApiError,
    );
    assert.throws(
      () => updateOwnMuseumSlugInDatabase(f.db, actor, "hijacked", f.museums[0].id),
      ApiError,
    );
    assert.throws(
      () => createOwnInviteInDatabase(f.db, actor, inviteInput, f.museums[0].id),
      ApiError,
    );
    assert.throws(() => listOwnInvitesInDatabase(f.db, actor, 1, f.museums[0].id), ApiError);
    assert.throws(
      () => revokeOwnInviteInDatabase(f.db, actor, invite.invite.id, f.museums[0].id),
      ApiError,
    );
  }
  revokeOwnInviteInDatabase(f.db, f.users[1].id, invite.invite.id, f.museums[0].id);
  assert.deepEqual(findMuseumByIdInDatabase(f.db, f.museums[1].id), original);
  const entries = listSwitcherMuseumsInDatabase(f.db, f.users[1].id);
  assert.equal(currentSwitcherMuseum(entries, "/account", f.museums[0].id)?.id, f.museums[0].id);
  assert.equal(currentSwitcherMuseum(entries, "/account", "unavailable"), null);
  assert.equal(
    currentSwitcherMuseum(entries, `/account/museums/${f.museums[0].id}/transfer`, f.museums[1].id)
      ?.id,
    f.museums[0].id,
  );
  assert.equal(
    currentSwitcherMuseum(entries, "/account")?.id,
    findMuseumByOwnerIdInDatabase(f.db, f.users[1].id)?.id,
  );
  runDatabaseMigrations(f.db);
  assert.equal(entries.filter((m) => m.role === "owner").length, 2);
});

test("a stale confirmation cannot reverse a later transfer even when the original Owner regains ownership", (t) => {
  const f = fixture(t);
  f.transfer();
  transferMuseumOwnerInDatabase(f.db, f.users[1].id, f.museums[0].id, {
    ...f.input,
    targetUserId: f.users[0].id,
    version: 2,
  });
  assert.throws(() => f.transfer(), /VERSION_CONFLICT/);
  assert.equal(findMuseumByIdInDatabase(f.db, f.museums[0].id)!.ownerId, f.users[0].id);
});

test("transfer payload and Museum selection reject ambiguity, forged actors and invalid inputs", async () => {
  const valid = { confirm: true, targetUserId: "target", oldOwnerDisposition: "leave", version: 1 };
  const request = (body: unknown) =>
    new Request("http://localhost/api/museums/m/transfer", {
      method: "POST",
      body: JSON.stringify(body),
    });
  assert.deepEqual(await parseMuseumOwnerTransfer(request(valid)), valid);
  for (const body of [
    {},
    { ...valid, confirm: "true" },
    { ...valid, actorUserId: "owner" },
    { ...valid, targetUserId: "../target" },
    { ...valid, version: 1.5 },
    { ...valid, version: 0 },
    { ...valid, oldOwnerDisposition: "unknown" },
  ])
    await assert.rejects(parseMuseumOwnerTransfer(request(body)), ApiError);
  assert.equal(readMuseumSelection(undefined), null);
  assert.equal(readMuseumSelection("museum"), "museum");
  for (const value of ["", ["a", "b"], "../a"])
    assert.throws(() => readMuseumSelection(value), ApiError);
  assert.throws(
    () => requestMuseumSelection(new Request("http://localhost/api/museums?museumId=a&museumId=b")),
    ApiError,
  );
});
