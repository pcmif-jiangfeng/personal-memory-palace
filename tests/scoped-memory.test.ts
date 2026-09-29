import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import {
  manageScopedMemory,
  listScopedMemories,
  readScopedMemory,
} from "../src/data/scoped-memory.ts";
import { withTransaction } from "../src/data/transaction.ts";
import { ApiError } from "../src/http/errors.ts";
import type { MemoryAction } from "../src/data/scoped-memory.ts";

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
  const museums = [users[0], users[2]].map((user, i) =>
    createMuseumInDatabase(db, { ownerId: user.id, name: "Museum", slug: `scope-${i}` }),
  );
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museums[0].id, users[1].id);
  const insert = db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES (?,?,'Title','Story','now','now')",
  );
  insert.run("own", museums[0].id);
  insert.run("other", museums[1].id);
  return {
    db,
    owner: { userId: users[0].id, museumId: museums[0].id },
    member: { userId: users[1].id, museumId: museums[0].id },
  };
}
test("scoped mutations allow collaborator edits, notes, trash and restore; permanent deletion remains Owner-only", () => {
  const { db, owner, member } = fixture();
  try {
    manageScopedMemory(db, member, "own", {
      action: "details",
      version: 1,
      title: "Edited",
      story: "Story",
      stageId: null,
    });
    assert.equal(db.prepare("SELECT title FROM memories WHERE id='own'").get()?.title, "Edited");
    manageScopedMemory(db, member, "own", { action: "note", content: "Later" });
    assert.equal(
      db.prepare("SELECT museum_id FROM later_notes WHERE memory_id='own'").get()?.museum_id,
      member.museumId,
    );
    manageScopedMemory(db, member, "own", { action: "trash" });
    assert.throws(
      () => manageScopedMemory(db, member, "own", { action: "permanent", confirm: true }),
      (e) => e instanceof ApiError && e.status === 403,
    );
    manageScopedMemory(db, member, "own", { action: "restore" });
    manageScopedMemory(db, owner, "own", { action: "trash" });
    manageScopedMemory(db, owner, "own", { action: "permanent", confirm: true });
    assert.equal(db.prepare("SELECT id FROM memories WHERE id='own'").get(), undefined);
  } finally {
    db.close();
  }
});
test("cross-Museum IDs and foreign relations are rejected without changing either Museum", () => {
  const { db, owner, member } = fixture();
  try {
    assert.deepEqual(
      listScopedMemories(db, member).map((m) => m.id),
      ["own"],
    );
    for (const action of [
      { action: "details", version: 1, title: "Attack", story: "Story", stageId: null },
      { action: "trash" },
      { action: "restore" },
      { action: "permanent", confirm: true },
    ] as const)
      assert.throws(
        () => manageScopedMemory(db, owner, "other", action),
        (e) => e instanceof ApiError && e.status === 404,
      );
    assert.throws(() =>
      manageScopedMemory(db, member, "own", { action: "relations", relatedMemoryIds: ["other"] }),
    );
    assert.equal(db.prepare("SELECT title FROM memories WHERE id='other'").get()?.title, "Title");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memory_relations").get()?.n, 0);
    db.prepare("UPDATE museum_memberships SET status='revoked'").run();
    assert.throws(() =>
      manageScopedMemory(db, member, "own", { action: "note", content: "Denied" }),
    );
    assert.throws(() => listScopedMemories(db, member));
  } finally {
    db.close();
  }
});
test("nested repository transactions cannot commit past an outer authorization/write rollback", () => {
  const { db, member } = fixture();
  try {
    assert.throws(() =>
      withTransaction(db, () => {
        manageScopedMemory(db, member, "own", {
          action: "details",
          version: 1,
          title: "Rolled back",
          story: "Story",
          stageId: null,
        });
        throw new Error("rollback");
      }),
    );
    assert.equal(db.prepare("SELECT title FROM memories WHERE id='own'").get()?.title, "Title");
    manageScopedMemory(db, member, "own", { action: "note", content: "Still usable" });
  } finally {
    db.close();
  }
});

