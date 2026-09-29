import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { addMemoryPhotosInDatabase } from "../src/data/memory-exhibit-repository.ts";
import { manageScopedMemory, type MemoryAction } from "../src/data/scoped-memory.ts";
import { parseMemoryAction } from "../src/http/schemas.ts";
import { ApiError } from "../src/http/errors.ts";

const actions = [
  { action: "addPhotos", photoIds: ["p4"], version: 5 },
  { action: "removePhoto", photoId: "p1", version: 5 },
  { action: "reorderPhotos", photoIds: ["p3", "p2", "p1"], version: 5 },
  { action: "setCover", photoId: "p2", version: 5 },
  { action: "exhibitMetadata", photoId: "p1", title: "A saved", description: "Text", version: 5 },
] as const;

type ExhibitAction = Extract<MemoryAction, { action: (typeof actions)[number]["action"] }>;

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "member"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "hash",
    }),
  );
  db.prepare("UPDATE users SET email_verified=1").run();
  const museum = createMuseumInDatabase(db, {
    ownerId: users[0].id,
    name: "Museum",
    slug: "exhibit-lock",
  });
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museum.id, users[1].id);
  db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES ('memory',?,'Title','Story','now','now')",
  ).run(museum.id);
  const insert = db.prepare(
    "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES (?,?,'Photo','image/webp',?,1,1,'now')",
  );
  for (const id of ["p1", "p2", "p3", "p4"]) insert.run(id, museum.id, `${id}.webp`);
  addMemoryPhotosInDatabase(db, "memory", ["p1", "p2", "p3"]);
  db.prepare("UPDATE memory_images SET museum_id=? WHERE memory_id='memory'").run(museum.id);
  db.prepare("UPDATE memories SET version=5 WHERE id='memory'").run();
  return {
    db,
    owner: { userId: users[0].id, museumId: museum.id },
    member: { userId: users[1].id, museumId: museum.id },
  };
}

for (const action of actions) {
  test(`${action.action}: stale editor cannot overwrite relations, version or attribution`, () => {
    const { db, owner, member } = fixture();
    const input = {
      ...action,
      ...("photoIds" in action ? { photoIds: [...action.photoIds] } : {}),
    } as ExhibitAction;
    const snapshot = () => ({
      memory: db.prepare("SELECT * FROM memories WHERE id='memory'").get(),
      images: db.prepare("SELECT * FROM memory_images ORDER BY id").all(),
      photos: db.prepare("SELECT * FROM uploaded_photos ORDER BY id").all(),
    });
    try {
      assert.equal(manageScopedMemory(db, owner, "memory", input), 6);
      const saved = snapshot();
      assert.equal(saved.memory!.last_edited_by_user_id, owner.userId);
      assert.throws(
        () => manageScopedMemory(db, member, "memory", input),
        (error: unknown) =>
          error instanceof ApiError &&
          error.code === "MEMORY_VERSION_CONFLICT" &&
          error.status === 409,
      );
      assert.deepEqual(snapshot(), saved);
      db.exec(
        "CREATE TRIGGER fail_editor BEFORE UPDATE OF last_edited_by_user_id ON memories BEGIN SELECT RAISE(ABORT,'editor failure'); END",
      );
      const retry = { ...input, version: 6 };
      // An add/remove needs a different valid target after the first successful edit.
      if (retry.action === "addPhotos") retry.photoIds = ["p1"];
      if (retry.action === "removePhoto") retry.photoId = "p2";
      if (input.action === "addPhotos") {
        db.prepare(
          "DELETE FROM memory_images WHERE memory_id='memory' AND storage_key='p1.webp'",
        ).run();
      }
      const beforeFailure = snapshot();
      assert.throws(() => manageScopedMemory(db, member, "memory", retry), /editor failure/);
      assert.deepEqual(snapshot(), beforeFailure);
      db.exec("DROP TRIGGER fail_editor");
      assert.equal(manageScopedMemory(db, member, "memory", retry), 7);
      assert.equal(snapshot().memory!.last_edited_by_user_id, member.userId);
    } finally {
      db.close();
    }
  });
}

test("all Exhibit writes require a positive safe integer version at the request and service boundary", async () => {
  for (const action of actions) {
    for (const version of [undefined, null, 0, -1, 1.5, "5", Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(
        parseMemoryAction(
          new Request("http://localhost/api/memories/memory", {
            method: "POST",
            body: JSON.stringify({ ...action, version }),
          }),
        ),
        (error: unknown) => error instanceof ApiError && error.code === "INVALID_MEMORY_VERSION",
      );
    }
  }
  const { db, owner } = fixture();
  try {
    for (const action of actions) {
      assert.throws(
        () =>
          manageScopedMemory(db, owner, "memory", {
            ...action,
            version: undefined,
          } as unknown as MemoryAction),
        (error: unknown) => error instanceof ApiError && error.code === "INVALID_MEMORY_VERSION",
      );
    }
    assert.equal(db.prepare("SELECT version FROM memories WHERE id='memory'").get()!.version, 5);
  } finally {
    db.close();
  }
});
