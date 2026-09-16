import { cp, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function referencedStorageKeys(database) {
  const keys = new Set();
  const add = (value) => {
    if (typeof value === "string" && value.startsWith("uploads/")) keys.add(value);
  };
  for (const row of database.prepare("SELECT storage_key FROM memory_images").all()) add(row.storage_key);
  for (const row of database.prepare("SELECT storage_key FROM stage_covers").all()) add(row.storage_key);
  for (const row of database.prepare(
    "SELECT optimized_storage_key, original_storage_key FROM uploaded_photos"
  ).all()) {
    add(row.optimized_storage_key);
    add(row.original_storage_key);
  }
  return [...keys];
}

export async function restoreBackup({ backupDirectory, targetDataDirectory }) {
  const databaseSource = path.join(backupDirectory, "database", "palace.sqlite");
  const uploadSource = path.join(backupDirectory, "uploads");
  const manifest = path.join(backupDirectory, "manifest.txt");
  if (!(await exists(databaseSource)) || !(await exists(manifest))) {
    throw new Error("Backup is incomplete: database or manifest is missing");
  }
  if (await exists(targetDataDirectory)) {
    const entries = await readdir(targetDataDirectory);
    if (entries.length > 0) throw new Error(`Restore target must be empty: ${targetDataDirectory}`);
  }

  const database = new DatabaseSync(databaseSource, { readOnly: true });
  let summary;
  try {
    const result = database.prepare("PRAGMA integrity_check").get();
    if (result.integrity_check !== "ok") throw new Error("SQLite integrity check failed");
    const keys = referencedStorageKeys(database);
    for (const key of keys) {
      if (!(await exists(path.join(backupDirectory, key)))) {
        throw new Error(`Referenced image is missing from backup: ${key}`);
      }
    }
    summary = {
      stages: database.prepare("SELECT COUNT(*) AS count FROM stages").get().count,
      memories: database.prepare("SELECT COUNT(*) AS count FROM memories").get().count,
      referencedImages: keys.length,
    };
  } finally {
    database.close();
  }

  await mkdir(targetDataDirectory, { recursive: true });
  await cp(databaseSource, path.join(targetDataDirectory, "palace.sqlite"), { force: false });
  if (await exists(uploadSource)) {
    await cp(uploadSource, path.join(targetDataDirectory, "images", "uploads"), {
      recursive: true,
      force: false,
    });
  }
  return summary;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const backupDirectory = path.resolve(process.argv[2] || "");
  const targetDataDirectory = path.resolve(process.argv[3] || "restore-test");
  restoreBackup({ backupDirectory, targetDataDirectory })
    .then((summary) => console.log(`Restore prepared: ${JSON.stringify(summary)}`))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
