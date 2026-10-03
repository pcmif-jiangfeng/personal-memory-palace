import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import {
  createOwnerTransferRequestInDatabase as create,
  resolveOwnerTransferRequestInDatabase as resolve,
  readOwnerTransferRequestInDatabase as read,
} from "../src/data/owner-transfer-requests.ts";
import { removeMuseumCollaboratorInDatabase } from "../src/data/museum-collaborators.ts";
import { leaveMuseumInDatabase } from "../src/data/museum-leave.ts";
import { withTransaction } from "../src/data/transaction.ts";
import { reservePhotoStorageInDatabase } from "../src/data/photo-storage-quota.ts";
import { museumPhotoStorageKey } from "../src/storage/photo-storage-key.ts";
import { requireMuseumAccessInDatabase } from "../src/data/museum-access.ts";

function fixture(databasePath = ":memory:") {
  const db = initializeDatabase(databasePath, false);
  const users = ["owner", "target", "peer"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "hash",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const shared = createMuseumInDatabase(db, {
    ownerId: users[0].id,
    museumType: "shared",
    slug: "shared",
    name: "Shared",
    storageQuotaBytes: 100,
  });
  const privateMuseum = createMuseumInDatabase(db, {
    ownerId: users[1].id,
    slug: "private",
    name: "Private",
    storageQuotaBytes: 100,
  });
  for (const user of users.slice(1))
    db.prepare(
      "INSERT INTO museum_memberships(museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
    ).run(shared.id, user.id);
  const request = () =>
    create(db, users[0].id, shared.id, { confirm: true, targetUserId: users[1].id, version: 1 });
  const owner = () =>
    db.prepare("SELECT owner_id FROM museums WHERE id=?").get(shared.id)!.owner_id;
  return { db, users, shared, privateMuseum, request, owner };
}

test("shared request waits for explicit recipient acceptance; content, creator and private palace remain unchanged", () => {
  const f = fixture();
  try {
    f.db
      .prepare(
        "INSERT INTO memories(id,museum_id,title,story,created_at,updated_at,created_by_user_id) VALUES ('memory',?,'Original','Story','now','now',?)",
      )
      .run(f.shared.id, f.users[0].id);
    const content = f.db.prepare("SELECT * FROM memories").all();
    const originalPrivate = f.db
      .prepare("SELECT * FROM museums WHERE id=?")
      .get(f.privateMuseum.id);
    const request = f.request();
    assert.equal(f.owner(), f.users[0].id);
    assert.equal(
      Date.parse(request.expiresAt) - Date.parse(request.createdAt),
      7 * 24 * 60 * 60 * 1000,
    );
    assert.equal(read(f.db, f.users[2].id, f.shared.id), null);
    assert.equal(read(f.db, f.users[1].id, f.shared.id)!.id, request.id);
    assert.throws(
      () =>
        resolve(f.db, f.users[0].id, f.shared.id, {
          requestId: request.id,
          action: "accept",
          confirm: true,
        }),
      /TRANSFER_NOT_FOUND/,
    );
    resolve(f.db, f.users[1].id, f.shared.id, {
      requestId: request.id,
      action: "accept",
      confirm: true,
    });
    assert.equal(f.owner(), f.users[1].id);
    assert.equal(
      requireMuseumAccessInDatabase(f.db, f.users[0].id, f.shared.id).role,
      "collaborator",
    );
    assert.deepEqual(f.db.prepare("SELECT * FROM memories").all(), content);
    assert.deepEqual(
      f.db.prepare("SELECT * FROM museums WHERE id=?").get(f.privateMuseum.id),
      originalPrivate,
    );
    assert.equal(
      f.db
        .prepare("SELECT actor_user_id FROM audit_logs WHERE action='museum.ownerTransfer'")
        .get()!.actor_user_id,
      f.users[1].id,
    );
    assert.throws(() =>
      resolve(f.db, f.users[1].id, f.shared.id, {
        requestId: request.id,
        action: "accept",
        confirm: true,
      }),
    );
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    f.db.close();
  }
});

test("one pending request, explicit cancel/reject and exact expiration never change ownership", () => {
  const f = fixture();
  try {
    let request = f.request();
    assert.throws(f.request, /TRANSFER_ALREADY_PENDING/);
    assert.throws(
      () =>
        resolve(f.db, f.users[2].id, f.shared.id, {
          requestId: request.id,
          action: "reject",
          confirm: true,
        }),
      /TRANSFER_NOT_FOUND/,
    );
    resolve(f.db, f.users[0].id, f.shared.id, {
      requestId: request.id,
      action: "cancel",
      confirm: true,
    });
    assert.throws(
      () =>
        resolve(f.db, f.users[1].id, f.shared.id, {
          requestId: request.id,
          action: "accept",
          confirm: true,
        }),
      /TRANSFER_NOT_PENDING/,
    );
    request = f.request();
    resolve(f.db, f.users[1].id, f.shared.id, {
      requestId: request.id,
      action: "reject",
      confirm: true,
    });
    request = f.request();
    f.db
      .prepare("UPDATE owner_transfer_requests SET expires_at=? WHERE id=?")
      .run(new Date().toISOString(), request.id);
    assert.throws(
      () =>
        resolve(f.db, f.users[1].id, f.shared.id, {
          requestId: request.id,
          action: "accept",
          confirm: true,
        }),
      /TRANSFER_EXPIRED/,
    );
    assert.notEqual(f.request().id, request.id);
    assert.equal(f.owner(), f.users[0].id);
  } finally {
    f.db.close();
  }
});

for (const action of ["leave", "remove"] as const)
  test(`${action} permanently invalidates pending acceptance even after membership is restored`, () => {
    const f = fixture();
    try {
      const request = f.request();
      if (action === "leave") leaveMuseumInDatabase(f.db, f.users[1].id, f.shared.id);
      else removeMuseumCollaboratorInDatabase(f.db, f.users[0].id, f.shared.id, f.users[1].id);
      assert.equal(
        f.db.prepare("SELECT status FROM owner_transfer_requests WHERE id=?").get(request.id)!
          .status,
        "invalidated",
      );
      f.db.prepare("UPDATE museum_memberships SET status='active'").run();
      assert.throws(
        () =>
          resolve(f.db, f.users[1].id, f.shared.id, {
            requestId: request.id,
            action: "accept",
            confirm: true,
          }),
        /TRANSFER_NOT_PENDING/,
      );
      assert.equal(f.owner(), f.users[0].id);
    } finally {
      f.db.close();
    }
  });

test("acceptance rechecks recipient quota including both accounts' pending upload reservations", () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE museums SET storage_used_bytes=60 WHERE id=?").run(f.shared.id);
    f.db.prepare("UPDATE museums SET storage_used_bytes=30 WHERE id=?").run(f.privateMuseum.id);
    const request = f.request();
    withTransaction(f.db, () =>
      reservePhotoStorageInDatabase(f.db, f.shared.id, museumPhotoStorageKey(f.shared.id), 11),
    );
    assert.throws(
      () =>
        resolve(f.db, f.users[1].id, f.shared.id, {
          requestId: request.id,
          action: "accept",
          confirm: true,
        }),
      /STORAGE_QUOTA_EXCEEDED/,
    );
    assert.equal(f.owner(), f.users[0].id);
    f.db.prepare("UPDATE photo_asset_usage SET bytes=10").run();
    resolve(f.db, f.users[1].id, f.shared.id, {
      requestId: request.id,
      action: "accept",
      confirm: true,
    });
    assert.equal(f.owner(), f.users[1].id);
    assert.throws(
      () =>
        withTransaction(f.db, () =>
          reservePhotoStorageInDatabase(
            f.db,
            f.privateMuseum.id,
            museumPhotoStorageKey(f.privateMuseum.id),
            1,
          ),
        ),
      /STORAGE_QUOTA_EXCEEDED/,
    );
  } finally {
    f.db.close();
  }
});

