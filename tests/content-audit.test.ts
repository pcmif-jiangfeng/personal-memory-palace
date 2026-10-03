import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { createMemoryInDatabase } from "../src/data/memory-write-repository.ts";
import { manageScopedMemory, type MemoryAction } from "../src/data/scoped-memory.ts";
import { createScopedStage, manageScopedStage } from "../src/data/scoped-stage.ts";
import { addMemoryPhotosInDatabase } from "../src/data/memory-exhibit-repository.ts";
import { archiveScopedPhoto, museumPhotoStorageKey } from "../src/data/photo-access.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "member", "outsider"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      passwordHash: "never-log-this-hash",
      displayName: name,
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const museum = createMuseumInDatabase(db, {
    ownerId: users[0].id,
    name: "Museum",
    slug: "audit",
  });
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museum.id, users[1].id);
  db.prepare(
    "INSERT INTO stages (id,museum_id,title,created_at,updated_at) VALUES ('stage',?,'Stage','now','now')",
  ).run(museum.id);
  const photo = db.prepare(`INSERT INTO uploaded_photos
    (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at)
    VALUES (?,?,'Photo','image/webp',?,1,1,'now')`);
  for (const id of ["p1", "p2", "p3"]) photo.run(id, museum.id, museumPhotoStorageKey(museum.id));
  const memory = db.prepare(`INSERT INTO memories
    (id,museum_id,title,story,created_at,updated_at) VALUES (?,?,'Title','private story never copied','now','now')`);
  for (const id of ["memory", "related"]) memory.run(id, museum.id);
  addMemoryPhotosInDatabase(db, "memory", ["p1", "p2"]);
  db.prepare("UPDATE memory_images SET museum_id=?").run(museum.id);
  return {
    db,
    owner: { userId: users[0].id, museumId: museum.id },
    member: { userId: users[1].id, museumId: museum.id },
    outsider: { userId: users[2].id, museumId: museum.id },
  };
}

function snapshot(db: DatabaseSync) {
  return [
    "memories",
    "stages",
    "memory_images",
    "stage_covers",
    "uploaded_photos",
    "photo_deletion_jobs",
    "memory_relations",
    "later_notes",
    "audit_logs",
  ].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}

function failAudit(db: DatabaseSync) {
  db.exec(
    "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failure'); END",
  );
}

const memoryActions: MemoryAction[] = [
  {
    action: "details",
    title: "Edited",
    story: "updated private story",
    stageId: "stage",
    version: 1,
  },
  { action: "note", content: "private note never copied" },
  { action: "relations", relatedMemoryIds: ["related"] },
  { action: "addPhotos", photoIds: ["p3"], version: 1 },
  { action: "removePhoto", photoId: "p1", version: 1 },
  { action: "reorderPhotos", photoIds: ["p2", "p1"], version: 1 },
  { action: "setCover", photoId: "p2", version: 1 },
  {
    action: "exhibitMetadata",
    photoId: "p1",
    title: "Caption",
    description: "private caption",
    version: 1,
  },
  { action: "publication", isPublic: false },
  { action: "trash" },
  { action: "restore" },
  { action: "permanent", confirm: true },
];

for (const action of memoryActions) {
  test(`Memory ${action.action} records a scoped event and rolls all changes back on audit failure`, () => {
    for (const failing of [false, true]) {
      const { db, owner, member } = fixture();
      try {
        if (action.action === "restore" || action.action === "permanent") {
          db.exec("UPDATE memories SET trashed_at='now' WHERE id='memory'");
        }
        const scope =
          action.action === "permanent" || action.action === "publication" ? owner : member;
        const before = snapshot(db);
        if (failing) {
          failAudit(db);
          assert.throws(() => manageScopedMemory(db, scope, "memory", action), /audit failure/);
          assert.deepEqual(snapshot(db), before);
        } else {
          const result = manageScopedMemory(db, scope, "memory", action);
          const logs = db.prepare("SELECT * FROM audit_logs").all();
          assert.equal(logs.length, 1);
          const log = logs[0];
          assert.equal(log.actor_user_id, scope.userId);
          assert.equal(log.museum_id, scope.museumId);
          assert.equal(log.action, `memory.${action.action}`);
          assert.equal(log.object_type, "memory");
          assert.equal(log.object_id, "memory");
          const diff = JSON.parse(String(log.diff));
          if (action.action === "permanent") assert.equal(log.diff, null);
          else
            assert.deepEqual(diff.version, {
              before: 1,
              after: 2,
            });
          if ("photoId" in action) assert.equal(diff.photoId, action.photoId);
          if ("photoIds" in action) assert.deepEqual(diff.photoIds, action.photoIds);
          if ("version" in action) assert.equal(result, 2);
          assert.doesNotMatch(String(log.diff), /private|never-log|password|token|storage_key/);
        }
      } finally {
        db.close();
      }
    }
  });
}

const stageActions: Parameters<typeof manageScopedStage>[3][] = [
  {
    action: "details",
    input: { title: "Edited", description: "private description", coverPhotoId: "p3", version: 1 },
  },
  { action: "publication", isPublic: false },
  { action: "trash" },
  { action: "restore" },
  { action: "permanent" },
];

