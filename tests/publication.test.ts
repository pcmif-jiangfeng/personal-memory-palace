import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { initializeDatabase } from "../src/data/database.ts";
import {
  findMemoryByIdInDatabase,
  findRandomActiveMemoryInDatabase,
  listActiveMemoriesInDatabase,
} from "../src/data/memory-repository.ts";
import { updateMemoryDetailsInDatabase } from "../src/data/management-repository.ts";
import { addMemoryPhotosInDatabase } from "../src/data/memory-exhibit-repository.ts";
import {
  isMemoryPublicInDatabase,
  isPublicImageAccessibleInDatabase,
  setMemoryPublicInDatabase,
  setStagePublicInDatabase,
} from "../src/data/publication-repository.ts";
import { isSharedImageAccessibleInDatabase } from "../src/data/share-repository.ts";
import { trashStageInDatabase } from "../src/data/management-repository.ts";

test("publication defaults are public for stages and memories", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-public-default-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const now = new Date().toISOString();
  try {
    database
      .prepare(
        "INSERT INTO stages (id, title, created_at, updated_at) VALUES ('stage', 'Stage', ?, ?)",
      )
      .run(now, now);
    database
      .prepare(
        "INSERT INTO memories (id, stage_id, title, story, created_at, updated_at) VALUES ('memory', 'stage', 'Memory', 'Story', ?, ?)",
      )
      .run(now, now);
    assert.equal(
      (
        database.prepare("SELECT is_public FROM stages WHERE id = 'stage'").get() as {
          is_public: number;
        }
      ).is_public,
      1,
    );
    assert.equal(findMemoryByIdInDatabase(database, "memory", true)?.isPublic, true);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the same public memory URL reads updated details and photos on the next request", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-public-update-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const now = new Date().toISOString();
  try {
    database
      .prepare(
        "INSERT INTO stages (id, title, created_at, updated_at) VALUES ('stage', 'Stage', ?, ?)",
      )
      .run(now, now);
    database
      .prepare(
        "INSERT INTO memories (id, title, story, created_at, updated_at) VALUES ('memory', 'Before', 'Old story', ?, ?)",
      )
      .run(now, now);
    database
      .prepare(
        "INSERT INTO uploaded_photos (id, original_name, mime_type, optimized_storage_key, width, height, created_at) VALUES ('photo', 'photo.jpg', 'image/jpeg', 'photo.webp', 1200, 800, ?)",
      )
      .run(now);

    assert.equal(findMemoryByIdInDatabase(database, "memory", true)?.title, "Before");
    updateMemoryDetailsInDatabase(database, "memory", {
      title: "After",
      story: "New story",
      stageId: "stage",
    });
    addMemoryPhotosInDatabase(database, "memory", ["photo"]);

    const refreshed = findMemoryByIdInDatabase(database, "memory", true);
    assert.equal(refreshed?.title, "After");
    assert.equal(refreshed?.story, "New story");
    assert.equal(refreshed?.stageId, "stage");
    assert.equal(refreshed?.coverKey, "photo.webp");
    assert.equal(refreshed?.imageCount, 1);

    setStagePublicInDatabase(database, "stage", false);
    assert.equal(findMemoryByIdInDatabase(database, "memory", true), null);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("publication migration makes existing records public without changing legacy share flags", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-public-migration-"));
  const databasePath = path.join(directory, "owner.sqlite");
  const previous = new DatabaseSync(databasePath);
  previous.exec(`
    CREATE TABLE stages (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, trashed_at TEXT);
    CREATE TABLE memories (id TEXT PRIMARY KEY, stage_id TEXT REFERENCES stages(id), title TEXT NOT NULL, story TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, trashed_at TEXT);
    INSERT INTO stages VALUES ('stage', 'Stage', '', '2026', '2026', NULL);
    INSERT INTO memories VALUES ('memory', 'stage', 'Memory', 'Story', 'private', '2026', '2026', NULL);
  `);
  previous.close();
  const database = initializeDatabase(databasePath, false);
  try {
    assert.equal(
      (
        database.prepare("SELECT is_public FROM stages WHERE id = 'stage'").get() as {
          is_public: number;
        }
      ).is_public,
      1,
    );
    assert.equal(findMemoryByIdInDatabase(database, "memory", true)?.isPublic, true);
    assert.equal(findMemoryByIdInDatabase(database, "memory")?.visibility, "private");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("private memory or stage is absent from public lists, direct URLs, recall and image access", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-public-access-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const now = new Date().toISOString();
  try {
    database
      .prepare(
        "INSERT INTO stages (id, title, created_at, updated_at) VALUES ('stage', 'Stage', ?, ?)",
      )
      .run(now, now);
    const insert = database.prepare(
      "INSERT INTO memories (id, stage_id, title, story, visibility, created_at, updated_at) VALUES (?, ?, ?, 'Story', 'shared', ?, ?)",
    );
    insert.run("in-stage", "stage", "In stage", now, now);
    insert.run("unassigned", null, "Unassigned", now, now);
    const insertImage = database.prepare(
      "INSERT INTO memory_images (id, memory_id, storage_key, created_at) VALUES (?, ?, ?, ?)",
    );
    insertImage.run("image-stage", "in-stage", "stage.webp", now);
    insertImage.run("image-unassigned", "unassigned", "unassigned.webp", now);
    database
      .prepare("INSERT INTO stage_covers (stage_id, storage_key) VALUES ('stage', 'cover.webp')")
      .run();
    database
      .prepare(
        "INSERT INTO share_configs (id, memory_id, enabled, access_mode, created_at, updated_at) VALUES ('share-token', 'in-stage', 1, 'link', ?, ?)",
      )
      .run(now, now);

    assert.deepEqual(
      listActiveMemoriesInDatabase(database, true)
        .map((item) => item.id)
        .sort(),
      ["in-stage", "unassigned"],
    );
    assert.equal(isPublicImageAccessibleInDatabase(database, "stage.webp"), true);
    assert.equal(isPublicImageAccessibleInDatabase(database, "cover.webp"), true);
    assert.equal(isPublicImageAccessibleInDatabase(database, "unlinked.webp"), false);

    setMemoryPublicInDatabase(database, "in-stage", false);
    assert.equal(findMemoryByIdInDatabase(database, "in-stage", true), null);
    assert.equal(findMemoryByIdInDatabase(database, "in-stage")?.isPublic, false);
    assert.equal(isPublicImageAccessibleInDatabase(database, "stage.webp"), false);
    assert.equal(isSharedImageAccessibleInDatabase(database, "share-token", "stage.webp"), false);
    assert.equal(findRandomActiveMemoryInDatabase(database, true)?.id, "unassigned");

    setMemoryPublicInDatabase(database, "in-stage", true);
    setStagePublicInDatabase(database, "stage", false);
    assert.deepEqual(
      listActiveMemoriesInDatabase(database, true).map((item) => item.id),
      ["unassigned"],
    );
    assert.equal(isMemoryPublicInDatabase(database, "in-stage"), false);
    assert.equal(isPublicImageAccessibleInDatabase(database, "stage.webp"), false);
    assert.equal(isPublicImageAccessibleInDatabase(database, "cover.webp"), false);
    assert.equal(isPublicImageAccessibleInDatabase(database, "unassigned.webp"), true);

    trashStageInDatabase(database, "stage");
    assert.equal(findMemoryByIdInDatabase(database, "in-stage", true), null);
    assert.equal(findMemoryByIdInDatabase(database, "in-stage")?.isPublic, false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