test("private, frozen, unverified and foreign actors cannot create or accept requests", () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        create(f.db, f.users[1].id, f.privateMuseum.id, {
          confirm: true,
          targetUserId: f.users[0].id,
          version: 1,
        }),
      /PRIVATE_PALACE_TRANSFER_DISABLED/,
    );
    for (const actor of [null, "missing", f.users[1].id, f.users[2].id])
      assert.throws(() =>
        create(f.db, actor, f.shared.id, {
          confirm: true,
          targetUserId: f.users[1].id,
          version: 1,
        }),
      );
    const request = f.request();
    f.db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(f.users[1].id);
    assert.throws(
      () =>
        resolve(f.db, f.users[1].id, f.shared.id, {
          requestId: request.id,
          action: "accept",
          confirm: true,
        }),
      /EMAIL_VERIFICATION_REQUIRED/,
    );
    f.db.exec("UPDATE users SET email_verified=1; UPDATE museums SET status='pending_deletion'");
    assert.throws(
      () =>
        resolve(f.db, f.users[1].id, f.shared.id, {
          requestId: request.id,
          action: "accept",
          confirm: true,
        }),
      /MUSEUM_NOT_FOUND/,
    );
    assert.equal(f.owner(), f.users[0].id);
  } finally {
    f.db.close();
  }
});

