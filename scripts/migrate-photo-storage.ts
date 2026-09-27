import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { createBackup } from "./backup.mjs";
import { isMuseumPhotoKey, photoUuidPattern } from "../src/storage/photo-storage-key.ts";

interface PhotoMove {
  id: string;
  museumId: string;
  oldKey: string;
  newKey: string;
  oldOriginal: string | null;
  newOriginal: string | null;
}
const legacyOptimized = new RegExp(`^uploads/(owner|demo)/optimized/${photoUuidPattern}\\.webp$`);
const legacyOriginal = new RegExp(
  `^uploads/(owner|demo)/original/${photoUuidPattern}\\.(jpg|jpeg|png|webp)$`,
);
const museumIdPattern = new RegExp(`^${photoUuidPattern}$`);

function planMigration(db: DatabaseSync): PhotoMove[] {
  if (
    db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok" ||
    db.prepare("PRAGMA foreign_key_check").all().length
  )
    throw new Error("Database integrity check failed");
  if (
    db.prepare("SELECT 1 FROM pending_uploads LIMIT 1").get() ||
    db.prepare("SELECT 1 FROM photo_deletion_jobs LIMIT 1").get()
  )
    throw new Error("Recover unfinished file operations before migration");
  const moves: PhotoMove[] = [];
  for (const row of db
    .prepare(
      "SELECT p.*,m.status AS museum_status FROM uploaded_photos p LEFT JOIN museums m ON m.id=p.museum_id ORDER BY p.id",
    )
    .all()) {
    const key = String(row.optimized_storage_key);
    const museumId = String(row.museum_id);
    if (!museumIdPattern.test(museumId) || row.museum_status !== "active")
      throw new Error("Photos need active Museum ownership before migration");
    if (isMuseumPhotoKey(key, museumId)) {
      if (
        row.original_storage_key !== null &&
        !new RegExp(
          `^uploads/museums/${museumId}/original/${photoUuidPattern}\\.(jpg|jpeg|png|webp)$`,
        ).test(String(row.original_storage_key))
      ) {
        throw new Error("Museum photo has an invalid original storage binding");
      }
      continue;
    }
    if (!legacyOptimized.test(key)) throw new Error("Unsupported or unsafe photo storage key");
    const original = row.original_storage_key === null ? null : String(row.original_storage_key);
    if (
      original !== null &&
      (!legacyOriginal.test(original) ||
        !original.startsWith(`${key.replace("/optimized/", "/original/").slice(0, -5)}.`))
    )
      throw new Error("Unsupported original storage key");
    const foreignImage = db
      .prepare(
        "SELECT 1 FROM memory_images i JOIN memories m ON m.id=i.memory_id WHERE i.storage_key=? AND (i.museum_id IS NOT ? OR m.museum_id IS NOT ?)",
      )
      .get(key, museumId, museumId);
    const foreignCover = db
      .prepare(
        "SELECT 1 FROM stage_covers c JOIN stages s ON s.id=c.stage_id WHERE c.storage_key=? AND (c.museum_id IS NOT ? OR s.museum_id IS NOT ?)",
      )
      .get(key, museumId, museumId);
    if (foreignImage || foreignCover) throw new Error("Invalid cross-Museum photo binding");
    moves.push({
      id: String(row.id),
      museumId,
      oldKey: key,
      newKey: key.replace(/^uploads\/(owner|demo)\//, `uploads/museums/${museumId}/`),
      oldOriginal: original,
      newOriginal:
        original?.replace(/^uploads\/(owner|demo)\//, `uploads/museums/${museumId}/`) ?? null,
    });
  }
  for (const table of ["memory_images", "stage_covers"]) {
    if (
      db
        .prepare(
          `SELECT 1 FROM ${table} r WHERE r.storage_key LIKE 'uploads/%' AND NOT EXISTS (SELECT 1 FROM uploaded_photos p WHERE p.optimized_storage_key=r.storage_key) LIMIT 1`,
        )
        .get()
    )
      throw new Error("Photo binding has no uploaded photo record");
  }
  return moves;
}

async function safeFile(root: string, key: string, createParents = false) {
  // Keys are validated first; symlink ancestors must not redirect copies outside the image root.
  const parts = key.split("/");
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (index < parts.length - 1 && createParents) {
        await mkdir(current);
        info = await lstat(current);
      } else if (createParents) return current;
      else throw error;
    }
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile()))
      throw new Error("Unsafe photo filesystem path");
  }
  return current;
}

