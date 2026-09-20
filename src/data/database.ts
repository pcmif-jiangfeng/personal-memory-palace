import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { demoSeedSql } from "./demo-seed.ts";
import { runDatabaseMigrations } from "./migrations.ts";
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
  runDatabaseMigrations(database);
  if (seedDemo) {
    database.exec(demoSeedSql);
  }
  return database;
}

let database: DatabaseSync | undefined;

export function getDatabase(): DatabaseSync {
  database ??= initializeDatabase();
  return database;
}

