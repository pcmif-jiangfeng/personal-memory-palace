import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { createBackup } from "./backup.mjs";
import { restoreBackup } from "./restore-backup.mjs";
import { permanentlyDeleteMuseum } from "../src/application/permanent-museum-deletion.ts";
import { planMuseumPermanentDeletion } from "../src/data/museum-permanent-deletion.ts";
import { inspectMuseumStorage } from "../src/storage/museum-storage-cleanup.ts";

async function fileHash(file: string) {
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("Unsafe backup file");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function uploadFingerprint(directory: string) {
  const hash = createHash("sha256");
  async function walk(relative: string) {
    const target = path.join(directory, relative);
    let info;
    try {
      info = await lstat(target);
    } catch (error) {
      if (!relative && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error("Symlinks are not allowed in verified backups");
    if (info.isDirectory()) {
      for (const name of (await readdir(target)).sort()) await walk(path.join(relative, name));
    } else if (info.isFile())
      hash.update(JSON.stringify([relative, info.size, await fileHash(target)]));
    else throw new Error("Unsupported backup entry");
  }
  await walk("");
  return hash.digest("hex");
}

function databaseFingerprint(db: DatabaseSync) {
  const hash = createHash("sha256");
  for (const row of db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
    .all()) {
    const name = String(row.name);
    // Quote metadata-derived identifiers; never interpolate raw names from a database file.
    const quoted = `"${name.replaceAll('"', '""')}"`;
    hash.update(name);
    for (const record of db.prepare(`SELECT * FROM ${quoted} ORDER BY rowid`).iterate())
      hash.update(JSON.stringify(record));
  }
  return hash.digest("hex");
}

function requireExternalBackupRoot(data: string, candidate: string) {
  const relative = path.relative(data, candidate);
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  )
    throw new Error("Backup root must be outside the data directory");
}

async function resolvePendingDirectory(candidate: string): Promise<string> {
  // Resolve the existing parent before mkdir: Windows short aliases and symlink parents can hide containment.
  let parent = candidate;
  const missing: string[] = [];
  while (true) {
    try {
      return path.join(await realpath(parent), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const next = path.dirname(parent);
      if (next === parent) throw error;
      missing.unshift(path.basename(parent));
      parent = next;
    }
  }
}

export async function finalizeMuseumDeletion(options: {
  dataDirectory: string;
  museumId: string;
  apply?: boolean;
  quiesced?: boolean;
  confirm?: string;
  backupRoot?: string;
}) {
  if (
    options.apply &&
    (!options.quiesced || options.confirm !== options.museumId || !options.backupRoot)
  )
    throw new Error(
      "Apply requires --quiesced, --confirm <museum-id> and --backup-root <directory>",
    );
  const data = await realpath(options.dataDirectory);
  const databasePath = path.join(data, "palace.sqlite");
  const info = await lstat(databasePath);
  if (info.isSymbolicLink() || !info.isFile())
    throw new Error("Existing regular Museum database required");
  const images = path.join(data, "images");
  const lockPath = path.join(data, ".museum-permanent-delete.lock");
  const lock = options.apply ? await open(lockPath, "wx", 0o600) : null;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(databasePath, { readOnly: !options.apply });
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
    const initial = planMuseumPermanentDeletion(db, options.museumId);
    const storage = await inspectMuseumStorage(images, options.museumId);
    if (!options.apply)
      return { dryRun: true, ...initial, files: storage.files, bytes: storage.bytes };
    if (
      !db
        .prepare(
          "SELECT 1 FROM sqlite_schema WHERE name='museum_permanent_deletion_jobs' AND type='table'",
        )
        .get()
    )
      throw new Error("Deploy migration 26 before running permanent deletion");
    const backupRootCandidate = await resolvePendingDirectory(path.resolve(options.backupRoot!));
    requireExternalBackupRoot(data, backupRootCandidate);
    await mkdir(backupRootCandidate, { recursive: true, mode: 0o700 });
    const backupRoot = await realpath(backupRootCandidate);
    requireExternalBackupRoot(data, backupRoot);
    const database = db;
    const result = await permanentlyDeleteMuseum(database, images, options.museumId, {
      quiesced: true,
      backup: {
        async create() {
          // Reject symlinks across the complete upload tree before the existing backup copier follows any path.
          await uploadFingerprint(path.join(images, "uploads"));
          // Keep paths below Windows SQLite's path limit; the UUID makes each backup operation unique.
          const operation = path.join(backupRoot, `delete-${randomUUID()}`);
          await mkdir(operation, { mode: 0o700 });
          return createBackup({ dataDirectory: data, backupRoot: operation, quiesced: true });
        },
        async verify(directory) {
          const backup = await realpath(directory);
          const relative = path.relative(backupRoot, backup);
          if (
            !relative ||
            relative === ".." ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative)
          )
            throw new Error("Original backup must remain inside the configured backup root");
          const databaseHash = await fileHash(path.join(backup, "database", "palace.sqlite"));
          const photosHash = await uploadFingerprint(path.join(backup, "uploads"));
          const restoreDirectory = path.join(backupRoot, `.verify-${randomUUID()}`);
          await mkdir(restoreDirectory, { mode: 0o700 });
          try {
            await restoreBackup({ backupDirectory: backup, targetDataDirectory: restoreDirectory });
            if (
              (await fileHash(path.join(restoreDirectory, "palace.sqlite"))) !== databaseHash ||
              (await uploadFingerprint(path.join(restoreDirectory, "images", "uploads"))) !==
                photosHash
            )
              throw new Error("Restored backup fingerprint mismatch");
            const restored = new DatabaseSync(path.join(restoreDirectory, "palace.sqlite"), {
              readOnly: true,
            });
            try {
              const restoredPlan = planMuseumPermanentDeletion(restored, options.museumId);
              if (
                restoredPlan.version !== initial.version ||
                restoredPlan.deletionScheduledAt !== initial.deletionScheduledAt
              )
                throw new Error("Backup belongs to a different deletion cycle");
              if (
                !initial.resuming &&
                (databaseFingerprint(restored) !== databaseFingerprint(database) ||
                  (await uploadFingerprint(path.join(images, "uploads"))) !== photosHash)
              )
                throw new Error("Data changed during backup; stop all writers");
            } finally {
              restored.close();
            }
          } finally {
            // This fresh UUID directory was created by this invocation under the verified backup root.
            await rm(restoreDirectory, { recursive: true, force: true, maxRetries: 3 });
          }
          return createHash("sha256").update(databaseHash).update(photosHash).digest("hex");
        },
      },
    });
    if (
      database.prepare("PRAGMA foreign_key_check").all().length ||
      database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
    )
      throw new Error("Post-deletion database verification failed");
    return { ...result, verified: true };
  } finally {
    db?.close();
    if (lock) {
      await lock.close();
      await unlink(lockPath);
    }
  }
}

function parseArguments(args: string[]) {
  const [dataDirectory, museumId, ...flags] = args;
  if (!dataDirectory || !museumId)
    throw new Error(
      "Usage: finalize-museum-deletion.ts <data-directory> <museum-id> [--apply --quiesced --confirm <museum-id> --backup-root <directory>]",
    );
  const options: Parameters<typeof finalizeMuseumDeletion>[0] = { dataDirectory, museumId };
  const seen = new Set<string>();
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (seen.has(flag)) throw new Error("Duplicate deletion argument");
    seen.add(flag);
    if (flag === "--apply") options.apply = true;
    else if (flag === "--quiesced") options.quiesced = true;
    else if (flag === "--confirm" || flag === "--backup-root") {
      const value = flags[++index];
      if (!value || value.startsWith("--")) throw new Error("Missing deletion argument value");
      if (flag === "--confirm") options.confirm = value;
      else options.backupRoot = value;
    } else throw new Error("Unknown deletion argument");
  }
  return options;
}

if (
  import.meta.url === (process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "")
) {
  try {
    const options = parseArguments(process.argv.slice(2));
    finalizeMuseumDeletion(options)
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : "Permanent deletion failed");
        process.exitCode = 1;
      });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid deletion arguments");
    process.exitCode = 1;
  }
}
