import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { initializeDatabase } from "../src/data/database.ts";
import {
  addMemoryPhotosInDatabase,
  removeMemoryPhotoInDatabase,
  reorderMemoryPhotosInDatabase,
  setMemoryCoverInDatabase,
  updateMemoryExhibitMetadataInDatabase,
} from "../src/data/memory-exhibit-repository.ts";
import { listWorkspacePhotoCatalogInDatabase } from "../src/data/photo-repository.ts";
import { DomainError } from "../src/domain/errors.ts";

const now = "2026-09-18T00:00:00.000Z";

function insertMemory(database: DatabaseSync, id: string): void {
  database
    .prepare(
      `INSERT INTO memories
       (id, stage_id, title, story, visibility, created_at, updated_at)
       VALUES (?, NULL, ?, 'Story', 'private', ?, ?)`,
    )
    .run(id, id, now, now);
}

function insertPhoto(
  database: DatabaseSync,
  id: string,
  options: { archived?: boolean } = {},
): void {
  database
    .prepare(
      `INSERT INTO uploaded_photos
       (id, original_name, mime_type, optimized_storage_key, original_storage_key,
        width, height, created_at, used_at, library_archived_at)
       VALUES (?, ?, 'image/jpeg', ?, NULL, 1200, 800, ?, NULL, ?)`,
    )
    .run(id, `${id}.jpg`, `optimized/${id}.webp`, now, options.archived ? now : null);
}

function imageRows(database: DatabaseSync, memoryId: string) {
  return database
    .prepare(
      `SELECT uploaded_photos.id AS photo_id, memory_images.sort_order,
              memory_images.is_cover, memory_images.exhibit_title,
              memory_images.exhibit_description
       FROM memory_images
       JOIN uploaded_photos
         ON uploaded_photos.optimized_storage_key = memory_images.storage_key
       WHERE memory_images.memory_id = ?
       ORDER BY memory_images.sort_order`,
    )
    .all(memoryId) as Array<{
    photo_id: string;
    sort_order: number;
    is_cover: number;
    exhibit_title: string;
    exhibit_description: string;
  }>;
}

function withDatabase(name: string, operation: (database: DatabaseSync) => void): void {
  const directory = mkdtempSync(path.join(tmpdir(), `memory-palace-${name}-`));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  try {
    operation(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("adds stored photos to an existing Memory without duplicating files or relations", () => {
  withDatabase("exhibit-add", (database) => {
    insertMemory(database, "memory-a");
    insertMemory(database, "memory-b");
    insertPhoto(database, "photo-a");
    insertPhoto(database, "photo-b");

    addMemoryPhotosInDatabase(database, "memory-a", ["photo-b", "photo-a"]);
    addMemoryPhotosInDatabase(database, "memory-b", ["photo-a"]);

    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM uploaded_photos").get() as { count: number })
        .count,
      2,
    );
    assert.equal(
      (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM memory_images WHERE storage_key = 'optimized/photo-a.webp'",
          )
          .get() as { count: number }
      ).count,
      2,
    );
    assert.deepEqual(
      imageRows(database, "memory-a").map((row) => [row.photo_id, row.is_cover]),
      [
        ["photo-b", 1],
        ["photo-a", 0],
      ],
    );
    assert.throws(
      () => addMemoryPhotosInDatabase(database, "memory-a", ["photo-a"]),
      (error: unknown) => error instanceof DomainError && error.code === "PHOTO_ALREADY_IN_MEMORY",
    );
  });
});

test("rejects an invalid photo storage key before adding a Memory relation", () => {
  withDatabase("exhibit-invalid-row", (database) => {
    insertMemory(database, "memory-a");
    database
      .prepare(
        `INSERT INTO uploaded_photos
         (id, original_name, mime_type, optimized_storage_key, original_storage_key,
          width, height, created_at, used_at, library_archived_at)
         VALUES (?, ?, 'image/jpeg', ?, NULL, 1200, 800, ?, NULL, NULL)`,
      )
      .run("invalid-photo", "invalid-photo.jpg", Buffer.from("optimized/invalid-photo.webp"), now);

    assert.throws(
      () => addMemoryPhotosInDatabase(database, "memory-a", ["invalid-photo"]),
      /Invalid database column storage_key; expected string/,
    );
    assert.equal(imageRows(database, "memory-a").length, 0);
  });
});

test("removes only the selected relation and restores the correct photo-library state", () => {
  withDatabase("exhibit-remove", (database) => {
    insertMemory(database, "memory-a");
    insertMemory(database, "memory-b");
    insertPhoto(database, "shared-photo");
    insertPhoto(database, "archived-photo", { archived: true });
    addMemoryPhotosInDatabase(database, "memory-a", ["shared-photo", "archived-photo"]);
    addMemoryPhotosInDatabase(database, "memory-b", ["shared-photo"]);

    removeMemoryPhotoInDatabase(database, "memory-a", "shared-photo");
    assert.equal(imageRows(database, "memory-a").length, 1);
    assert.equal(imageRows(database, "memory-b").length, 1);
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM uploaded_photos WHERE id = 'shared-photo'")
          .get() as { count: number }
      ).count,
      1,
    );
    assert.notEqual(
      (
        database.prepare("SELECT used_at FROM uploaded_photos WHERE id = 'shared-photo'").get() as {
          used_at: string | null;
        }
      ).used_at,
      null,
    );

    removeMemoryPhotoInDatabase(database, "memory-b", "shared-photo");
    removeMemoryPhotoInDatabase(database, "memory-a", "archived-photo");
    const catalog = listWorkspacePhotoCatalogInDatabase(database);
    const shared = catalog.find((photo) => photo.id === "shared-photo");
    const archived = catalog.find((photo) => photo.id === "archived-photo");
    assert.equal(shared?.activeMemoryCount, 0);
    assert.equal(shared?.libraryMember, false);
    assert.equal(shared?.usedAt, null);
    assert.equal(archived?.activeMemoryCount, 0);
    assert.equal(archived?.libraryMember, true);
    assert.equal(archived?.usedAt, null);
  });
});

