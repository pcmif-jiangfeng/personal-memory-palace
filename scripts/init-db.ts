import { existsSync, rmSync } from "node:fs";
import { getDatabasePath, getDataset, initializeDatabase } from "../src/data/database.ts";

const dataset = getDataset();
const databasePath = getDatabasePath(dataset);

if (process.argv.includes("--reset") && existsSync(databasePath)) {
  rmSync(databasePath);
}

const database = initializeDatabase(databasePath, dataset === "demo");
const stageCount = database.prepare("SELECT COUNT(*) AS count FROM stages").get() as { count: number };
const memoryCount = database.prepare("SELECT COUNT(*) AS count FROM memories").get() as { count: number };
database.close();

console.log(`Database ready: ${databasePath}`);
console.log(`Dataset: ${dataset}; stages: ${stageCount.count}; memories: ${memoryCount.count}`);

