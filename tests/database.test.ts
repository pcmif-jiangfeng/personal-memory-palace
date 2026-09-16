import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";

test("initializes the core schema and isolated demo data", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-"));
  const databasePath = path.join(directory, "demo.sqlite");

  try {
    const database = initializeDatabase(databasePath, true);
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).all().map((row) => (row as { name: string }).name);
    const memoryCount = database.prepare("SELECT COUNT(*) AS count FROM memories").get() as { count: number };
    const multiImageCount = database.prepare(
      "SELECT COUNT(*) AS count FROM memory_images WHERE memory_id = 'memory-coast'"
    ).get() as { count: number };
    const relationCount = database.prepare("SELECT COUNT(*) AS count FROM memory_relations").get() as { count: number };
    const journeyPhotoCount = database.prepare(`
      SELECT COUNT(*) AS count FROM memory_images
      JOIN memories ON memories.id = memory_images.memory_id
      WHERE memories.stage_id = 'stage-journey'
    `).get() as { count: number };
    const laterNoteCount = database.prepare(
      "SELECT COUNT(*) AS count FROM later_notes WHERE memory_id = 'memory-library'"
    ).get() as { count: number };
    database.close();

    assert.deepEqual(tables, ["later_notes", "memories", "memory_images", "memory_relations", "share_configs", "stage_covers", "stages", "uploaded_photos"]);
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
    const memoryCount = database.prepare("SELECT COUNT(*) AS count FROM memories").get() as { count: number };
    database.close();
    assert.equal(memoryCount.count, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

