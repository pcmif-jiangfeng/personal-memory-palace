import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { demoSeedSql } from "./demo-seed.ts";
import { schemaSql } from "./schema.ts";
import { getDataDirectory, getDatasetConfig, type Dataset } from "../config.ts";

export type { Dataset } from "../config.ts";

export function getDataset(): Dataset {
  return getDatasetConfig();
}

export function getDatabasePath(dataset: Dataset = getDataset()): string {
  const dataDirectory = getDataDirectory();
  mkdirSync(dataDirectory, { recursive: true });
  return path.join(/* turbopackIgnore: true */ dataDirectory, dataset === "demo" ? "demo.sqlite" : "palace.sqlite");
}

export function initializeDatabase(databasePath = getDatabasePath(), seedDemo = getDataset() === "demo"): DatabaseSync {
  const database = new DatabaseSync(databasePath);
  database.exec(schemaSql);
  ensureMemoryExhibitSchema(database);
  ensurePhotoLibrarySchema(database);
  if (seedDemo) {
    database.exec(demoSeedSql);
  }
  return database;
}

function ensureMemoryExhibitSchema(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(memory_images)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "exhibit_title")) {
    database.exec("ALTER TABLE memory_images ADD COLUMN exhibit_title TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.some((column) => column.name === "exhibit_description")) {
    database.exec(
      "ALTER TABLE memory_images ADD COLUMN exhibit_description TEXT NOT NULL DEFAULT ''",
    );
  }
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS memory_images_unique_photo
    ON memory_images(memory_id, storage_key)
  `);
}

function ensurePhotoLibrarySchema(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(uploaded_photos)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "library_archived_at")) {
    database.exec("ALTER TABLE uploaded_photos ADD COLUMN library_archived_at TEXT");
  }
  database.exec(`
    UPDATE uploaded_photos
    SET used_at = (
      SELECT MIN(memory_images.created_at)
      FROM memory_images
      WHERE memory_images.storage_key = uploaded_photos.optimized_storage_key
    )
    WHERE used_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM memory_images
        WHERE memory_images.storage_key = uploaded_photos.optimized_storage_key
      )
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS uploaded_photos_library
    ON uploaded_photos(used_at, library_archived_at, created_at DESC)
  `);
}

let database: DatabaseSync | undefined;

export function getDatabase(): DatabaseSync {
  database ??= initializeDatabase();
  return database;
}



