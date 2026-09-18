import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import {
  archiveUploadedPhotoInDatabase,
  listWorkspacePhotoCatalogInDatabase,
} from "../src/data/photo-repository.ts";
import { ApiError } from "../src/http/errors.ts";
import { createMemoryInDatabase } from "../src/data/memory-write-repository.ts";

test("keeps recent and library membership separate from current Memory references", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-library-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const now = "2026-09-18T00:00:00.000Z";
  const insertPhoto = database.prepare(`
    INSERT INTO uploaded_photos
      (id, original_name, mime_type, optimized_storage_key, original_storage_key,
       width, height, created_at, used_at, library_archived_at)
    VALUES (?, ?, 'image/jpeg', ?, NULL, 1200, 800, ?, ?, ?)
  `);

  try {
    insertPhoto.run("recent", "recent.jpg", "optimized/recent.webp", now, null, null);
    insertPhoto.run("archived", "archived.jpg", "optimized/archived.webp", now, null, now);
    insertPhoto.run("used", "used.jpg", "optimized/used.webp", now, now, null);
    for (const [stageId, stageTitle] of [
      ["stage-a", "大学"],
      ["stage-b", "远方"],
    ]) {
      database
        .prepare(
          "INSERT INTO stages (id, title, description, created_at, updated_at) VALUES (?, ?, '', ?, ?)",
        )
        .run(stageId, stageTitle, now, now);
    }
    for (const [memoryId, title, stageId] of [
      ["memory-a", "校园黄昏", "stage-a"],
      ["memory-b", "远方旅途", "stage-b"],
    ]) {
      database
        .prepare(
          `
          INSERT INTO memories
            (id, stage_id, title, story, visibility, created_at, updated_at)
          VALUES (?, ?, ?, 'Story', 'private', ?, ?)
        `,
        )
        .run(memoryId, stageId, title, now, now);
      database
        .prepare(
          `
          INSERT INTO memory_images
            (id, memory_id, storage_key, alt_text, sort_order, is_cover, created_at)
          VALUES (?, ?, 'optimized/used.webp', '', 0, 1, ?)
        `,
        )
        .run(`image-${memoryId}`, memoryId, now);
    }

    const photos = listWorkspacePhotoCatalogInDatabase(database);
    const recent = photos.find((photo) => photo.id === "recent");
    const archived = photos.find((photo) => photo.id === "archived");
    const used = photos.find((photo) => photo.id === "used");

    assert.equal(recent?.libraryMember, false);
    assert.equal(recent?.activeMemoryCount, 0);
    assert.equal(archived?.libraryMember, true);
    assert.equal(archived?.activeMemoryCount, 0);
    assert.equal(used?.libraryMember, true);
    assert.equal(used?.activeMemoryCount, 2);
    assert.deepEqual(new Set(used?.memoryTitles), new Set(["校园黄昏", "远方旅途"]));
    assert.deepEqual(new Set(used?.stageIds), new Set(["stage-a", "stage-b"]));

    assert.deepEqual(archiveUploadedPhotoInDatabase(database, "recent"), { archived: true });
    assert.equal(
      listWorkspacePhotoCatalogInDatabase(database).find((photo) => photo.id === "recent")
        ?.libraryMember,
      true,
    );
    assert.throws(
      () => archiveUploadedPhotoInDatabase(database, "missing"),
      (error: unknown) =>
        error instanceof ApiError && error.code === "PHOTO_NOT_FOUND" && error.status === 404,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reuses one stored photo across multiple Memories without duplicating its file record", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-reuse-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const createdAt = "2026-09-18T00:00:00.000Z";

  try {
    database
      .prepare(
        `
        INSERT INTO uploaded_photos
          (id, original_name, mime_type, optimized_storage_key, original_storage_key,
           width, height, created_at, used_at, library_archived_at)
        VALUES ('shared-photo', 'shared.jpg', 'image/jpeg', 'optimized/shared.webp',
                NULL, 1200, 800, ?, NULL, NULL)
      `,
      )
      .run(createdAt);

    createMemoryInDatabase(database, {
      title: "第一次使用",
      story: "同一张照片第一次进入 Memory。",
      photoIds: ["shared-photo", "shared-photo"],
      coverPhotoId: "shared-photo",
    });
    const firstUsedAt = (
      database.prepare("SELECT used_at FROM uploaded_photos WHERE id = ?").get("shared-photo") as {
        used_at: string;
      }
    ).used_at;
    createMemoryInDatabase(database, {
      title: "第二次使用",
      story: "同一张照片再次进入另一个 Memory。",
      photoIds: ["shared-photo"],
      coverPhotoId: "shared-photo",
    });

    const photoCount = database
      .prepare("SELECT COUNT(*) AS count FROM uploaded_photos WHERE id = ?")
      .get("shared-photo") as { count: number };
    const relationCount = database
      .prepare("SELECT COUNT(*) AS count FROM memory_images WHERE storage_key = ?")
      .get("optimized/shared.webp") as { count: number };
    const secondUsedAt = (
      database.prepare("SELECT used_at FROM uploaded_photos WHERE id = ?").get("shared-photo") as {
        used_at: string;
      }
    ).used_at;

    assert.equal(photoCount.count, 1);
    assert.equal(relationCount.count, 2);
    assert.equal(secondUsedAt, firstUsedAt);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
