import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import {
  scheduleMuseumDeletionInDatabase as schedule,
  cancelMuseumDeletionInDatabase as cancel,
} from "../src/data/museum-deletion.ts";
import {
  createOwnerTransferRequestInDatabase as transfer,
  resolveOwnerTransferRequestInDatabase as accept,
} from "../src/data/owner-transfer-requests.ts";
import { configureScopedShare } from "../src/data/scoped-share.ts";
import { getSharedMemoryInDatabase } from "../src/data/share-repository.ts";

test("shared deletion with active members invalidates transfers and respects the exact cancellation deadline", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const users = ["owner", "member"].map((name) =>
      createUserInDatabase(db, {
        email: `${name}@example.com`,
        displayName: name,
        passwordHash: "hash",
      }),
    );
    db.exec("UPDATE users SET email_verified=1");
    const museum = createMuseumInDatabase(db, {
      ownerId: users[0].id,
      museumType: "shared",
      name: "Shared",
      slug: "shared",
      storageQuotaBytes: 100,
    });
    createMuseumInDatabase(db, {
      ownerId: users[1].id,
      name: "Private",
      slug: "private",
      storageQuotaBytes: 100,
    });
    db.prepare(
      "INSERT INTO museum_memberships(museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
    ).run(museum.id, users[1].id);
    for (const id of ["enabled", "disabled"])
      db.prepare(
        "INSERT INTO memories(id,museum_id,title,story,created_at,updated_at) VALUES (?,?,'Title','Story','now','now')",
      ).run(id, museum.id);
    const scope = { userId: users[0].id, museumId: museum.id };
    const enabled = configureScopedShare(db, scope, "enabled", { enabled: true, mode: "link" })!;
    const disabled = configureScopedShare(db, scope, "disabled", { enabled: true, mode: "link" })!;
    configureScopedShare(db, scope, "disabled", { enabled: false, mode: "link" });
    const request = transfer(db, users[0].id, museum.id, {
      confirm: true,
      targetUserId: users[1].id,
      version: 1,
    });
    const pending = schedule(
      db,
      users[0].id,
      museum.id,
      { confirm: true, version: 1 },
      new Date("2026-10-03T00:00:00.000Z"),
    );
    assert.equal(pending.deletionScheduledAt, "2026-11-02T00:00:00.000Z");
    assert.equal(
      db.prepare("SELECT status FROM owner_transfer_requests WHERE id=?").get(request.id)!.status,
      "invalidated",
    );
    assert.equal(getSharedMemoryInDatabase(db, enabled), null);
    assert.equal(getSharedMemoryInDatabase(db, disabled), null);
    assert.throws(
      () =>
        accept(db, users[1].id, museum.id, {
          requestId: request.id,
          action: "accept",
          confirm: true,
        }),
      /MUSEUM_NOT_FOUND/,
    );
    assert.throws(
      () =>
        cancel(
          db,
          users[0].id,
          museum.id,
          { confirm: true, version: 2 },
          new Date(pending.deletionScheduledAt!),
        ),
      /DELETION_DEADLINE_PASSED/,
    );
    cancel(
      db,
      users[0].id,
      museum.id,
      { confirm: true, version: 2 },
      new Date(Date.parse(pending.deletionScheduledAt!) - 1),
    );
    assert.ok(getSharedMemoryInDatabase(db, enabled));
    assert.equal(getSharedMemoryInDatabase(db, disabled), null);
    assert.throws(
      () =>
        accept(db, users[1].id, museum.id, {
          requestId: request.id,
          action: "accept",
          confirm: true,
        }),
      /TRANSFER_NOT_PENDING/,
    );
  } finally {
    db.close();
  }
});
