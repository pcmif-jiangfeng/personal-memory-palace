import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { updateMemoryDetailsInDatabase } from "../src/data/management-repository.ts";

test("initializes the core schema and isolated demo data", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-"));
  const databasePath = path.join(directory, "demo.sqlite");

  try {
    const database = initializeDatabase(databasePath, true);
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    const memoryCount = database.prepare("SELECT COUNT(*) AS count FROM memories").get() as {
      count: number;
    };
    const multiImageCount = database
      .prepare("SELECT COUNT(*) AS count FROM memory_images WHERE memory_id = 'memory-coast'")
      .get() as { count: number };
    const relationCount = database
      .prepare("SELECT COUNT(*) AS count FROM memory_relations")
      .get() as { count: number };
    const journeyPhotoCount = database
      .prepare(
        `
      SELECT COUNT(*) AS count FROM memory_images
      JOIN memories ON memories.id = memory_images.memory_id
      WHERE memories.stage_id = 'stage-journey'
    `,
      )
      .get() as { count: number };
    const laterNoteCount = database
      .prepare("SELECT COUNT(*) AS count FROM later_notes WHERE memory_id = 'memory-library'")
      .get() as { count: number };
    database.close();

    assert.deepEqual(tables, [
      "later_notes",
      "memories",
      "memory_images",
      "memory_relations",
      "photo_deletion_jobs",
      "share_configs",
      "stage_covers",
      "stages",
      "uploaded_photos",
    ]);
    assert.equal(memoryCount.count, 5);
    assert.equal(multiImageCount.count, 3);
    assert.ok(relationCount.count >= 1);
    assert.ok(journeyPhotoCount.count >= 3);
    assert.equal(laterNoteCount.count, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("owner database starts without demo records", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-owner-"));
  const databasePath = path.join(directory, "owner.sqlite");

  try {
    const database = initializeDatabase(databasePath, false);
    const memoryCount = database.prepare("SELECT COUNT(*) AS count FROM memories").get() as {
      count: number;
    };
    database.close();
    assert.equal(memoryCount.count, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("updates Memory title, Original Story and optional Stage without touching its exhibition data", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-edit-"));
  const databasePath = path.join(directory, "owner.sqlite");
  let database: ReturnType<typeof initializeDatabase> | undefined;

  try {
    database = initializeDatabase(databasePath, false);
    const activeDatabase = database;
    const now = new Date().toISOString();
    database
      .prepare(
        "INSERT INTO stages (id, title, description, created_at, updated_at) VALUES (?, ?, '', ?, ?)",
      )
      .run("stage-edit", "可选择章节", now, now);
    database
      .prepare(
        `INSERT INTO memories
      (id, stage_id, title, story, visibility, created_at, updated_at)
      VALUES (?, NULL, ?, ?, 'private', ?, ?)`,
      )
      .run("memory-edit", "旧标题", "旧 Story", now, now);
    database
      .prepare("INSERT INTO later_notes (id, memory_id, content, created_at) VALUES (?, ?, ?, ?)")
      .run("note-edit", "memory-edit", "保留的注记", now);

    updateMemoryDetailsInDatabase(database, "memory-edit", {
      title: "  新标题  ",
      story: "  新的 Original Story  ",
      stageId: "stage-edit",
    });
    const assigned = database
      .prepare("SELECT title, story, stage_id FROM memories WHERE id = ?")
      .get("memory-edit") as { title: string; story: string; stage_id: string | null };
    assert.equal(assigned.title, "新标题");
    assert.equal(assigned.story, "新的 Original Story");
    assert.equal(assigned.stage_id, "stage-edit");

    updateMemoryDetailsInDatabase(database, "memory-edit", {
      title: "新标题",
      story: "新的 Original Story",
      stageId: null,
    });
    const unassigned = database
      .prepare("SELECT stage_id FROM memories WHERE id = ?")
      .get("memory-edit") as { stage_id: string | null };
    const noteCount = database
      .prepare("SELECT COUNT(*) AS count FROM later_notes WHERE memory_id = ?")
      .get("memory-edit") as { count: number };
    assert.equal(unassigned.stage_id, null);
    assert.equal(noteCount.count, 1);

    assert.throws(
      () =>
        updateMemoryDetailsInDatabase(activeDatabase, "memory-edit", {
          title: "",
          story: "Story",
          stageId: null,
        }),
      /TITLE_REQUIRED/,
    );
    assert.throws(
      () =>
        updateMemoryDetailsInDatabase(activeDatabase, "memory-edit", {
          title: "标题",
          story: "Story",
          stageId: "missing-stage",
        }),
      /INVALID_STAGE/,
    );
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
