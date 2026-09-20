import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createMemoryInDatabase } from "../src/data/memory-write-repository.ts";

test("rejects an invalid photo storage key before committing a Memory", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-memory-write-row-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);

  try {
    database
      .prepare(
        `INSERT INTO uploaded_photos
          (id, original_name, mime_type, optimized_storage_key, original_storage_key,
           width, height, created_at, used_at, library_archived_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL)`,
      )
      .run(
        "invalid-photo",
        "invalid.jpg",
        "image/jpeg",
        Buffer.from("optimized/invalid.webp"),
        1200,
        800,
        "2026-09-20T00:00:00.000Z",
      );

    assert.throws(
      () =>
        createMemoryInDatabase(database, {
          title: "无效照片",
          story: "数据库边界应拒绝非字符串存储键。",
          photoIds: ["invalid-photo"],
          coverPhotoId: "invalid-photo",
        }),
      /Invalid database column storage_key; expected string/,
    );

    const memoryCount = database.prepare("SELECT COUNT(*) AS count FROM memories").get() as {
      count: number;
    };
    assert.equal(memoryCount.count, 0);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
