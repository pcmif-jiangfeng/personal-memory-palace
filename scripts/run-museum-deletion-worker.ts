import { DatabaseSync } from "node:sqlite";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { finalizeMuseumDeletion } from "./finalize-museum-deletion.ts";

/** Explicit maintenance window only: this does not stop the web application for the operator. */
export async function runMuseumDeletionWorker(options: {
  dataDirectory: string;
  apply?: boolean;
  quiesced?: boolean;
  backupRoot?: string;
  limit?: number;
}) {
  const limit = options.limit ?? 5;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
    throw new Error("Worker limit must be 1..20");
  if (options.apply && (!options.quiesced || !options.backupRoot))
    throw new Error("Apply requires stopped writers, --quiesced and --backup-root");
  const data = await realpath(options.dataDirectory),
    file = path.join(data, "palace.sqlite");
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("Existing regular database required");
  const lockPath = path.join(data, ".museum-deletion-worker.lock");
  const lock = options.apply ? await open(lockPath, "wx", 0o600) : null;
  const results: Array<{ museumId: string; status: "planned" | "deleted" | "failed" }> = [];
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: !options.apply });
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
    const now = new Date().toISOString();
    const rows = db
      .prepare(
        `SELECT id FROM museums WHERE museum_type='shared' AND status='pending_deletion'
      AND julianday(deletion_scheduled_at)<=julianday(?)
      AND (deletion_next_attempt_at IS NULL OR julianday(deletion_next_attempt_at)<=julianday(?))
      ORDER BY deletion_scheduled_at,id LIMIT ?`,
      )
      .all(now, now, limit);
    for (const row of rows) {
      const museumId = String(row.id);
      if (!options.apply) {
        await finalizeMuseumDeletion({ dataDirectory: data, museumId });
        results.push({ museumId, status: "planned" });
        continue;
      }
      try {
        await finalizeMuseumDeletion({
          dataDirectory: data,
          museumId,
          apply: true,
          quiesced: true,
          confirm: museumId,
          backupRoot: options.backupRoot,
        });
        results.push({ museumId, status: "deleted" });
      } catch {
        results.push({ museumId, status: "failed" });
        break; // Inspect the failure before touching another palace.
      }
    }
    return { dryRun: !options.apply, results };
  } finally {
    db?.close();
    if (lock) {
      await lock.close();
      await unlink(lockPath);
    }
  }
}

if (
  import.meta.url === (process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "")
) {
  const [dataDirectory, ...flags] = process.argv.slice(2);
  const options: Parameters<typeof runMuseumDeletionWorker>[0] = { dataDirectory };
  try {
    if (!dataDirectory)
      throw new Error(
        "Usage: run-museum-deletion-worker.ts <data-directory> [--limit 1..20] [--apply --quiesced --backup-root <directory>]",
      );
    const seen = new Set<string>();
    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i];
      if (seen.has(flag)) throw new Error("Duplicate worker argument");
      seen.add(flag);
      if (flag === "--apply") options.apply = true;
      else if (flag === "--quiesced") options.quiesced = true;
      else if (flag === "--limit" || flag === "--backup-root") {
        const value = flags[++i];
        if (!value || value.startsWith("--")) throw new Error("Missing worker argument");
        if (flag === "--limit") options.limit = Number(value);
        else options.backupRoot = value;
      } else throw new Error("Unknown worker argument");
    }
    runMuseumDeletionWorker(options)
      .then((result) => {
        console.log(JSON.stringify(result, null, 2));
        if (result.results.some((row) => row.status === "failed")) process.exitCode = 1;
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : "Worker failed");
        process.exitCode = 1;
      });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid arguments");
    process.exitCode = 1;
  }
}
