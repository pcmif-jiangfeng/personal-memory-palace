import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { demoSeedSql } from "./demo-seed.ts";
import { schemaSql } from "./schema.ts";

export type Dataset = "demo" | "owner";

export function getDataset(): Dataset {
  return process.env.MEMORY_PALACE_DATASET === "owner" ? "owner" : "demo";
}

export function getDatabasePath(dataset: Dataset = getDataset()): string {
  const dataDirectory = process.env.MEMORY_PALACE_DATA_DIR
    ? path.resolve(/* turbopackIgnore: true */ process.env.MEMORY_PALACE_DATA_DIR)
    : path.join(process.cwd(), "data");
  mkdirSync(dataDirectory, { recursive: true });
  return path.join(/* turbopackIgnore: true */ dataDirectory, dataset === "demo" ? "demo.sqlite" : "palace.sqlite");
}

export function initializeDatabase(databasePath = getDatabasePath(), seedDemo = getDataset() === "demo"): DatabaseSync {
  const database = new DatabaseSync(databasePath);
  database.exec(schemaSql);
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



