import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { findRandomActiveMemoryInDatabase } from "../src/data/memory-repository.ts";

test("returns an empty Time Gear result only when no active Memory exists", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-recall-empty-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);

  try {
    assert.equal(findRandomActiveMemoryInDatabase(database), null);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("includes text-only Memories and excludes trashed Memories from Time Gear", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-recall-text-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const now = "2026-09-18T00:00:00.000Z";

  try {
    database
      .prepare(
        `INSERT INTO memories
         (id, stage_id, title, story, visibility, created_at, updated_at, trashed_at)
         VALUES (?, NULL, ?, ?, 'private', ?, ?, ?)`,
      )
      .run("text-only", "只有文字", "这段 Memory 没有照片。", now, now, null);
    database
      .prepare(
        `INSERT INTO memories
         (id, stage_id, title, story, visibility, created_at, updated_at, trashed_at)
         VALUES (?, NULL, ?, ?, 'private', ?, ?, ?)`,
      )
      .run("trashed", "已删除", "不应被随机到。", now, now, now);

    for (let index = 0; index < 10; index += 1) {
      const memory = findRandomActiveMemoryInDatabase(database);
      assert.equal(memory?.id, "text-only");
      assert.equal(memory?.imageCount, 0);
      assert.equal(memory?.coverKey, null);
    }
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