for (const action of stageActions) {
  test(`Stage ${action.action} records actor and cover context atomically`, () => {
    for (const failing of [false, true]) {
      const { db, owner, member } = fixture();
      try {
        if (action.action === "restore" || action.action === "permanent") {
          db.exec("UPDATE stages SET trashed_at='now' WHERE id='stage'");
        } else {
          db.exec("UPDATE memories SET stage_id='stage' WHERE id='memory'");
        }
        const scope =
          action.action === "permanent" || action.action === "publication" ? owner : member;
        const before = snapshot(db);
        if (failing) {
          failAudit(db);
          assert.throws(() => manageScopedStage(db, scope, "stage", action), /audit failure/);
          assert.deepEqual(snapshot(db), before);
        } else {
          const result = manageScopedStage(db, scope, "stage", action);
          const logs = db.prepare("SELECT * FROM audit_logs").all();
          assert.equal(logs.length, 1);
          const log = logs[0];
          assert.equal(log.actor_user_id, scope.userId);
          assert.equal(log.museum_id, scope.museumId);
          assert.equal(log.action, `stage.${action.action}`);
          assert.equal(log.object_type, "stage");
          assert.equal(log.object_id, "stage");
          const diff = JSON.parse(String(log.diff));
          if (action.action === "permanent") assert.equal(log.diff, null);
          else
            assert.deepEqual(diff.version, {
              before: 1,
              after: 2,
            });
          if (action.action === "details") {
            assert.equal(diff.coverPhotoId, "p3");
            assert.equal(result?.version, 2);
          }
          assert.doesNotMatch(String(log.diff), /private|password|token|storage_key/);
        }
      } finally {
        db.close();
      }
    }
  });
}

test("Memory and Stage creation audit trusted actors without copying private content", () => {
  const { db, member } = fixture();
  try {
    const stage = createScopedStage(db, member, { title: "Created", coverPhotoId: "p3" });
    const memory = createMemoryInDatabase(
      db,
      {
        title: "Created",
        story: "secret creation story",
        photoIds: ["p3"],
        coverPhotoId: "p3",
        stageId: stage.id,
      },
      member,
    );
    const logs = db.prepare("SELECT * FROM audit_logs ORDER BY rowid").all();
    assert.deepEqual(
      logs.map((row) => [row.action, row.object_type, row.object_id]),
      [
        ["stage.create", "stage", stage.id],
        ["memory.create", "memory", memory.id],
      ],
    );
    for (const log of logs) {
      assert.equal(log.actor_user_id, member.userId);
      assert.equal(log.museum_id, member.museumId);
      assert.doesNotMatch(String(log.diff), /secret|password|token/);
    }
    assert.deepEqual(JSON.parse(String(logs[1].diff)), {
      stageId: stage.id,
      photoIds: ["p3"],
      coverPhotoId: "p3",
    });
  } finally {
    db.close();
  }
});

test("creation audit failure rolls back objects, relations and photo use", () => {
  const { db, member } = fixture();
  try {
    const before = snapshot(db);
    failAudit(db);
    assert.throws(
      () => createScopedStage(db, member, { title: "Created", coverPhotoId: "p3" }),
      /audit failure/,
    );
    assert.deepEqual(snapshot(db), before);
    assert.throws(
      () =>
        createMemoryInDatabase(
          db,
          {
            title: "Created",
            story: "Story",
            photoIds: ["p3"],
            coverPhotoId: "p3",
            relatedMemoryIds: ["related"],
          },
          member,
        ),
      /audit failure/,
    );
    assert.deepEqual(snapshot(db), before);
  } finally {
    db.close();
  }
});

test("photo archive records once and cannot succeed without its audit event", () => {
  const { db, member } = fixture();
  try {
    const before = snapshot(db);
    failAudit(db);
    assert.throws(() => archiveScopedPhoto(db, member, "p3"), /audit failure/);
    assert.deepEqual(snapshot(db), before);
    db.exec("DROP TRIGGER fail_audit");
    assert.deepEqual(archiveScopedPhoto(db, member, "p3"), { archived: true });
    archiveScopedPhoto(db, member, "p3");
    const logs = db.prepare("SELECT * FROM audit_logs").all();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, "photo.archive");
    assert.equal(logs[0].object_id, "p3");
    assert.equal(logs[0].actor_user_id, member.userId);
    assert.equal(logs[0].museum_id, member.museumId);
  } finally {
    db.close();
  }
});

test("permission denial, revocation, invalid bindings and version conflicts leave no success event", () => {
  const { db, member, outsider } = fixture();
  try {
    for (const scope of [outsider, { ...member, museumId: "missing" }]) {
      assert.throws(() => manageScopedMemory(db, scope, "memory", memoryActions[0]));
      assert.throws(() => createScopedStage(db, scope, { title: "Denied" }));
      assert.throws(() => archiveScopedPhoto(db, scope, "p3"));
    }
    assert.throws(() =>
      manageScopedMemory(db, member, "memory", { action: "setCover", photoId: "p2", version: 99 }),
    );
    assert.throws(() =>
      manageScopedStage(db, member, "stage", {
        action: "details",
        input: { title: "Conflict", version: 99 },
      }),
    );
    assert.throws(() =>
      manageScopedStage(db, member, "stage", {
        action: "details",
        input: { title: "Invalid", coverPhotoId: "missing", version: 1 },
      }),
    );
    assert.throws(() =>
      manageScopedMemory(db, member, "memory", {
        action: "addPhotos",
        photoIds: ["missing"],
        version: 1,
      }),
    );
    db.exec("UPDATE museum_memberships SET status='revoked'");
    const before = snapshot(db);
    assert.throws(() => manageScopedMemory(db, member, "memory", { action: "trash" }));
    assert.throws(() => manageScopedStage(db, member, "stage", { action: "trash" }));
    assert.throws(() => archiveScopedPhoto(db, member, "p3"));
    assert.deepEqual(snapshot(db), before);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 0);
  } finally {
    db.close();
  }
});
