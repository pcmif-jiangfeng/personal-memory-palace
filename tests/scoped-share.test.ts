import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { configureScopedShare } from "../src/data/scoped-share.ts";
import { getSharedMemoryInDatabase } from "../src/data/share-repository.ts";
import { manageScopedMemory } from "../src/data/scoped-memory.ts";
import { findMemoryDetailsInDatabase } from "../src/data/memory-repository.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["a", "b", "member"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "hash",
    }),
  );
  db.prepare("UPDATE users SET email_verified=1").run();
  const museums = users
    .slice(0, 2)
    .map((user, index) =>
      createMuseumInDatabase(db, { ownerId: user.id, name: "Museum", slug: `share-${index}` }),
    );
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museums[0].id, users[2].id);
  for (const [index, museum] of museums.entries())
    db.prepare(
      "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES (?,?,'Title','Story','now','now')",
    ).run(index ? "foreign" : "own", museum.id);
  return {
    db,
    owner: { userId: users[0].id, museumId: museums[0].id },
    member: { userId: users[2].id, museumId: museums[0].id },
    foreignMuseum: museums[1].id,
  };
}
const enabled = { enabled: true, mode: "link" as const, password: "", rotate: false };
test("a shared link follows accepted member edits but not stale or departed member edits", () => {
  const { db, owner, member } = fixture();
  try {
    const token = configureScopedShare(db, owner, "own", enabled)!;
    const loaded = findMemoryDetailsInDatabase(db, "own")!;
    const edit = {
      action: "details" as const,
      title: "Member revision",
      story: "Updated live story",
      stageId: null,
      version: loaded.version,
    };
    manageScopedMemory(db, member, "own", edit);
    const shared = getSharedMemoryInDatabase(db, token)!;
    assert.equal(shared.title, edit.title);
    assert.equal(shared.story, edit.story);
    assert.throws(() => manageScopedMemory(db, owner, "own", { ...edit, title: "Stale" }));
    assert.deepEqual(getSharedMemoryInDatabase(db, token), shared);
    db.prepare(
      "UPDATE museum_memberships SET status='revoked' WHERE museum_id=? AND user_id=?",
    ).run(member.museumId, member.userId);
    assert.throws(() =>
      manageScopedMemory(db, member, "own", {
        ...edit,
        version: shared.version,
        title: "Departed",
      }),
    );
    assert.deepEqual(getSharedMemoryInDatabase(db, token), shared);
    configureScopedShare(db, owner, "own", { ...enabled, enabled: false });
    assert.equal(getSharedMemoryInDatabase(db, token), null);
  } finally {
    db.close();
  }
});
test("only Museum Owner may configure or disable an owned share; token rotation and lifecycle remain bounded", () => {
  const { db, owner, member } = fixture();
  try {
    assert.throws(() => configureScopedShare(db, member, "own", enabled));
    assert.throws(() => configureScopedShare(db, owner, "foreign", enabled));
    const token = configureScopedShare(db, owner, "own", enabled)!;
    assert.equal(
      db.prepare("SELECT museum_id FROM share_configs WHERE memory_id='own'").get()!.museum_id,
      owner.museumId,
    );
    assert.ok(getSharedMemoryInDatabase(db, token));
    assert.equal(configureScopedShare(db, owner, "own", enabled), token);
    const rotated = configureScopedShare(db, owner, "own", { ...enabled, rotate: true })!;
    assert.notEqual(rotated, token);
    assert.equal(getSharedMemoryInDatabase(db, token), null);
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(owner.museumId);
    assert.equal(getSharedMemoryInDatabase(db, rotated), null);
    assert.throws(() => configureScopedShare(db, owner, "own", enabled));
    db.prepare("UPDATE museums SET status='active' WHERE id=?").run(owner.museumId);
    configureScopedShare(db, owner, "own", { ...enabled, enabled: false });
    assert.equal(getSharedMemoryInDatabase(db, rotated), null);
  } finally {
    db.close();
  }
});
test("share reads exclude foreign notes and private/foreign related Memories; corrupted share ownership is rejected", () => {
  const { db, owner, foreignMuseum } = fixture();
  try {
    const token = configureScopedShare(db, owner, "own", enabled)!;
    db.prepare(
      "INSERT INTO later_notes (id,memory_id,museum_id,content,created_at) VALUES ('bad-note','own',?,'Secret','now')",
    ).run(foreignMuseum);
    db.prepare(
      "INSERT INTO memory_relations (memory_id,related_memory_id,museum_id,created_at) VALUES ('own','foreign',?,'now')",
    ).run(foreignMuseum);
    db.prepare(
      "INSERT INTO memories (id,museum_id,title,story,is_public,created_at,updated_at) VALUES ('private-related',?,'Private secret','Private story',0,'now','now')",
    ).run(owner.museumId);
    db.prepare(
      "INSERT INTO memory_relations (memory_id,related_memory_id,museum_id,created_at) VALUES ('own','private-related',?,'now')",
    ).run(owner.museumId);
    const memory = getSharedMemoryInDatabase(db, token)!;
    assert.deepEqual(memory.laterNotes, []);
    assert.deepEqual(memory.relatedMemories, []);
    const publicDetails = findMemoryDetailsInDatabase(db, "own", true)!;
    assert.deepEqual(publicDetails.laterNotes, []);
    assert.deepEqual(publicDetails.relatedMemories, []);
    db.prepare("UPDATE share_configs SET museum_id=?").run(foreignMuseum);
    assert.equal(getSharedMemoryInDatabase(db, token), null);
    assert.throws(() => configureScopedShare(db, owner, "own", { ...enabled, enabled: false }));
  } finally {
    db.close();
  }
});