test("read, search and trash lists stay inside the selected Museum, including linked details", () => {
  const { db, member } = fixture();
  try {
    assert.equal(readScopedMemory(db, member, "own").id, "own");
    assert.throws(
      () => readScopedMemory(db, member, "other"),
      (e) => e instanceof ApiError && e.status === 404,
    );
    assert.deepEqual(listScopedMemories(db, member, false, "Missing"), []);
    db.prepare(
      "INSERT INTO memory_relations (memory_id,related_memory_id,museum_id,created_at) VALUES ('own','other',?,'now')",
    ).run(member.museumId);
    db.prepare(
      "INSERT INTO later_notes (id,memory_id,museum_id,content,created_at) VALUES ('foreign-note','own',(SELECT museum_id FROM memories WHERE id='other'),'Secret','now')",
    ).run();
    const detail = readScopedMemory(db, member, "own");
    assert.deepEqual(detail.relatedMemories, []);
    assert.deepEqual(detail.laterNotes, []);
    assert.throws(() =>
      manageScopedMemory(db, member, "own", {
        action: "details",
        version: 1,
        title: "No retagging",
        story: "Story",
        stageId: null,
      }),
    );
    assert.equal(
      db.prepare("SELECT content FROM later_notes WHERE id='foreign-note'").get()?.content,
      "Secret",
    );
    db.prepare("DELETE FROM memory_relations").run();
    db.prepare("DELETE FROM later_notes").run();
    manageScopedMemory(db, member, "own", { action: "trash" });
    assert.deepEqual(listScopedMemories(db, member), []);
    assert.deepEqual(
      listScopedMemories(db, member, true).map((memory) => memory.id),
      ["own"],
    );
    assert.throws(() => readScopedMemory(db, member, "own"));
  } finally {
    db.close();
  }
});

test("a foreign photo cannot leak through a cover whose exhibit row is incorrectly tagged as local", () => {
  const { db, member } = fixture();
  try {
    const foreignMuseum = db.prepare("SELECT museum_id FROM memories WHERE id='other'").get()!
      .museum_id;
    db.prepare(
      "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES ('foreign-photo',?,'Secret','image/webp','secret.webp',1,1,'now')",
    ).run(foreignMuseum);
    db.prepare(
      "INSERT INTO memory_images (id,museum_id,memory_id,storage_key,is_cover,created_at) VALUES ('bad-cover',?,'own','secret.webp',1,'now')",
    ).run(member.museumId);
    const detail = readScopedMemory(db, member, "own");
    assert.equal(detail.coverKey, null);
    assert.equal(detail.imageCount, 0);
    assert.deepEqual(detail.images, []);
    assert.equal(listScopedMemories(db, member)[0].coverKey, null);
    assert.throws(() => manageScopedMemory(db, member, "own", { action: "trash" }));
    assert.equal(
      db.prepare("SELECT id FROM uploaded_photos WHERE id='foreign-photo'").get()?.id,
      "foreign-photo",
    );
  } finally {
    db.close();
  }
});

test("Memory exhibits retain order, cover and metadata while rejecting foreign photo IDs", () => {
  const { db, member } = fixture();
  try {
    const insert = db.prepare(
      "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES (?,?,'Photo','image/webp',?,1,1,'now')",
    );
    insert.run("p1", member.museumId, "p1.webp");
    insert.run("p2", member.museumId, "p2.webp");
    insert.run(
      "foreign",
      db.prepare("SELECT museum_id FROM memories WHERE id='other'").get()!.museum_id,
      "foreign.webp",
    );
    manageScopedMemory(db, member, "own", {
      action: "addPhotos",
      version: 1,
      photoIds: ["p1", "p2"],
    });
    manageScopedMemory(db, member, "own", {
      action: "reorderPhotos",
      version: 2,
      photoIds: ["p2", "p1"],
    });
    manageScopedMemory(db, member, "own", { action: "setCover", version: 3, photoId: "p2" });
    manageScopedMemory(db, member, "own", {
      action: "exhibitMetadata",
      version: 4,
      photoId: "p2",
      title: "Exhibit",
      description: "Description",
    });
    const detail = readScopedMemory(db, member, "own");
    assert.deepEqual(
      detail.images.map((image) => image.photoId),
      ["p2", "p1"],
    );
    assert.equal(detail.images[0].isCover, true);
    assert.equal(detail.images[0].exhibitTitle, "Exhibit");
    for (const action of [
      { action: "addPhotos", version: 5, photoIds: ["foreign"] },
      { action: "setCover", version: 5, photoId: "foreign" },
      { action: "removePhoto", version: 5, photoId: "foreign" },
      {
        action: "exhibitMetadata",
        version: 5,
        photoId: "foreign",
        title: "Attack",
        description: "",
      },
      { action: "reorderPhotos", version: 5, photoIds: ["p1", "foreign"] },
    ] satisfies MemoryAction[]) {
      assert.throws(() => manageScopedMemory(db, member, "own", action));
    }
    assert.equal(readScopedMemory(db, member, "own").images.length, 2);
    manageScopedMemory(db, member, "own", { action: "removePhoto", version: 5, photoId: "p2" });
    assert.equal(readScopedMemory(db, member, "own").images[0].isCover, true);
    assert.equal(
      db.prepare("SELECT used_at FROM uploaded_photos WHERE id='foreign'").get()?.used_at,
      null,
    );
  } finally {
    db.close();
  }
});
