import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
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

async function countFiles(directory) {
  if (!(await exists(directory))) return 0;
  const entries = await readdir(directory, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    count += entry.isDirectory() ? await countFiles(entryPath) : 1;
  }
  return count;
}

function timestamp(now) {
  return now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

export async function createBackup({
  dataDirectory,
  backupRoot,
  now = new Date(),
  applicationVersion = process.env.MEMORY_PALACE_APP_VERSION || "unknown",
}) {
  const databasePath = path.join(dataDirectory, "palace.sqlite");
  const uploadSource = path.join(dataDirectory, "images", "uploads", "owner");
  if (!(await exists(databasePath))) throw new Error(`Database not found: ${databasePath}`);

  await mkdir(backupRoot, { recursive: true });
  const name = `backup-${timestamp(now)}`;
  const destination = path.join(backupRoot, name);
  if (await exists(destination)) throw new Error(`Backup already exists: ${destination}`);
  const temporary = path.join(backupRoot, `.${name}-${randomUUID()}.partial`);

  try {
    const databaseDestination = path.join(temporary, "database", "palace.sqlite");
    const uploadDestination = path.join(temporary, "uploads", "owner");
    await mkdir(path.dirname(databaseDestination), { recursive: true });

    const sourceDatabase = new DatabaseSync(databasePath, { readOnly: true });
    try {
      await backup(sourceDatabase, databaseDestination);
    } finally {
      sourceDatabase.close();
    }

    if (await exists(uploadSource)) {
      await cp(uploadSource, uploadDestination, { recursive: true, force: false });
    } else {
      await mkdir(uploadDestination, { recursive: true });
    }

    const verifiedDatabase = new DatabaseSync(databaseDestination, { readOnly: true });
    try {
      const result = verifiedDatabase.prepare("PRAGMA integrity_check").get();
      if (result.integrity_check !== "ok") throw new Error("SQLite integrity check failed");
    } finally {
      verifiedDatabase.close();
    }

    const uploadFileCount = await countFiles(uploadDestination);
    const manifest = [
      `backup_time=${now.toISOString()}`,
      `application_version=${applicationVersion}`,
      "database_filename=palace.sqlite",
      `upload_file_count=${uploadFileCount}`,
      `source_database=${databasePath}`,
      `source_uploads=${uploadSource}`,
      "application_writes_stopped=true",
      "",
    ].join("\n");
    await writeFile(path.join(temporary, "manifest.txt"), manifest, "utf8");
    await rename(temporary, destination);
    return destination;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const dataDirectory = path.resolve(
    process.argv[2] || process.env.MEMORY_PALACE_DATA_DIR || "data",
  );
  const backupRoot = path.resolve(process.argv[3] || "backups");
  createBackup({ dataDirectory, backupRoot })
    .then((destination) => console.log(`Backup created: ${destination}`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
