import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import {
  createScopedStage,
  manageScopedStage,
  listScopedStages,
  readScopedStage,
} from "../src/data/scoped-stage.ts";
import { ApiError } from "../src/http/errors.ts";
import { findStageByIdInDatabase } from "../src/data/memory-repository.ts";

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
    createMuseumInDatabase(db, { ownerId: user.id, name: "Museum", slug: `stage-${i}` }),
  );
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museums[0].id, users[1].id);
  const insert = db.prepare(
    "INSERT INTO stages (id,museum_id,title,created_at,updated_at) VALUES (?,?,'Stage','now','now')",
  );
  insert.run("own", museums[0].id);
  insert.run("foreign", museums[1].id);
  insert.run("legacy", null);
  db.prepare(
    "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES ('foreign-photo',?,'Photo','image/webp','foreign.webp',1,1,'now')",
  ).run(museums[1].id);
  return {
    db,
    owner: { userId: users[0].id, museumId: museums[0].id },
    member: { userId: users[1].id, museumId: museums[0].id },
    foreignMuseum: museums[1].id,
  };
}
test("collaborator Stage lifecycle is scoped and permanent deletion is Owner-only", () => {
  const { db, owner, member } = fixture();
  try {
    const stage = createScopedStage(db, member, { title: "Created" });
    assert.equal(
      db.prepare("SELECT museum_id FROM stages WHERE id=?").get(stage.id)?.museum_id,
      member.museumId,
    );
    manageScopedStage(db, member, stage.id, {
      action: "details",
      input: { title: "Edited", version: stage.version },
    });
    assert.equal(readScopedStage(db, member, stage.id).title, "Edited");
    manageScopedStage(db, member, stage.id, { action: "publication", isPublic: false });
    assert.equal(readScopedStage(db, member, stage.id).isPublic, false);
    manageScopedStage(db, member, stage.id, { action: "trash" });
    assert.throws(() => readScopedStage(db, member, stage.id));
    assert.ok(listScopedStages(db, member, true).some((s) => s.id === stage.id));
    assert.throws(
      () => manageScopedStage(db, member, stage.id, { action: "permanent" }),
      (e) => e instanceof ApiError && e.status === 403,
    );
    manageScopedStage(db, member, stage.id, { action: "restore" });
    manageScopedStage(db, owner, stage.id, { action: "trash" });
    manageScopedStage(db, owner, stage.id, { action: "permanent" });
    assert.equal(db.prepare("SELECT id FROM stages WHERE id=?").get(stage.id), undefined);
  } finally {
    db.close();
  }
});
test("cross-Museum IDs, unknown IDs, unscoped IDs and foreign cover bindings fail without writes", () => {
  const { db, member } = fixture();
  try {
    assert.deepEqual(
      listScopedStages(db, member).map((s) => s.id),
      ["own"],
    );
    for (const id of ["foreign", "legacy", "missing", "own' OR 1=1--"]) {
      assert.throws(
        () => readScopedStage(db, member, id),
        (e) => e instanceof ApiError && e.status === 404,
      );
      for (const action of ["trash", "restore", "permanent"] as const)
        assert.throws(
          () => manageScopedStage(db, member, id, { action }),
          (e) => e instanceof ApiError && e.status === 404,
        );
      assert.throws(() =>
        manageScopedStage(db, member, id, {
          action: "details",
          input: { title: "Attack", version: 1 },
        }),
      );
    }
    assert.throws(() =>
      createScopedStage(db, member, { title: "Attack", coverPhotoId: "foreign-photo" }),
    );
    assert.throws(() =>
      manageScopedStage(db, member, "own", {
        action: "details",
        input: { title: "Attack", coverPhotoId: "foreign-photo", version: 1 },
      }),
    );
    assert.equal(readScopedStage(db, member, "own").title, "Stage");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stages").get()?.n, 3);
    db.prepare("UPDATE museum_memberships SET status='revoked'").run();
    assert.throws(() => listScopedStages(db, member));
    assert.throws(() => manageScopedStage(db, member, "own", { action: "trash" }));
  } finally {
    db.close();
  }
});
test("corrupt foreign cover and attached Memory cannot be read or modified through a local Stage", () => {
  const { db, owner, member, foreignMuseum } = fixture();
  try {
    db.prepare(
      "INSERT INTO stage_covers (stage_id,museum_id,storage_key) VALUES ('own',?,'foreign.webp')",
    ).run(member.museumId);
    assert.equal(readScopedStage(db, member, "own").coverKey, null);
    assert.equal(findStageByIdInDatabase(db, "own", true)?.coverKey, null);
    assert.throws(() => manageScopedStage(db, owner, "own", { action: "trash" }));
    db.prepare("DELETE FROM stage_covers").run();
    db.prepare(
      "INSERT INTO memories (id,museum_id,stage_id,title,story,created_at,updated_at) VALUES ('foreign-memory',?,'own','Secret','Story','now','now')",
    ).run(foreignMuseum);
    assert.throws(() => manageScopedStage(db, owner, "own", { action: "trash" }));
    assert.equal(
      db.prepare("SELECT stage_id FROM memories WHERE id='foreign-memory'").get()?.stage_id,
      "own",
    );
    assert.equal(
      db.prepare("SELECT trashed_at FROM stages WHERE id='own'").get()?.trashed_at,
      null,
    );
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(owner.museumId);
    assert.throws(() => createScopedStage(db, owner, { title: "Denied" }));
  } finally {
    db.close();
  }
});

test("Stage trash preserves local Memories as unclassified and cover deletion never touches foreign photos", () => {
  const { db, owner, member } = fixture();
  try {
    db.prepare(
      "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES ('own-photo',?,'Photo','image/webp','own.webp',1,1,'now')",
    ).run(owner.museumId);
    const stage = createScopedStage(db, member, { title: "With cover", coverPhotoId: "own-photo" });
    assert.equal(readScopedStage(db, member, stage.id).coverKey, "own.webp");
    assert.equal(
      db.prepare("SELECT museum_id FROM stage_covers WHERE stage_id=?").get(stage.id)?.museum_id,
      owner.museumId,
    );
    db.prepare(
      "INSERT INTO memories (id,museum_id,stage_id,title,story,is_public,created_at,updated_at) VALUES ('local-memory',?,?,'Kept','Story',1,'now','now')",
    ).run(owner.museumId, stage.id);
    manageScopedStage(db, member, stage.id, { action: "publication", isPublic: false });
    manageScopedStage(db, member, stage.id, { action: "trash" });
    const memory = db
      .prepare("SELECT stage_id,is_public,trashed_at FROM memories WHERE id='local-memory'")
      .get();
    assert.equal(memory?.stage_id, null);
    assert.equal(memory?.is_public, 0);
    assert.equal(memory?.trashed_at, null);
    manageScopedStage(db, owner, stage.id, { action: "permanent" });
    assert.equal(
      db.prepare("SELECT id FROM uploaded_photos WHERE id='own-photo'").get(),
      undefined,
    );
    assert.ok(db.prepare("SELECT id FROM uploaded_photos WHERE id='foreign-photo'").get());
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM photo_deletion_jobs WHERE photo_id='own-photo'").get()
        ?.n,
      1,
    );
  } finally {
    db.close();
  }
});