test("password shares require the password, ignore ordinary publication and stop on trash", () => {
  const { db, owner } = fixture();
  try {
    const token = configureScopedShare(db, owner, "own", {
      ...enabled,
      mode: "password",
      password: "correct-password",
    })!;
    assert.equal(getSharedMemoryInDatabase(db, token), null);
    assert.equal(getSharedMemoryInDatabase(db, token, "wrong-password"), null);
    assert.ok(getSharedMemoryInDatabase(db, token, "correct-password"));
    assert.match(
      String(
        db.prepare("SELECT password_hash FROM share_configs WHERE id=?").get(token)!.password_hash,
      ),
      /^scrypt\$/,
    );
    manageScopedMemory(db, owner, "own", { action: "publication", isPublic: false });
    assert.ok(getSharedMemoryInDatabase(db, token, "correct-password"));
    manageScopedMemory(db, owner, "own", { action: "publication", isPublic: true });
    manageScopedMemory(db, owner, "own", { action: "trash" });
    assert.equal(getSharedMemoryInDatabase(db, token, "correct-password"), null);
  } finally {
    db.close();
  }
});
test("Memory permanent deletion queues photos with Museum ownership and refuses conflicting journals", () => {
  const { db, owner, foreignMuseum } = fixture();
  try {
    const key = `uploads/museums/${owner.museumId}/optimized/11111111-1111-4111-8111-111111111111.webp`;
    db.prepare(
      "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES ('photo',?,'Photo','image/webp',?,1,1,'now')",
    ).run(owner.museumId, key);
    manageScopedMemory(db, owner, "own", { action: "addPhotos", version: 1, photoIds: ["photo"] });
    manageScopedMemory(db, owner, "own", { action: "trash" });
    db.prepare(
      "INSERT INTO photo_deletion_jobs (photo_id,museum_id,optimized_storage_key,created_at) VALUES ('photo',?,'foreign-key','now')",
    ).run(foreignMuseum);
    assert.throws(() =>
      manageScopedMemory(db, owner, "own", { action: "permanent", confirm: true }),
    );
    assert.ok(db.prepare("SELECT id FROM memories WHERE id='own'").get());
    assert.ok(db.prepare("SELECT id FROM uploaded_photos WHERE id='photo'").get());
    db.prepare("DELETE FROM photo_deletion_jobs WHERE photo_id='photo'").run();
    db.prepare(
      "INSERT INTO photo_deletion_jobs (photo_id,museum_id,optimized_storage_key,created_at) VALUES ('different-photo',?,?,'now')",
    ).run(owner.museumId, key);
    assert.throws(() =>
      manageScopedMemory(db, owner, "own", { action: "permanent", confirm: true }),
    );
    assert.ok(db.prepare("SELECT id FROM uploaded_photos WHERE id='photo'").get());
    db.prepare("DELETE FROM photo_deletion_jobs WHERE photo_id='different-photo'").run();
    manageScopedMemory(db, owner, "own", { action: "permanent", confirm: true });
    assert.equal(
      db.prepare("SELECT museum_id FROM photo_deletion_jobs WHERE photo_id='photo'").get()!
        .museum_id,
      owner.museumId,
    );
  } finally {
    db.close();
  }
});
