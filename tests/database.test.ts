import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { initializeDatabase } from "../src/data/database.ts";
import {
  updateMemoryDetailsInDatabase,
  updateMemoryRelationsInDatabase,
} from "../src/data/management-repository.ts";

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
      "pending_uploads",
      "photo_deletion_jobs",
      "schema_migrations",
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

test("updates canonical Memory relations from either endpoint", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-relations-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const now = "2026-09-19T00:00:00.000Z";

  try {
    const insert = database.prepare(`
      INSERT INTO memories
        (id, stage_id, title, story, visibility, created_at, updated_at)
      VALUES (?, NULL, ?, 'Story', 'private', ?, ?)
    `);
    for (const id of ["memory-a", "memory-b", "memory-c"]) {
      insert.run(id, id, now, now);
    }

    updateMemoryRelationsInDatabase(database, "memory-a", ["memory-b"]);
    updateMemoryRelationsInDatabase(database, "memory-b", ["memory-a"]);
    let rows = database
      .prepare("SELECT memory_id, related_memory_id FROM memory_relations")
      .all()
      .map((row) => ({
        memory_id: String((row as { memory_id: string }).memory_id),
        related_memory_id: String((row as { related_memory_id: string }).related_memory_id),
      }));
    assert.deepEqual(rows, [{ memory_id: "memory-a", related_memory_id: "memory-b" }]);

    updateMemoryRelationsInDatabase(database, "memory-b", ["memory-c"]);
    rows = database
      .prepare("SELECT memory_id, related_memory_id FROM memory_relations")
      .all()
      .map((row) => ({
        memory_id: String((row as { memory_id: string }).memory_id),
        related_memory_id: String((row as { related_memory_id: string }).related_memory_id),
      }));
    assert.deepEqual(rows, [{ memory_id: "memory-b", related_memory_id: "memory-c" }]);
  } finally {
    database.close();
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

test("adds photo library membership to an existing owner database without losing photos", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-migrate-"));
  const databasePath = path.join(directory, "owner.sqlite");

  try {
    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec(`
      CREATE TABLE uploaded_photos (
        id TEXT PRIMARY KEY,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        optimized_storage_key TEXT NOT NULL UNIQUE,
        original_storage_key TEXT,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        used_at TEXT
      );
      INSERT INTO uploaded_photos
        (id, original_name, mime_type, optimized_storage_key, width, height, created_at)
      VALUES
        ('legacy-photo', 'legacy.jpg', 'image/jpeg', 'optimized/legacy.webp', 1200, 800,
         '2026-09-01T00:00:00.000Z');
    `);
    legacyDatabase.close();

    const database = initializeDatabase(databasePath, false);
    const columns = database
      .prepare("PRAGMA table_info(uploaded_photos)")
      .all()
      .map((row) => (row as { name: string }).name);
    const photo = database
      .prepare("SELECT id, library_archived_at FROM uploaded_photos WHERE id = ?")
      .get("legacy-photo") as { id: string; library_archived_at: string | null };
    assert.ok(columns.includes("library_archived_at"));
    assert.equal(photo.id, "legacy-photo");
    assert.equal(photo.library_archived_at, null);
    const versions = database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => (row as { version: number }).version);
    assert.deepEqual(versions, [1, 2, 3, 4]);
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backfills library membership for a legacy photo already referenced by a Memory", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-membership-"));
  const databasePath = path.join(directory, "owner.sqlite");
  const createdAt = "2026-09-01T00:00:00.000Z";

  try {
    const original = initializeDatabase(databasePath, false);
    original
      .prepare(
        `
        INSERT INTO uploaded_photos
          (id, original_name, mime_type, optimized_storage_key, original_storage_key,
           width, height, created_at, used_at)
        VALUES ('legacy-used', 'legacy.jpg', 'image/jpeg', 'optimized/legacy-used.webp',
                NULL, 1200, 800, ?, NULL)
      `,
      )
      .run(createdAt);
    original
      .prepare(
        `
        INSERT INTO memories
          (id, stage_id, title, story, visibility, created_at, updated_at)
        VALUES ('legacy-memory', NULL, '旧 Memory', 'Story', 'private', ?, ?)
      `,
      )
      .run(createdAt, createdAt);
    original
      .prepare(
        `
        INSERT INTO memory_images
          (id, memory_id, storage_key, alt_text, sort_order, is_cover, created_at)
        VALUES ('legacy-image', 'legacy-memory', 'optimized/legacy-used.webp', '', 0, 1, ?)
      `,
      )
      .run(createdAt);
    original.exec("DROP TABLE schema_migrations");
    original.close();

    const migrated = initializeDatabase(databasePath, false);
    const photo = migrated
      .prepare("SELECT used_at FROM uploaded_photos WHERE id = ?")
      .get("legacy-used") as { used_at: string };
    migrated.close();

    assert.equal(photo.used_at, createdAt);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("adds exhibit metadata columns and relation uniqueness to a legacy database", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-exhibit-migrate-"));
  const databasePath = path.join(directory, "owner.sqlite");

  try {
    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec(`
      CREATE TABLE memory_images (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        alt_text TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_cover INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      INSERT INTO memory_images
        (id, memory_id, storage_key, alt_text, sort_order, is_cover, created_at)
      VALUES
        ('legacy-image', 'legacy-memory', 'optimized/legacy.webp', '', 0, 1,
         '2026-09-01T00:00:00.000Z');
    `);
    legacyDatabase.close();

    const database = initializeDatabase(databasePath, false);
    const columns = database
      .prepare("PRAGMA table_info(memory_images)")
      .all()
      .map((row) => (row as { name: string }).name);
    const metadata = database
      .prepare("SELECT exhibit_title, exhibit_description FROM memory_images WHERE id = ?")
      .get("legacy-image") as {
      exhibit_title: string;
      exhibit_description: string;
    };
    const indexNames = database
      .prepare("PRAGMA index_list(memory_images)")
      .all()
      .map((row) => (row as { name: string }).name);
    database.close();

    assert.ok(columns.includes("exhibit_title"));
    assert.ok(columns.includes("exhibit_description"));
    assert.equal(metadata.exhibit_title, "");
    assert.equal(metadata.exhibit_description, "");
    assert.ok(indexNames.includes("memory_images_unique_photo"));
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

test("records each database migration once", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-migration-log-"));
  const databasePath = path.join(directory, "owner.sqlite");

  try {
    initializeDatabase(databasePath, false).close();
    const database = initializeDatabase(databasePath, false);
    const versions = database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => (row as { version: number }).version);
    database.close();

    assert.deepEqual(versions, [1, 2, 3, 4]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
