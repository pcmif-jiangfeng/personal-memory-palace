import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { readScopedMemory, manageScopedMemory } from "../src/data/scoped-memory.ts";
import { readScopedStage, manageScopedStage } from "../src/data/scoped-stage.ts";
import { archiveScopedPhoto, canReadMuseumPhoto } from "../src/data/photo-access.ts";
import { deleteUploadedPhotoInDatabase } from "../src/data/photo-deletion-service.ts";
import { configureScopedShare } from "../src/data/scoped-share.ts";
import { ApiError } from "../src/http/errors.ts";

const domainTables = [
  "memories",
  "stages",
  "uploaded_photos",
  "memory_images",
  "stage_covers",
  "later_notes",
  "memory_relations",
  "share_configs",
  "photo_deletion_jobs",
  "pending_uploads",
];

for (const actor of ["owner", "both-museum-collaborator", "nonmember", "revoked-member"] as const) {
  test(`cross-Museum security matrix rejects ${actor} without mutating either Museum`, async () => {
    const db = initializeDatabase(":memory:", false);
    const users = ["a", "b", "member"].map((name) =>
      createUserInDatabase(db, {
        email: `${name}@example.com`,
        displayName: name,
        passwordHash: "synthetic",
      }),
    );
    db.prepare("UPDATE users SET email_verified=1").run();
    const museums = users
      .slice(0, 2)
      .map((user, index) =>
        createMuseumInDatabase(db, { ownerId: user.id, name: "Museum", slug: `idor-${index}` }),
      );
    for (const museum of museums)
      db.prepare(
        "INSERT INTO museum_memberships (museum_id,user_id,status,created_at,updated_at) VALUES (?,?,?,'now','now')",
      ).run(museum.id, users[2].id, actor === "revoked-member" ? "revoked" : "active");
    const resources = museums.map((museum, index) => {
      const id = String(index);
      const key = `uploads/museums/${museum.id}/optimized/11111111-1111-4111-8111-11111111111${index}.webp`;
      db.prepare(
        "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES (?,?,'Secret title','Secret story','now','now')",
      ).run(`memory-${id}`, museum.id);
      db.prepare(
        "INSERT INTO memories (id,museum_id,title,story,trashed_at,created_at,updated_at) VALUES (?,?,'Trash secret','Secret story','now','now','now')",
      ).run(`trash-memory-${id}`, museum.id);
      db.prepare(
        "INSERT INTO stages (id,museum_id,title,created_at,updated_at) VALUES (?,?,'Secret stage','now','now')",
      ).run(`stage-${id}`, museum.id);
      db.prepare(
        "INSERT INTO stages (id,museum_id,title,trashed_at,created_at,updated_at) VALUES (?,?,'Trash secret','now','now','now')",
      ).run(`trash-stage-${id}`, museum.id);
      db.prepare(
        "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES (?,?,'Secret photo','image/webp',?,1,1,'now')",
      ).run(`photo-${id}`, museum.id, key);
      return {
        memory: `memory-${id}`,
        stage: `stage-${id}`,
        photo: `photo-${id}`,
        trashMemory: `trash-memory-${id}`,
        trashStage: `trash-stage-${id}`,
        key,
      };
    });
    const scope = {
      userId: actor === "owner" ? users[0].id : actor === "nonmember" ? users[1].id : users[2].id,
      museumId: museums[0].id,
    };
    const target =
      actor === "owner" || actor === "both-museum-collaborator" ? resources[1] : resources[0];
    const snapshot = () =>
      JSON.stringify(
        domainTables.map((table) =>
          db
            .prepare(`SELECT * FROM ${table}`)
            .all()
            .map((row) => JSON.stringify(row))
            .sort(),
        ),
      );
    const before = snapshot();
    const denied = (error: unknown) =>
      error instanceof ApiError && (error.status === 403 || error.status === 404);
    try {
      assert.throws(() => readScopedMemory(db, scope, target.memory), denied);
      assert.throws(
        () =>
          manageScopedMemory(db, scope, target.memory, {
            action: "note",
            content: "Injected note",
          }),
        denied,
      );
      assert.throws(
        () =>
          manageScopedMemory(db, scope, target.memory, {
            action: "details",
            version: 1,
            title: "Tampered",
            story: "Tampered",
            stageId: null,
          }),
        denied,
      );
      assert.throws(
        () => manageScopedMemory(db, scope, target.memory, { action: "trash" }),
        denied,
      );
      assert.throws(() => readScopedStage(db, scope, target.stage), denied);
      assert.throws(
        () => manageScopedStage(db, scope, target.stage, { action: "publication", isPublic: true }),
        denied,
      );
      assert.throws(() => manageScopedStage(db, scope, target.stage, { action: "trash" }), denied);
      assert.throws(() => archiveScopedPhoto(db, scope, target.photo), denied);
      let removed = false;
      await assert.rejects(
        deleteUploadedPhotoInDatabase(
          db,
          {
            remove: async () => {
              removed = true;
            },
          },
          target.photo,
          scope,
        ),
        denied,
      );
      assert.equal(removed, false);
      // Museum B members may read B independently; A membership must never grant that read.
      assert.equal(
        canReadMuseumPhoto(db, scope.userId, target.key),
        actor === "both-museum-collaborator",
      );
      assert.throws(
        () => configureScopedShare(db, scope, target.memory, { enabled: true, mode: "link" }),
        denied,
      );
      assert.throws(
        () => configureScopedShare(db, scope, target.memory, { enabled: false, mode: "link" }),
        denied,
      );
      for (const action of ["restore", "permanent"] as const) {
        assert.throws(
          () =>
            manageScopedMemory(
              db,
              scope,
              target.trashMemory,
              action === "permanent" ? { action, confirm: true } : { action },
            ),
          denied,
        );
        assert.throws(() => manageScopedStage(db, scope, target.trashStage, { action }), denied);
      }
      assert.equal(snapshot(), before);
    } finally {
      db.close();
    }
  });
}
