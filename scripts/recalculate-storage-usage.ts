import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDataDirectory } from "../src/config.ts";
import { getDatabasePath } from "../src/data/database.ts";
import { recalculateMuseumStorageUsageInDatabase } from "../src/data/museum-storage-usage.ts";

const [museumId, mode, ...extra] = process.argv.slice(2);
if (!museumId || mode !== "--quiesced" || extra.length > 0)
  throw new Error(
    "Usage: recalculate-storage-usage.ts <museum-id> --quiesced (pause all file writers first)",
  );
const databasePath = getDatabasePath();
if (!existsSync(databasePath)) throw new Error("Existing Museum database required");
const database = new DatabaseSync(databasePath);
try {
  database.exec("PRAGMA foreign_keys = ON");
  const result = recalculateMuseumStorageUsageInDatabase(
    database,
    museumId,
    path.join(getDataDirectory(), "images"),
  );
  console.log(JSON.stringify({ museumId, ...result }));
} finally {
  database.close();
}