test("two connections serialize upload reservations and acceptance without quota overshoot", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "palace-transfer-race-"));
  const f = fixture(path.join(directory, "test.sqlite"));
  const second = new DatabaseSync(path.join(directory, "test.sqlite"));
  try {
    f.db.prepare("UPDATE museums SET storage_used_bytes=90 WHERE id=?").run(f.shared.id);
    const request = f.request();
    second.exec("BEGIN IMMEDIATE");
    reservePhotoStorageInDatabase(
      second,
      f.privateMuseum.id,
      museumPhotoStorageKey(f.privateMuseum.id),
      11,
    );
    assert.throws(
      () =>
        resolve(f.db, f.users[1].id, f.shared.id, {
          requestId: request.id,
          action: "accept",
          confirm: true,
        }),
      /locked/,
    );
    assert.equal(f.owner(), f.users[0].id);
    second.exec("COMMIT");
    assert.throws(
      () =>
        resolve(f.db, f.users[1].id, f.shared.id, {
          requestId: request.id,
          action: "accept",
          confirm: true,
        }),
      /STORAGE_QUOTA_EXCEEDED/,
    );
    assert.equal(f.owner(), f.users[0].id);
  } finally {
    if (second.isTransaction) second.exec("ROLLBACK");
    second.close();
    f.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("acceptance failure at ownership, membership, audit or resolution rolls back the complete transition", () => {
  const f = fixture();
  try {
    const request = f.request();
    const tables = [
      "museums",
      "museum_memberships",
      "owner_transfer_requests",
      "audit_logs",
      "museum_notifications",
    ];
    const snapshot = () =>
      tables.map((table) => f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = snapshot();
    for (const trigger of [
      "BEFORE UPDATE ON museums",
      "BEFORE DELETE ON museum_memberships",
      "BEFORE INSERT ON museum_memberships",
      "BEFORE INSERT ON audit_logs",
      "BEFORE UPDATE ON owner_transfer_requests",
    ]) {
      f.db.exec(`CREATE TRIGGER fail_accept ${trigger} BEGIN SELECT RAISE(ABORT,'failure'); END`);
      assert.throws(
        () =>
          resolve(f.db, f.users[1].id, f.shared.id, {
            requestId: request.id,
            action: "accept",
            confirm: true,
          }),
        /failure/,
      );
      assert.deepEqual(snapshot(), before);
      f.db.exec("DROP TRIGGER fail_accept");
    }
  } finally {
    f.db.close();
  }
});