test("reorders photos, changes the cover and repairs the cover after removal", () => {
  withDatabase("exhibit-order", (database) => {
    insertMemory(database, "memory-a");
    for (const id of ["photo-a", "photo-b", "photo-c"]) insertPhoto(database, id);
    addMemoryPhotosInDatabase(database, "memory-a", ["photo-a", "photo-b", "photo-c"]);

    reorderMemoryPhotosInDatabase(database, "memory-a", ["photo-c", "photo-a", "photo-b"]);
    setMemoryCoverInDatabase(database, "memory-a", "photo-b");
    assert.deepEqual(
      imageRows(database, "memory-a").map((row) => [row.photo_id, row.sort_order, row.is_cover]),
      [
        ["photo-c", 0, 0],
        ["photo-a", 1, 0],
        ["photo-b", 2, 1],
      ],
    );

    assert.throws(
      () => reorderMemoryPhotosInDatabase(database, "memory-a", ["photo-a"]),
      (error: unknown) => error instanceof DomainError && error.code === "INVALID_PHOTO_ORDER",
    );
    assert.deepEqual(
      imageRows(database, "memory-a").map((row) => row.photo_id),
      ["photo-c", "photo-a", "photo-b"],
    );

    removeMemoryPhotoInDatabase(database, "memory-a", "photo-b");
    assert.deepEqual(
      imageRows(database, "memory-a").map((row) => [row.photo_id, row.is_cover]),
      [
        ["photo-c", 1],
        ["photo-a", 0],
      ],
    );
    removeMemoryPhotoInDatabase(database, "memory-a", "photo-c");
    removeMemoryPhotoInDatabase(database, "memory-a", "photo-a");
    assert.deepEqual(imageRows(database, "memory-a"), []);
    const memory = database
      .prepare("SELECT title, story FROM memories WHERE id = ?")
      .get("memory-a") as { title: string; story: string };
    assert.equal(memory.title, "memory-a");
    assert.equal(memory.story, "Story");
  });
});

test("keeps exhibit titles and descriptions scoped to each Memory relation", () => {
  withDatabase("exhibit-metadata", (database) => {
    insertMemory(database, "memory-a");
    insertMemory(database, "memory-b");
    insertPhoto(database, "shared-photo");
    addMemoryPhotosInDatabase(database, "memory-a", ["shared-photo"]);
    addMemoryPhotosInDatabase(database, "memory-b", ["shared-photo"]);

    updateMemoryExhibitMetadataInDatabase(database, "memory-a", "shared-photo", {
      title: "  校园湖畔  ",
      description: "  那天的云很低。  ",
    });

    assert.deepEqual(
      imageRows(database, "memory-a").map((row) => [row.exhibit_title, row.exhibit_description]),
      [["校园湖畔", "那天的云很低。"]],
    );
    assert.deepEqual(
      imageRows(database, "memory-b").map((row) => [row.exhibit_title, row.exhibit_description]),
      [["", ""]],
    );
  });
});
