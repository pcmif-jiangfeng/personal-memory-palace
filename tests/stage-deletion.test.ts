import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { trashStageInDatabase } from "../src/data/management-repository.ts";

function createStage(database: ReturnType<typeof initializeDatabase>, id: string) {
  const now = new Date().toISOString();
  database
    .prepare(
      "INSERT INTO stages (id, title, description, created_at, updated_at) VALUES (?, ?, '', ?, ?)",
    )
    .run(id, id, now, now);
}

test("trashing a Stage keeps its Memories and removes their classification atomically", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-stage-delete-"));
  const databasePath = path.join(directory, "owner.sqlite");
  let database: ReturnType<typeof initializeDatabase> | undefined;

  try {
    database = initializeDatabase(databasePath, false);
    createStage(database, "stage-delete");
    createStage(database, "stage-empty");
    createStage(database, "stage-single");
    const now = new Date().toISOString();
    const insertMemory = database.prepare(`INSERT INTO memories
      (id, stage_id, title, story, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'private', ?, ?)`);
    insertMemory.run("memory-a", "stage-delete", "Memory A", "Story A", now, now);
    insertMemory.run("memory-b", "stage-delete", "Memory B", "Story B", now, now);
    insertMemory.run("memory-single", "stage-single", "Single Memory", "Single Story", now, now);
    database
      .prepare(
        "INSERT INTO memory_images (id, memory_id, storage_key, sort_order, is_cover, created_at) VALUES (?, ?, ?, 0, 1, ?)",
      )
      .run("image-a", "memory-a", "test/image-a.webp", now);
    database
      .prepare("INSERT INTO later_notes (id, memory_id, content, created_at) VALUES (?, ?, ?, ?)")
      .run("note-a", "memory-a", "保留注记", now);
    database
      .prepare(
        "INSERT INTO memory_relations (memory_id, related_memory_id, created_at) VALUES (?, ?, ?)",
      )
      .run("memory-a", "memory-b", now);

    trashStageInDatabase(database, "stage-delete");

    const stage = database
      .prepare("SELECT trashed_at FROM stages WHERE id = ?")
      .get("stage-delete") as { trashed_at: string | null };
    const memories = database
      .prepare(
        "SELECT id, stage_id, story, trashed_at FROM memories WHERE id IN (?, ?) ORDER BY id",
      )
      .all("memory-a", "memory-b") as unknown as Array<{
      id: string;
      stage_id: string | null;
      story: string;
      trashed_at: string | null;
    }>;
    assert.ok(stage.trashed_at);
    assert.deepEqual(
      memories.map((memory) => ({ ...memory })),
      [
        { id: "memory-a", stage_id: null, story: "Story A", trashed_at: null },
        { id: "memory-b", stage_id: null, story: "Story B", trashed_at: null },
      ],
    );
    assert.equal(
      (
        database.prepare("SELECT is_cover FROM memory_images WHERE id = ?").get("image-a") as {
          is_cover: number;
        }
      ).is_cover,
      1,
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM later_notes").get() as { count: number })
        .count,
      1,
    );
    assert.equal(
      (
        database.prepare("SELECT COUNT(*) AS count FROM memory_relations").get() as {
          count: number;
        }
      ).count,
      1,
    );

    trashStageInDatabase(database, "stage-empty");
    trashStageInDatabase(database, "stage-single");
    assert.deepEqual(
      {
        ...database
          .prepare("SELECT stage_id, story, trashed_at FROM memories WHERE id = ?")
          .get("memory-single"),
      },
      { stage_id: null, story: "Single Story", trashed_at: null },
    );
    assert.throws(() => trashStageInDatabase(database!, "stage-delete"), /STAGE_NOT_FOUND/);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Stage trash rolls back when Memory unclassification fails", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-stage-rollback-"));
  const databasePath = path.join(directory, "owner.sqlite");
  let database: ReturnType<typeof initializeDatabase> | undefined;

  try {
    database = initializeDatabase(databasePath, false);
    createStage(database, "stage-rollback");
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO memories
        (id, stage_id, title, story, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'private', ?, ?)`,
      )
      .run("memory-rollback", "stage-rollback", "Memory", "Story", now, now);
    database.exec(`CREATE TRIGGER reject_stage_unassignment
      BEFORE UPDATE OF stage_id ON memories
      BEGIN
        SELECT RAISE(ABORT, 'forced rollback');
      END;`);

    assert.throws(() => trashStageInDatabase(database!, "stage-rollback"), /forced rollback/);
    const stage = database
      .prepare("SELECT trashed_at FROM stages WHERE id = ?")
      .get("stage-rollback") as { trashed_at: string | null };
    const memory = database
      .prepare("SELECT stage_id FROM memories WHERE id = ?")
      .get("memory-rollback") as { stage_id: string | null };
    assert.equal(stage.trashed_at, null);
    assert.equal(memory.stage_id, "stage-rollback");
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
