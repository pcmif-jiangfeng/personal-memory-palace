import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { leaveMuseumInDatabase } from "../src/data/museum-leave.ts";
import { findUserBySessionInDatabase } from "../src/data/user-auth.ts";
import {
  requireMuseumAccessInDatabase,
  requireMuseumOwnerInDatabase,
} from "../src/data/museum-access.ts";
import { ApiError } from "../src/http/errors.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "collaborator", "stranger", "unverified"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "hash",
    }),
  );
  for (const user of users.slice(0, 3))
    db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(user.id);
  const museum = createMuseumInDatabase(db, {
    ownerId: users[0].id,
    name: "人生博物馆",
    slug: "museum",
  });
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museum.id, users[1].id);
  return { db, users, museum };
}
function denied(operation: () => unknown, code: string, status: number) {
  assert.throws(
    operation,
    (error) =>
      error instanceof ApiError &&
      error.code === code &&
      error.status === status &&
      error.details === undefined,
  );
}

test("owner access is authoritative without a membership; collaborator cannot require Owner", () => {
  const { db, users, museum } = fixture();
  try {
    assert.deepEqual(requireMuseumOwnerInDatabase(db, users[0].id, museum.id), {
      museumId: museum.id,
      userId: users[0].id,
      role: "owner",
      status: "active",
    });
    assert.equal(requireMuseumAccessInDatabase(db, users[1].id, museum.id).role, "collaborator");
    denied(
      () => requireMuseumOwnerInDatabase(db, users[1].id, museum.id),
      "MUSEUM_OWNER_REQUIRED",
      403,
    );
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,status,created_at,updated_at) VALUES (?,?,'revoked','now','now')",
    ).run(museum.id, users[0].id);
    assert.equal(requireMuseumOwnerInDatabase(db, users[0].id, museum.id).role, "owner");
  } finally {
    db.close();
  }
});

test("anonymous, unknown and unverified users fail before Museum authorization", () => {
  const { db, users, museum } = fixture();
  try {
    for (const userId of [null, "", "unknown"])
      denied(() => requireMuseumAccessInDatabase(db, userId, museum.id), "USER_REQUIRED", 401);
    denied(
      () => requireMuseumAccessInDatabase(db, users[3].id, museum.id),
      "EMAIL_VERIFICATION_REQUIRED",
      403,
    );
  } finally {
    db.close();
  }
});

test("nonmember, cross-Museum and unknown IDs share a non-disclosing denial", () => {
  const { db, users, museum } = fixture();
  try {
    const other = createMuseumInDatabase(db, {
      ownerId: users[2].id,
      name: "其他馆",
      slug: "other",
    });
    for (const id of [other.id, "unknown", "' OR 1=1 --", ""])
      denied(() => requireMuseumAccessInDatabase(db, users[1].id, id), "MUSEUM_NOT_FOUND", 404);
    denied(
      () => requireMuseumAccessInDatabase(db, users[2].id, museum.id),
      "MUSEUM_NOT_FOUND",
      404,
    );
  } finally {
    db.close();
  }
});

test("leaving invalidates the next authorization without a cached role", () => {
  const { db, users, museum } = fixture();
  try {
    requireMuseumAccessInDatabase(db, users[1].id, museum.id);
    leaveMuseumInDatabase(db, users[1].id, museum.id);
    denied(
      () => requireMuseumAccessInDatabase(db, users[1].id, museum.id),
      "MUSEUM_NOT_FOUND",
      404,
    );
  } finally {
    db.close();
  }
});

test("pending-deletion is hidden from collaborators; unsupported states deny everyone", () => {
  const { db, users, museum } = fixture();
  try {
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museum.id);
    assert.equal(
      requireMuseumOwnerInDatabase(db, users[0].id, museum.id).status,
      "pending_deletion",
    );
    denied(
      () => requireMuseumAccessInDatabase(db, users[1].id, museum.id),
      "MUSEUM_NOT_FOUND",
      404,
    );
    for (const status of ["deleted", "unknown"]) {
      db.prepare("UPDATE museums SET status=? WHERE id=?").run(status, museum.id);
      denied(
        () => requireMuseumAccessInDatabase(db, users[0].id, museum.id),
        "MUSEUM_NOT_FOUND",
        404,
      );
    }
  } finally {
    db.close();
  }
});

test("role changes are read on each call and revoked membership does not retain former ownership", () => {
  const { db, users, museum } = fixture();
  try {
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,status,created_at,updated_at) VALUES (?,?,'revoked','now','now')",
    ).run(museum.id, users[0].id);
    db.prepare("UPDATE museums SET owner_id=? WHERE id=?").run(users[1].id, museum.id);
    assert.equal(requireMuseumOwnerInDatabase(db, users[1].id, museum.id).role, "owner");
    denied(
      () => requireMuseumAccessInDatabase(db, users[0].id, museum.id),
      "MUSEUM_NOT_FOUND",
      404,
    );
  } finally {
    db.close();
  }
});

test("only valid verified User sessions yield an authenticated Museum access identity", () => {
  const { db, users, museum } = fixture();
  try {
    const token = randomBytes(32).toString("base64url");
    db.prepare(
      "INSERT INTO user_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)",
    ).run(
      createHash("sha256").update(token).digest("hex"),
      users[1].id,
      "2099-01-01T00:00:00.000Z",
      "now",
    );
    const authorize = (session: string | undefined) =>
      requireMuseumAccessInDatabase(
        db,
        findUserBySessionInDatabase(db, session)?.id ?? null,
        museum.id,
      );
    assert.equal(authorize(token).role, "collaborator");
    for (const invalid of [undefined, "legacy-owner-token", "x".repeat(43)])
      denied(() => authorize(invalid), "USER_REQUIRED", 401);
    db.prepare("UPDATE user_sessions SET expires_at='2000-01-01T00:00:00.000Z'").run();
    denied(() => authorize(token), "USER_REQUIRED", 401);
    db.prepare("UPDATE user_sessions SET expires_at='2099-01-01T00:00:00.000Z'").run();
    db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(users[1].id);
    denied(() => authorize(token), "USER_REQUIRED", 401);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM museum_memberships").get()?.count, 1);
  } finally {
    db.close();
  }
});
