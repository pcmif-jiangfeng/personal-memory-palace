import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import {
  planOwnerMigration,
  applyOwnerMigration,
  legacyOwnedTables,
} from "../src/data/owner-migration.ts";

function fixture(t: TestContext) {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  const user = createUserInDatabase(db, {
    email: "original@example.com",
    displayName: "Original",
    passwordHash: "unchanged-password",
  });
  db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(user.id);
  const museum = createMuseumInDatabase(db, {
    ownerId: user.id,
    name: "Original",
    slug: "original",
  });
  db.prepare(
    "INSERT INTO memories(id,title,story,trashed_at,created_at,updated_at) VALUES ('legacy','Past','Unchanged','trash-time','created','updated')",
  ).run();
  db.prepare(
    "INSERT INTO later_notes(id,memory_id,content,created_at) VALUES ('note','legacy','Later','created')",
  ).run();
  return { db, user, museum };
}

test("explicit original owner adoption preserves IDs, content, trash and credentials and is repeatable", (t) => {
  const { db, user, museum } = fixture(t);
  const beforeUser = db.prepare("SELECT * FROM users").all();
  const plan = planOwnerMigration(db, user.email);
  assert.equal(plan.unassigned.memories, 1);
  assert.equal(
    db.prepare("SELECT museum_id FROM memories WHERE id='legacy'").get()?.museum_id,
    null,
  );
  applyOwnerMigration(db, user.email);
  assert.equal(
    db.prepare("SELECT museum_id FROM memories WHERE id='legacy'").get()?.museum_id,
    museum.id,
  );
  assert.equal(
    db.prepare("SELECT content FROM later_notes WHERE id='note'").get()?.content,
    "Later",
  );
  assert.equal(
    db.prepare("SELECT trashed_at FROM memories WHERE id='legacy'").get()?.trashed_at,
    "trash-time",
  );
  assert.deepEqual(db.prepare("SELECT * FROM users").all(), beforeUser);
  assert.equal(planOwnerMigration(db, user.email).unassigned.memories, 0);
  applyOwnerMigration(db, user.email);
});

test("wrong owner, cross-owner parent bindings and unfinished file operations fail without mutation", (t) => {
  const { db, user } = fixture(t);
  assert.throws(() => planOwnerMigration(db, "unknown@example.com"), /verified original owner/);
  const other = createUserInDatabase(db, {
    email: "other@example.com",
    displayName: "Other",
    passwordHash: "fixture",
  });
  const museum = createMuseumInDatabase(db, { ownerId: other.id, name: "Other", slug: "other" });
  db.prepare("UPDATE memories SET museum_id=? WHERE id='legacy'").run(museum.id);
  assert.throws(() => applyOwnerMigration(db, user.email), /cross-owner/);
  assert.equal(db.prepare("SELECT museum_id FROM later_notes").get()?.museum_id, null);
  db.prepare("UPDATE memories SET museum_id=NULL").run();
  db.prepare(
    "INSERT INTO pending_uploads(id,storage_key,created_at) VALUES ('pending','uploads/owner/optimized/test.webp','created')",
  ).run();
  assert.throws(() => applyOwnerMigration(db, user.email), /unfinished file operations/);
});

test("unaudited ownership tables and conflicting historical attribution block automatic adoption", (t) => {
  const { db, user } = fixture(t);
  const other = createUserInDatabase(db, {
    email: "author@example.com",
    displayName: "Author",
    passwordHash: "fixture",
  });
  db.prepare("UPDATE memories SET created_by_user_id=? WHERE id='legacy'").run(other.id);
  assert.throws(() => applyOwnerMigration(db, user.email), /cross-owner author/);
  assert.equal(
    db.prepare("SELECT museum_id FROM memories WHERE id='legacy'").get()?.museum_id,
    null,
  );
  db.exec("CREATE TABLE future_private_content(id TEXT PRIMARY KEY,museum_id TEXT)");
  assert.throws(() => applyOwnerMigration(db, user.email), /Unaudited/);
});

test("all legacy business rows retain every field except their explicit palace binding", (t) => {
  const { db, user, museum } = fixture(t);
  const key = "uploads/owner/optimized/11111111-1111-4111-8111-111111111111.webp";
  db.prepare(
    "INSERT INTO stages(id,title,created_at,updated_at) VALUES ('stage','Chapter','created','updated')",
  ).run();
  db.prepare("UPDATE memories SET stage_id='stage' WHERE id='legacy'").run();
  db.prepare(
    "INSERT INTO memories(id,title,story,created_at,updated_at) VALUES ('related','Related','Story','created','updated')",
  ).run();
  db.prepare(
    "INSERT INTO uploaded_photos(id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES ('photo','photo.webp','image/webp',?,10,10,'created')",
  ).run(key);
  db.prepare(
    "INSERT INTO memory_images(id,memory_id,storage_key,created_at) VALUES ('image','legacy',?,'created')",
  ).run(key);
  db.prepare("INSERT INTO stage_covers(stage_id,storage_key) VALUES ('stage',?)").run(key);
  db.prepare(
    "INSERT INTO memory_relations(memory_id,related_memory_id,created_at) VALUES ('legacy','related','created')",
  ).run();
  db.prepare(
    "INSERT INTO share_configs(id,memory_id,enabled,created_at,updated_at) VALUES ('share-token','legacy',1,'created','updated')",
  ).run();
  const snapshot = () =>
    legacyOwnedTables.map((table) =>
      db
        .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
        .all()
        .map((row) => {
          const copy = { ...row };
          delete copy.museum_id;
          return copy;
        }),
    );
  const before = snapshot();
  applyOwnerMigration(db, user.email);
  assert.deepEqual(snapshot(), before);
  for (const table of legacyOwnedTables)
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE museum_id IS NOT ?`).get(museum.id)?.n,
      0,
    );
});
