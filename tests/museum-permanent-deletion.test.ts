import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { museumPhotoStorageKey } from "../src/storage/photo-storage-key.ts";
import { cancelMuseumDeletionInDatabase } from "../src/data/museum-deletion.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import {
  planMuseumPermanentDeletion,
  stageMuseumPermanentDeletion,
  finishMuseumPermanentDeletion,
  museumOwnedDeletionTables,
} from "../src/data/museum-permanent-deletion.ts";

const now = new Date("2026-10-01T00:00:00.000Z");
const backup = { directory: "/verified-backup", fingerprint: "a".repeat(64) };
test("staged deletion keeps stored and reserved account charges until physical cleanup completes", (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE museums SET storage_used_bytes=23 WHERE id=?").run(f.id);
  f.db
    .prepare(
      "INSERT INTO photo_asset_usage(storage_key,museum_id,bytes,state) VALUES (?,?,7,'reserved')",
    )
    .run(museumPhotoStorageKey(f.id), f.id);
  stageMuseumPermanentDeletion(f.db, f.id, backup, now);
  assert.equal(
    f.db.prepare("SELECT storage_used_bytes FROM museums WHERE id=?").get(f.id)!.storage_used_bytes,
    30,
  );
  stageMuseumPermanentDeletion(f.db, f.id, backup, now);
  assert.equal(
    f.db.prepare("SELECT storage_used_bytes FROM museums WHERE id=?").get(f.id)!.storage_used_bytes,
    30,
  );
  finishMuseumPermanentDeletion(f.db, f.id, now);
  assert.equal(f.db.prepare("SELECT 1 FROM museums WHERE id=?").get(f.id), undefined);
});
test("private palace permanent deletion is refused even when a historical pending deadline has elapsed", (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE museums SET museum_type='private' WHERE id=?").run(f.id);
  const before = f.db.prepare("SELECT * FROM museums WHERE id=?").get(f.id);
  assert.throws(
    () => planMuseumPermanentDeletion(f.db, f.id, now),
    /Private palace deletion is disabled/,
  );
  assert.throws(
    () => stageMuseumPermanentDeletion(f.db, f.id, backup, now),
    /Private palace deletion is disabled/,
  );
  assert.deepEqual(f.db.prepare("SELECT * FROM museums WHERE id=?").get(f.id), before);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM memories WHERE museum_id=?").get(f.id)!.n, 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM museum_permanent_deletion_jobs").get()!.n, 0);
});
function fixture(t: TestContext) {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  const user = createUserInDatabase(db, {
    email: "owner@example.com",
    displayName: "Owner",
    passwordHash: "fixture-hash",
  });
  db.exec("UPDATE users SET email_verified=1");
  const otherUser = createUserInDatabase(db, {
    email: "other@example.com",
    displayName: "Other",
    passwordHash: "fixture-hash",
  });
  const museums = ["due", "other"].map((slug, index) =>
    createMuseumInDatabase(db, { ownerId: index === 0 ? user.id : otherUser.id, name: slug, slug }),
  );
  db.exec("UPDATE museums SET museum_type='shared'");
  db.prepare(
    "UPDATE museums SET status='pending_deletion',deletion_scheduled_at=?,version=2 WHERE id=?",
  ).run(now.toISOString(), museums[0].id);
  for (const [index, museum] of museums.entries()) {
    const key = museumPhotoStorageKey(museum.id);
    db.prepare(
      "INSERT INTO stages (id,museum_id,title,created_at,updated_at) VALUES (?,?,?,'now','now')",
    ).run(`stage-${index}`, museum.id, `stage-${index}`);
    db.prepare(
      "INSERT INTO memories (id,museum_id,stage_id,title,story,created_at,updated_at) VALUES (?,?,?,?,'PRIVATE','now','now')",
    ).run(`memory-${index}`, museum.id, `stage-${index}`, `memory-${index}`);
    db.prepare(
      "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES (?,?,'Photo','image/webp',?,1,1,'now')",
    ).run(`photo-${index}`, museum.id, key);
    db.prepare(
      "INSERT INTO memory_images (id,museum_id,memory_id,storage_key,created_at) VALUES (?,?,?,?,'now')",
    ).run(`image-${index}`, museum.id, `memory-${index}`, key);
    db.prepare("INSERT INTO stage_covers (stage_id,museum_id,storage_key) VALUES (?,?,?)").run(
      `stage-${index}`,
      museum.id,
      key,
    );
    db.prepare(
      "INSERT INTO later_notes (id,museum_id,memory_id,content,created_at) VALUES (?,?,?,'NOTE','now')",
    ).run(`note-${index}`, museum.id, `memory-${index}`);
    db.prepare(
      "INSERT INTO share_configs (id,museum_id,memory_id,created_at,updated_at) VALUES (?,?,?,'now','now')",
    ).run(`share-${index}`, museum.id, `memory-${index}`);
    db.prepare(
      "INSERT INTO invite_links (id,museum_id,token_hash,created_at) VALUES (?,?,?,'now')",
    ).run(`invite-${index}`, museum.id, String(index).repeat(64));
    db.prepare(
      "INSERT INTO collaboration_invites(id,museum_id,target_email,created_at,expires_at) VALUES (?,?,?,'now','later')",
    ).run(`email-invite-${index}`, museum.id, `target-${index}@example.com`);
    db.prepare(
      "INSERT INTO owner_transfer_requests(id,museum_id,owner_user_id,target_user_id,status,created_at,expires_at) VALUES (?,?,?,?,'invalidated','now','later')",
    ).run(
      `transfer-${index}`,
      museum.id,
      index === 0 ? user.id : otherUser.id,
      index === 0 ? otherUser.id : user.id,
    );
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
    ).run(museum.id, user.id);
    db.prepare(
      "INSERT INTO audit_logs (id,museum_id,action,object_type,object_id,timestamp) VALUES (?,?,'test','memory',?,'now')",
    ).run(`audit-${index}`, museum.id, `memory-${index}`);
    const pendingKey = museumPhotoStorageKey(museum.id);
    const deletedKey = museumPhotoStorageKey(museum.id);
    db.prepare(
      "INSERT INTO pending_uploads (id,museum_id,storage_key,created_at) VALUES (?,?,?,'now')",
    ).run(`pending-${index}`, museum.id, pendingKey);
    db.prepare(
      "INSERT INTO photo_deletion_jobs (photo_id,museum_id,optimized_storage_key,created_at) VALUES (?,?,?,'now')",
    ).run(`deleted-${index}`, museum.id, deletedKey);
    db.prepare(
      "INSERT INTO photo_asset_usage (storage_key,museum_id,bytes,state) VALUES (?,?,1,'stored')",
    ).run(key, museum.id);
    db.prepare(
      "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES (?,?,'related','PRIVATE','now','now')",
    ).run(`related-${index}`, museum.id);
    db.prepare(
      "INSERT INTO memory_relations (memory_id,related_memory_id,museum_id,created_at) VALUES (?,?,?,'now')",
    ).run(`memory-${index}`, `related-${index}`, museum.id);
    db.prepare(
      "INSERT INTO museum_support_access (id,museum_id,memory_id,admin_user_id,owner_user_id,issued_by_user_id,purpose,created_at,expires_at) VALUES (?,?,?,?,?,?,'user_authorization','now','later')",
    ).run(`permit-${index}`, museum.id, `memory-${index}`, user.id, user.id, user.id);
    db.prepare(
      "INSERT INTO museum_notifications (id,event_key,museum_id,recipient_user_id,recipient_email,kind,subject,body,created_at,next_attempt_at) VALUES (?,?,?,?,'owner@example.com','collaboration.joined','Subject','Body','now','now')",
    ).run(`mail-${index}`, `event-${index}`, museum.id, user.id);
  }
  const id = museums[0].id;
  const snapshot = () =>
    db
      .prepare("SELECT * FROM sqlite_schema ORDER BY name")
      .all()
      .filter((row) => row.type === "table")
      .map((row) => [row.name, db.prepare(`SELECT * FROM ${row.name} ORDER BY rowid`).all()]);
  const other = () =>
    museumOwnedDeletionTables.map((table) =>
      db.prepare(`SELECT * FROM ${table} WHERE museum_id=? ORDER BY rowid`).all(museums[1].id),
    );
  return { db, user, museums, id, snapshot, other };
}

