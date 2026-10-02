import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { planOwnerMigration, applyOwnerMigration } from "../src/data/owner-migration.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { withTransaction } from "../src/data/transaction.ts";
import { countMissingFiles } from "./migrate-legacy-owner.ts";
import { createBackup } from "./backup.mjs";
import { restoreBackup } from "./restore-backup.mjs";

/** Existing verified User only. Dry-run touches a disposable SQLite copy, never the source. */
export async function migrateTask13Owner(options: {
  dataDirectory: string;
  ownerEmail: string;
  apply?: boolean;
  quiesced?: boolean;
  confirmEmail?: string;
  backupRoot?: string;
  configFile?: string;
}) {
  if (
    options.apply &&
    (!options.quiesced ||
      !options.backupRoot ||
      !options.configFile ||
      options.confirmEmail?.trim().toLowerCase() !== options.ownerEmail.trim().toLowerCase())
  )
    throw new Error(
      "Apply requires stopped writes, backupRoot, configFile and explicit original-owner confirmation",
    );
  const data = await realpath(options.dataDirectory);
  const databasePath = path.join(data, "palace.sqlite");
  const info = await lstat(databasePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Invalid production database path");
  // Require an existing real backup directory so a symlink cannot redirect it into live data.
  const backupRoot = options.backupRoot ? await realpath(options.backupRoot) : undefined;
  if (backupRoot && (backupRoot === data || backupRoot.startsWith(`${data}${path.sep}`)))
    throw new Error("Backup root must be outside live data");
  const db = new DatabaseSync(databasePath, { readOnly: !options.apply });
  const temporary = await mkdtemp(path.join(tmpdir(), "palace-task13-owner-"));
  let backupDirectory: string | undefined;
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
    const before = planOwnerMigration(db, options.ownerEmail);
    if (countMissingFiles(db, path.join(data, "images")))
      throw new Error("Referenced image files are missing or unsafe; no migration applied");
    const copyPath = path.join(temporary, "palace.sqlite");
    await backup(db, copyPath);
    const copy = new DatabaseSync(copyPath);
    let after;
    try {
      copy.exec("PRAGMA foreign_keys=ON");
      withTransaction(copy, () => {
        applyOwnerMigration(copy, options.ownerEmail);
        runDatabaseMigrations(copy);
      });
      after = planOwnerMigration(copy, options.ownerEmail);
    } finally {
      copy.close();
    }
    if (options.apply) {
      backupDirectory = await createBackup({
        dataDirectory: data,
        backupRoot: backupRoot!,
        configFile: options.configFile,
        quiesced: true,
      });
      // A backup is not considered usable until an isolated restore checks SQLite and every image reference.
      await restoreBackup({
        backupDirectory,
        targetDataDirectory: path.join(temporary, "restore-check"),
      });
      withTransaction(db, () => {
        if (planOwnerMigration(db, options.ownerEmail).fingerprint !== before.fingerprint)
          throw new Error("Data changed during backup; stop all application writers");
        applyOwnerMigration(db, options.ownerEmail);
        runDatabaseMigrations(db);
      });
    }
    return {
      mode: options.apply ? "applied" : "dry-run",
      userId: before.userId,
      museumId: before.museumId,
      before: before.counts,
      after: after.counts,
      adopted: before.unassigned,
      backupDirectory,
      missingFiles: 0,
    };
  } catch (error) {
    if (backupDirectory) console.error("Migration backup retained:", backupDirectory);
    throw error;
  } finally {
    db.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [dataDirectory, ownerEmail, ...flags] = process.argv.slice(2);
  const value = (name: string) =>
    flags.find((flag) => flag.startsWith(`${name}=`))?.slice(name.length + 1);
  if (
    !dataDirectory ||
    !ownerEmail ||
    flags.some(
      (flag) =>
        !["--apply", "--quiesced"].includes(flag) &&
        !["--confirm=", "--backup-root=", "--config-file="].some((prefix) =>
          flag.startsWith(prefix),
        ),
    )
  ) {
    console.error(
      "Usage: migrate-task13-owner.ts <data-directory> <original-owner-email> [--apply --quiesced --confirm=email --backup-root=directory --config-file=file]",
    );
    process.exitCode = 1;
  } else
    await migrateTask13Owner({
      dataDirectory,
      ownerEmail,
      apply: flags.includes("--apply"),
      quiesced: flags.includes("--quiesced"),
      confirmEmail: value("--confirm"),
      backupRoot: value("--backup-root"),
      configFile: value("--config-file"),
    })
      .then((report) => console.log(JSON.stringify(report, null, 2)))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : "Migration failed");
        process.exitCode = 1;
      });
}