async function digest(file: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}

export async function migratePhotoStorage(options: {
  dataDirectory: string;
  apply?: boolean;
  quiesced?: boolean;
  backupRoot?: string;
}) {
  if (options.apply && (!options.quiesced || !options.backupRoot))
    throw new Error("Apply requires quiesced confirmation and backupRoot");
  const data = await realpath(options.dataDirectory);
  const backupRoot = options.backupRoot ? path.resolve(options.backupRoot) : undefined;
  if (backupRoot && (backupRoot === data || backupRoot.startsWith(`${data}${path.sep}`)))
    throw new Error("Backup root must be outside the data directory");
  const databasePath = path.join(data, "palace.sqlite");
  const databaseInfo = await lstat(databasePath);
  if (databaseInfo.isSymbolicLink() || !databaseInfo.isFile())
    throw new Error("Invalid database path");
  const db = new DatabaseSync(databasePath, { readOnly: !options.apply });
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
  try {
    const moves = planMigration(db);
    if (moves.length === 0)
      return { planned: 0, migrated: 0, backupDirectory: undefined as string | undefined };
    const images = await realpath(path.join(data, "images"));
    for (const move of moves) {
      await safeFile(images, move.oldKey);
      if (move.oldOriginal) await safeFile(images, move.oldOriginal);
    }
    if (!options.apply || moves.length === 0)
      return {
        planned: moves.length,
        migrated: 0,
        backupDirectory: undefined as string | undefined,
      };
    const backupDirectory = await createBackup({
      dataDirectory: data,
      backupRoot: backupRoot!,
      quiesced: true,
    });
    db.exec("BEGIN IMMEDIATE");
    try {
      if (JSON.stringify(planMigration(db)) !== JSON.stringify(moves))
        throw new Error("Photo records changed during backup; stop application writes");
      for (const move of moves) {
        for (const [oldKey, newKey] of [
          [move.oldKey, move.newKey],
          [move.oldOriginal, move.newOriginal],
        ]) {
          if (!oldKey || !newKey) continue;
          const source = await safeFile(images, oldKey);
          const target = await safeFile(images, newKey, true);
          try {
            await copyFile(source, target, constants.COPYFILE_EXCL);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          }
          if ((await digest(source)) !== (await digest(target)))
            throw new Error("Photo destination conflict; no database references were changed");
        }
      }
      for (const move of moves) {
        db.prepare(
          "UPDATE uploaded_photos SET optimized_storage_key=?,original_storage_key=? WHERE id=? AND museum_id=?",
        ).run(move.newKey, move.newOriginal, move.id, move.museumId);
        db.prepare(
          "UPDATE memory_images SET storage_key=? WHERE storage_key=? AND museum_id=?",
        ).run(move.newKey, move.oldKey, move.museumId);
        db.prepare("UPDATE stage_covers SET storage_key=? WHERE storage_key=? AND museum_id=?").run(
          move.newKey,
          move.oldKey,
          move.museumId,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { planned: moves.length, migrated: moves.length, backupDirectory };
  } finally {
    db.close();
  }
}

if (
  import.meta.url === (process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "")
) {
  const [dataDirectory, backupRoot] = process.argv.slice(2);
  if (!dataDirectory) {
    console.error(
      "Usage: migrate-photo-storage.ts <data-directory> [backup-root] [--apply --quiesced]",
    );
    process.exitCode = 1;
  } else
    migratePhotoStorage({
      dataDirectory,
      backupRoot: backupRoot?.startsWith("--") ? undefined : backupRoot,
      apply: process.argv.includes("--apply"),
      quiesced: process.argv.includes("--quiesced"),
    })
      .then((result) => console.log(JSON.stringify(result)))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
}