test("J6 dry-run is read-only and requires a due pending Museum, including the exact deadline", (t) => {
  const f = fixture(t);
  const before = f.snapshot();
  const plan = planMuseumPermanentDeletion(f.db, f.id, now);
  assert.equal(plan.museumId, f.id);
  assert.equal(plan.counts.memories, 2);
  assert.equal(plan.resuming, false);
  assert.deepEqual(f.snapshot(), before);
  assert.throws(
    () => planMuseumPermanentDeletion(f.db, f.id, new Date(now.getTime() - 1)),
    /not due/,
  );
  assert.throws(() => planMuseumPermanentDeletion(f.db, f.museums[1].id, now), /not due/);
  assert.throws(() => planMuseumPermanentDeletion(f.db, "../../data", now), /Invalid Museum/);
  assert.throws(
    () => planMuseumPermanentDeletion(f.db, f.id, new Date(NaN)),
    /Invalid deletion time/,
  );
});
test("J6 stage atomically removes owned data, retains retry evidence and protects other Museums and Users", (t) => {
  const f = fixture(t);
  const other = f.other();
  const users = f.db.prepare("SELECT * FROM users").all();
  for (const table of museumOwnedDeletionTables)
    assert.notEqual(
      f.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE museum_id=?`).get(f.id)!.n,
      0,
      table,
    );
  stageMuseumPermanentDeletion(f.db, f.id, backup, now);
  for (const table of museumOwnedDeletionTables)
    assert.equal(
      f.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE museum_id=?`).get(f.id)!.n,
      0,
      table,
    );
  assert.deepEqual(f.other(), other);
  assert.deepEqual(f.db.prepare("SELECT * FROM users").all(), users);
  const plan = planMuseumPermanentDeletion(f.db, f.id, now);
  assert.equal(plan.resuming, true);
  assert.equal(plan.backupDirectory, "/verified-backup");
  assert.throws(
    () => cancelMuseumDeletionInDatabase(f.db, f.user.id, f.id, { confirm: true, version: 2 }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "MUSEUM_DELETE_IN_PROGRESS",
  );
  finishMuseumPermanentDeletion(f.db, f.id, now);
  assert.equal(f.db.prepare("SELECT id FROM museums WHERE id=?").get(f.id), undefined);
  assert.equal(f.db.prepare("SELECT * FROM museum_permanent_deletion_jobs").all().length, 0);
  assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("J6 additive migration is repeatable and preserves existing data", (t) => {
  const f = fixture(t);
  const before = f.other();
  f.db.exec(
    "DROP TABLE museum_permanent_deletion_jobs; DELETE FROM schema_migrations WHERE version=26",
  );
  runDatabaseMigrations(f.db);
  runDatabaseMigrations(f.db);
  assert.deepEqual(f.other(), before);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE version=26").get()!.n,
    1,
  );
});

test("J6 database side effects on unrelated data are detected and rolled back inside the stage", (t) => {
  const f = fixture(t);
  f.db.exec(
    "CREATE TRIGGER unexpected_side_effect AFTER DELETE ON memories BEGIN UPDATE users SET display_name='changed'; END",
  );
  const before = f.snapshot();
  assert.throws(
    () => stageMuseumPermanentDeletion(f.db, f.id, backup, now),
    /Unrelated data changed/,
  );
  assert.deepEqual(f.snapshot(), before);
});
test("J6 a failed DB stage rolls back content and journal together", (t) => {
  const f = fixture(t);
  f.db.exec(
    "CREATE TRIGGER fail_delete BEFORE DELETE ON memories BEGIN SELECT RAISE(ABORT,'delete failure'); END",
  );
  const before = f.snapshot();
  assert.throws(() => stageMuseumPermanentDeletion(f.db, f.id, backup, now), /delete failure/);
  assert.deepEqual(f.snapshot(), before);
});
test("J6 refuses cross-Museum references and legacy photo bindings before deleting anything", (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE memories SET stage_id='stage-0' WHERE id='memory-1'").run();
  const before = f.snapshot();
  assert.throws(() => planMuseumPermanentDeletion(f.db, f.id, now), /Cross-Museum/);
  assert.deepEqual(f.snapshot(), before);
  f.db.prepare("UPDATE memories SET stage_id='stage-1' WHERE id='memory-1'").run();
  const key = String(
    f.db.prepare("SELECT optimized_storage_key FROM uploaded_photos WHERE id='photo-0'").get()!
      .optimized_storage_key,
  );
  f.db
    .prepare("UPDATE uploaded_photos SET optimized_storage_key=? WHERE id='photo-0'")
    .run(key.replace(`museums/${f.id}`, "owner"));
  assert.throws(() => planMuseumPermanentDeletion(f.db, f.id, now), /Migrate|Invalid photo/);
});

for (const binding of [
  "image",
  "cover",
  "relation",
  "note",
  "share",
  "museumCover",
  "foreignPhoto",
  "foreignPending",
  "unknownTable",
] as const) {
  test(`J6 rejects inconsistent ${binding} ownership before any database deletion`, (t) => {
    const f = fixture(t);
    const key = String(
      f.db.prepare("SELECT optimized_storage_key FROM uploaded_photos WHERE id='photo-0'").get()!
        .optimized_storage_key,
    );
    if (binding === "image")
      f.db.prepare("UPDATE memory_images SET memory_id='memory-1' WHERE id='image-0'").run();
    if (binding === "cover")
      f.db.prepare("UPDATE stage_covers SET storage_key=? WHERE stage_id='stage-1'").run(key);
    if (binding === "relation")
      f.db
        .prepare(
          "UPDATE memory_relations SET related_memory_id='memory-1' WHERE memory_id='memory-0'",
        )
        .run();
    if (binding === "note")
      f.db.prepare("UPDATE later_notes SET memory_id='memory-1' WHERE id='note-0'").run();
    if (binding === "share")
      f.db.prepare("UPDATE share_configs SET museum_id=? WHERE id='share-0'").run(f.museums[1].id);
    if (binding === "museumCover")
      f.db.prepare("UPDATE museums SET cover_photo_id='photo-0' WHERE id=?").run(f.museums[1].id);
    if (binding === "foreignPhoto")
      f.db
        .prepare("UPDATE uploaded_photos SET original_storage_key=? WHERE id='photo-1'")
        .run(key.replace("/optimized/", "/original/").replace(/\.webp$/, ".jpg"));
    if (binding === "foreignPending")
      f.db
        .prepare("UPDATE pending_uploads SET storage_key=? WHERE id='pending-1'")
        .run(museumPhotoStorageKey(f.id));
    if (binding === "unknownTable") f.db.exec("CREATE TABLE future_owned (museum_id TEXT)");
    const before = f.snapshot();
    assert.throws(
      () => stageMuseumPermanentDeletion(f.db, f.id, backup, now),
      /Cross-Museum|Unknown Museum-owned/,
    );
    assert.deepEqual(f.snapshot(), before);
  });
}
