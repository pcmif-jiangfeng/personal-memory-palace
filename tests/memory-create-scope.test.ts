import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { createMemoryInDatabase } from "../src/data/memory-write-repository.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "member", "other"].map((name) =>
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
      name: "Museum",
      slug: `create-${index}`,
    }),
  );
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museums[0].id, users[1].id);
  const photo = db.prepare(
    "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES (?,?,'photo','image/webp',?,1,1,'now')",
  );
  photo.run("own-photo", museums[0].id, "own.webp");
  photo.run("other-photo", museums[1].id, "other.webp");
  db.prepare(
    "INSERT INTO stages (id,museum_id,title,description,created_at,updated_at) VALUES ('other-stage',?,'Stage','','now','now')",
  ).run(museums[1].id);
  db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES ('other-memory',?,'Title','Story','now','now')",
  ).run(museums[1].id);
  return { db, users, museums };
}
const input = {
  title: "Title",
  story: "Story",
  photoIds: ["own-photo"],
  coverPhotoId: "own-photo",
};

test("scoped creation permits Collaborator and persists Museum on Memory and exhibits", () => {
  const { db, users, museums } = fixture();
  try {
    const memory = createMemoryInDatabase(db, input, {
      userId: users[1].id,
      museumId: museums[0].id,
    });
    assert.equal(
      db.prepare("SELECT museum_id FROM memories WHERE id=?").get(memory.id)?.museum_id,
      museums[0].id,
    );
    assert.equal(
      db.prepare("SELECT museum_id FROM memory_images WHERE memory_id=?").get(memory.id)?.museum_id,
      museums[0].id,
    );
  } finally {
    db.close();
  }
});

test("scoped creation rejects foreign bindings without partial rows or photo-use updates", () => {
  const { db, users, museums } = fixture();
  try {
    const scope = { userId: users[0].id, museumId: museums[0].id };
    for (const invalid of [
      { ...input, photoIds: ["other-photo"], coverPhotoId: "other-photo" },
      { ...input, stageId: "other-stage" },
      { ...input, relatedMemoryIds: ["other-memory"] },
    ])
      assert.throws(() => createMemoryInDatabase(db, invalid, scope));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memories").get()?.n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memory_images").get()?.n, 0);
    assert.equal(
      db.prepare("SELECT used_at FROM uploaded_photos WHERE id='own-photo'").get()?.used_at,
      null,
    );
  } finally {
    db.close();
  }
});

test("creation rejects nonmembers, revoked members and pending Museums", () => {
  const { db, users, museums } = fixture();
  try {
    assert.throws(() =>
      createMemoryInDatabase(db, input, { userId: users[2].id, museumId: museums[0].id }),
    );
    db.prepare("UPDATE museum_memberships SET status='revoked'").run();
    assert.throws(() =>
      createMemoryInDatabase(db, input, { userId: users[1].id, museumId: museums[0].id }),
    );
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museums[0].id);
    assert.throws(() =>
      createMemoryInDatabase(db, input, { userId: users[0].id, museumId: museums[0].id }),
    );
  } finally {
    db.close();
  }
});
