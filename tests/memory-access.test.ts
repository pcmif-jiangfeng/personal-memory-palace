import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { requireMemoryAccessInDatabase } from "../src/data/memory-access.ts";
import { ApiError } from "../src/http/errors.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "collaborator", "other"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "hash",
    }),
  );
  db.prepare("UPDATE users SET email_verified=1").run();
  const museums = [users[0], users[2]].map((user, index) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      name: `Museum ${index}`,
      slug: `museum-${index}`,
    }),
  );
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museums[0].id, users[1].id);
  const insert = db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES (?,?,'Title','Story','now','now')",
  );
  insert.run("own-memory", museums[0].id);
  insert.run("other-memory", museums[1].id);
  return { db, users, museums };
}

function denied(operation: () => unknown, code: string, status: number) {
  assert.throws(
    operation,
    (error) => error instanceof ApiError && error.code === code && error.status === status,
  );
}

test("collaborators may read, edit, trash and restore, but permanent deletion requires Owner", () => {
  const { db, users, museums } = fixture();
  try {
    for (const action of ["read", "update", "trash", "restore"] as const) {
      if (action === "restore")
        db.prepare("UPDATE memories SET trashed_at='now' WHERE id='own-memory'").run();
      assert.equal(
        requireMemoryAccessInDatabase(db, users[1].id, museums[0].id, "own-memory", action).role,
        "collaborator",
      );
    }
    denied(
      () =>
        requireMemoryAccessInDatabase(db, users[1].id, museums[0].id, "own-memory", "permanent"),
      "MUSEUM_OWNER_REQUIRED",
      403,
    );
    assert.equal(
      requireMemoryAccessInDatabase(db, users[0].id, museums[0].id, "own-memory", "permanent").role,
      "owner",
    );
  } finally {
    db.close();
  }
});

test("foreign, unknown and unscoped Memory IDs are rejected for every operation", () => {
  const { db, users, museums } = fixture();
  try {
    db.prepare(
      "INSERT INTO memories (id,title,story,created_at,updated_at) VALUES ('unscoped','Title','Story','now','now')",
    ).run();
    for (const action of ["read", "update", "trash", "restore", "permanent"] as const)
      for (const id of ["other-memory", "unknown", "unscoped", "' OR 1=1 --"])
        denied(
          () => requireMemoryAccessInDatabase(db, users[0].id, museums[0].id, id, action),
          "MEMORY_NOT_FOUND",
          404,
        );
    denied(
      () =>
        requireMemoryAccessInDatabase(db, users[1].id, museums[0].id, "other-memory", "permanent"),
      "MEMORY_NOT_FOUND",
      404,
    );
  } finally {
    db.close();
  }
});

test("trash state restricts operations; revoked membership and pending Museum immediately deny access", () => {
  const { db, users, museums } = fixture();
  try {
    for (const action of ["restore", "permanent"] as const)
      denied(
        () => requireMemoryAccessInDatabase(db, users[0].id, museums[0].id, "own-memory", action),
        "MEMORY_NOT_FOUND",
        404,
      );
    db.prepare("UPDATE memories SET trashed_at='now' WHERE id='own-memory'").run();
    for (const action of ["read", "update", "trash"] as const)
      denied(
        () => requireMemoryAccessInDatabase(db, users[0].id, museums[0].id, "own-memory", action),
        "MEMORY_NOT_FOUND",
        404,
      );
    db.prepare("UPDATE museum_memberships SET status='revoked'").run();
    denied(
      () => requireMemoryAccessInDatabase(db, users[1].id, museums[0].id, "own-memory", "restore"),
      "MUSEUM_NOT_FOUND",
      404,
    );
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museums[0].id);
    denied(
      () => requireMemoryAccessInDatabase(db, users[0].id, museums[0].id, "own-memory", "restore"),
      "MUSEUM_NOT_FOUND",
      404,
    );
  } finally {
    db.close();
  }
});
