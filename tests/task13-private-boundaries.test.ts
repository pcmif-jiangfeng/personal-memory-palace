import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { canReadMuseumPhoto, museumPhotoStorageKey } from "../src/data/photo-access.ts";
import {
  configureShareInDatabase,
  disableShareInDatabase,
  getSharedMemoryInDatabase,
  isSharedImageAccessibleInDatabase,
} from "../src/data/share-repository.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { createEmailInviteInDatabase } from "../src/data/email-invites.ts";
import { acceptEmailInviteInDatabase } from "../src/data/email-invite-acceptance.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["alice", "bob"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "fixture-hash",
    }),
  );
  db.prepare("UPDATE users SET email_verified=1").run();
  const museums = users.map((user, index) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      name: `Private museum ${index}`,
      slug: `task13-private-${index}`,
    }),
  );
  // Migration, not a modern active grant, is what makes the historical relationship inert.
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,role,status,created_at,updated_at) VALUES (?,?,'collaborator','active','now','now')",
  ).run(museums[1].id, users[0].id);
  db.prepare("DELETE FROM schema_migrations WHERE version=29").run();
  runDatabaseMigrations(db);
  assert.equal(db.prepare("SELECT status FROM museum_memberships").get()?.status, "revoked");
  const keys = [
    museumPhotoStorageKey(museums[0].id),
    museumPhotoStorageKey(museums[1].id),
    museumPhotoStorageKey(museums[1].id),
  ];
  const insertPhoto = db.prepare(
    "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at,library_archived_at) VALUES (?,?,'Private photo','image/webp',?,1,1,'now','now')",
  );
  const insertMemory = db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,is_public,created_at,updated_at) VALUES (?,?,'Memory','Story',1,'now','now')",
  );
  const insertImage = db.prepare(
    "INSERT INTO memory_images (id,memory_id,museum_id,storage_key,created_at) VALUES (?,?,?,?,'now')",
  );
  keys.forEach((key, index) => {
    const museumId = museums[index === 0 ? 0 : 1].id;
    insertPhoto.run(`photo-${index}`, museumId, key);
    insertMemory.run(`memory-${index}`, museumId);
    insertImage.run(`image-${index}`, `memory-${index}`, museumId, key);
  });
  const token = configureShareInDatabase(db, "memory-1", "link");
  return { db, users, museums, keys, token };
}

test("ordinary private media rejects historical collaboration after its one-time migration", () => {
  const { db, users, keys } = fixture();
  try {
    assert.equal(canReadMuseumPhoto(db, users[0].id, keys[1]), false);
    assert.equal(canReadMuseumPhoto(db, users[1].id, keys[0]), false);
  } finally {
    db.close();
  }
});

test("only newly accepted active verified members can read the joined palace's media", () => {
  const { db, users, museums, keys } = fixture();
  try {
    const { invite } = createEmailInviteInDatabase(db, users[1].id, museums[1].id, users[0].email);
    assert.equal(canReadMuseumPhoto(db, users[0].id, keys[1]), false);
    acceptEmailInviteInDatabase(db, users[0].id, invite.id);
    assert.equal(canReadMuseumPhoto(db, users[0].id, keys[1]), true);
    assert.equal(canReadMuseumPhoto(db, users[1].id, keys[0]), false);
    db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(users[0].id);
    assert.equal(canReadMuseumPhoto(db, users[0].id, keys[1]), false);
    db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(users[0].id);
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museums[1].id);
    assert.equal(canReadMuseumPhoto(db, users[0].id, keys[1]), false);
    assert.equal(canReadMuseumPhoto(db, users[1].id, keys[1]), false);
    db.prepare("UPDATE museums SET status='active' WHERE id=?").run(museums[1].id);
    db.prepare("UPDATE museum_memberships SET status='revoked'").run();
    assert.equal(canReadMuseumPhoto(db, users[0].id, keys[1]), false);
    assert.equal(canReadMuseumPhoto(db, users[1].id, keys[1]), true);
  } finally {
    db.close();
  }
});

test("Task13B verified owners retain access to their own private photos", () => {
  const { db, users, keys } = fixture();
  try {
    assert.equal(canReadMuseumPhoto(db, users[0].id, keys[0]), true);
    assert.equal(canReadMuseumPhoto(db, users[1].id, keys[1]), true);
  } finally {
    db.close();
  }
});

test("Task13B anonymous and unverified users cannot read ordinary media even for a shared Memory", () => {
  const { db, users, keys } = fixture();
  try {
    assert.equal(canReadMuseumPhoto(db, null, keys[1]), false);
    db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(users[1].id);
    assert.equal(canReadMuseumPhoto(db, users[1].id, keys[1]), false);
  } finally {
    db.close();
  }
});

test("Task13B share token authorizes only its own Memory images, not other Memories or Museums", () => {
  const { db, keys, token } = fixture();
  try {
    assert.equal(isSharedImageAccessibleInDatabase(db, token, keys[1]), true);
    assert.equal(isSharedImageAccessibleInDatabase(db, token, keys[2]), false);
    assert.equal(isSharedImageAccessibleInDatabase(db, token, keys[0]), false);
    assert.equal(isSharedImageAccessibleInDatabase(db, "unknown-token", keys[1]), false);
  } finally {
    db.close();
  }
});

test("Task13B disabling a share immediately revokes the previously authorized image", () => {
  const { db, keys, token } = fixture();
  try {
    assert.equal(isSharedImageAccessibleInDatabase(db, token, keys[1]), true);
    disableShareInDatabase(db, "memory-1");
    assert.equal(isSharedImageAccessibleInDatabase(db, token, keys[1]), false);
  } finally {
    db.close();
  }
});

test("Task13B malformed cross-Museum image bindings cannot expand share authorization", () => {
  const { db, museums, keys, token } = fixture();
  try {
    db.prepare(
      "INSERT INTO memory_images (id,memory_id,museum_id,storage_key,created_at) VALUES ('malformed','memory-1',?,?,'now')",
    ).run(museums[1].id, keys[0]);
    assert.equal(isSharedImageAccessibleInDatabase(db, token, keys[0]), false);
    assert.equal(isSharedImageAccessibleInDatabase(db, token, keys[1]), true);
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museums[1].id);
    assert.equal(isSharedImageAccessibleInDatabase(db, token, keys[1]), false);
  } finally {
    db.close();
  }
});

test("Task13B deliberate sharing authorizes a non-public Memory without changing its private flag", () => {
  const { db, keys } = fixture();
  try {
    db.prepare("UPDATE memories SET is_public=0 WHERE id='memory-2'").run();
    const token = configureShareInDatabase(db, "memory-2", "link");
    assert.equal(getSharedMemoryInDatabase(db, token)?.id, "memory-2");
    assert.equal(isSharedImageAccessibleInDatabase(db, token, keys[2]), true);
    assert.equal(
      db.prepare("SELECT is_public FROM memories WHERE id='memory-2'").get()?.is_public,
      0,
    );
  } finally {
    db.close();
  }
});

test("Task13B share projection never exposes a related Memory outside the token's authorization", () => {
  const { db, museums, token } = fixture();
  try {
    db.prepare(
      "INSERT INTO memory_relations (memory_id,related_memory_id,museum_id,created_at) VALUES ('memory-1','memory-2',?,'now')",
    ).run(museums[1].id);
    const shared = getSharedMemoryInDatabase(db, token);
    assert.ok(shared);
    assert.deepEqual(shared.relatedMemories, []);
  } finally {
    db.close();
  }
});
