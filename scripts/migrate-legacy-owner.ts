import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { withTransaction } from "../src/data/transaction.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { hashUserPassword } from "../src/security/user-password.ts";
import { legacyOwnedTables } from "../src/data/owner-migration.ts";
export { legacyOwnedTables } from "../src/data/owner-migration.ts";

// Fixed table names: never accept a table identifier from CLI or database content.

type OwnedTable = (typeof legacyOwnedTables)[number];
type Counts = Record<OwnedTable | "users" | "museums", number>;

export interface LegacyOwnerIdentity {
  email: string;
  password: string;
  displayName: string;
  museumName: string;
  museumSlug: string;
}

function count(database: DatabaseSync, table: string): number {
  return Number(database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
}

function readCounts(database: DatabaseSync): Counts {
  return Object.fromEntries(
    ["users", "museums", ...legacyOwnedTables].map((table) => [table, count(database, table)]),
  ) as Counts;
}

function countOrphans(database: DatabaseSync): number {
  return database.prepare("PRAGMA foreign_key_check").all().length;
}

function assertReady(database: DatabaseSync, owner: LegacyOwnerIdentity): void {
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.email) ||
    !owner.password.trim() ||
    !owner.displayName.trim() ||
    !owner.museumName.trim() ||
    !owner.museumSlug.trim()
  ) {
    throw new Error("Owner email, password, display name, Museum name and slug are required");
  }
  if (!database.prepare("SELECT 1 FROM schema_migrations WHERE version = 13").get()) {
    throw new Error("Database migration 13 is required before legacy Owner migration");
  }
  if (count(database, "users") || count(database, "museums")) {
    throw new Error("Cannot infer legacy ownership with an existing User or Museum");
  }
  for (const table of legacyOwnedTables) {
    if (database.prepare(`SELECT 1 FROM ${table} WHERE museum_id IS NOT NULL LIMIT 1`).get()) {
      throw new Error(`Cannot infer ownership for already assigned ${table} rows`);
    }
  }
  if (countOrphans(database)) throw new Error("Legacy database contains orphan foreign keys");
}

/** Mutates only the supplied database. C2 tests call this on isolated databases; no production runner is provided. */
export function migrateLegacyOwnerInDatabase(
  database: DatabaseSync,
  owner: LegacyOwnerIdentity,
): {
  email: string;
  userId: string;
  museumId: string;
} {
  return withTransaction(database, () => {
    assertReady(database, owner);
    const passwordHash = hashUserPassword(owner.password);
    const user = createUserInDatabase(database, {
      email: owner.email.trim().toLowerCase(),
      passwordHash,
      displayName: owner.displayName.trim(),
    });
    const museum = createMuseumInDatabase(database, {
      ownerId: user.id,
      name: owner.museumName.trim(),
      slug: owner.museumSlug.trim(),
    });
    for (const table of legacyOwnedTables) {
      database.prepare(`UPDATE ${table} SET museum_id = ? WHERE museum_id IS NULL`).run(museum.id);
    }
    // This Museum adopts existing files, unlike a genuinely empty newly created Museum.
    database.prepare("UPDATE museums SET storage_usage_ready=0 WHERE id=?").run(museum.id);
    if (countOrphans(database)) throw new Error("Migration produced orphan foreign keys");
    return { email: user.email, userId: user.id, museumId: museum.id };
  });
}

export function countMissingFiles(database: DatabaseSync, imageRoot: string): number {
  const keys = new Set<string>();
  for (const [table, column] of [
    ["uploaded_photos", "optimized_storage_key"],
    ["uploaded_photos", "original_storage_key"],
    ["memory_images", "storage_key"],
    ["stage_covers", "storage_key"],
  ]) {
    for (const row of database
      .prepare(`SELECT ${column} AS key FROM ${table} WHERE ${column} IS NOT NULL`)
      .all()) {
      keys.add(String(row.key));
    }
  }
  const root = path.resolve(imageRoot);
  const realRoot = existsSync(root) ? realpathSync(root) : root;
  let missing = 0;
  for (const key of keys) {
    const file = path.resolve(root, key);
    if (file === root || !file.startsWith(`${root}${path.sep}`) || !existsSync(file)) {
      missing++;
      continue;
    }
    const realFile = realpathSync(file);
    if (!realFile.startsWith(`${realRoot}${path.sep}`) || !statSync(realFile).isFile()) missing++;
  }
  return missing;
}

/** Backs up a read-only source into a private temporary copy; only that copy is migrated. */
export async function dryRunLegacyOwnerMigration(input: {
  databasePath: string;
  imageRoot: string;
  owner: LegacyOwnerIdentity;
}): Promise<{ before: Counts; after: Counts; orphanCount: number; missingFileCount: number }> {
  if (!existsSync(input.databasePath)) throw new Error("Database file does not exist");
  const temporary = mkdtempSync(path.join(tmpdir(), "memory-palace-owner-dry-run-"));
  const copyPath = path.join(temporary, "palace.sqlite");
  try {
    const source = new DatabaseSync(input.databasePath, { readOnly: true });
    try {
      await backup(source, copyPath);
    } finally {
      source.close();
    }
    const copy = new DatabaseSync(copyPath);
    try {
      copy.exec("PRAGMA foreign_keys = ON");
      const before = readCounts(copy);
      const missingFileCount = countMissingFiles(copy, input.imageRoot);
      migrateLegacyOwnerInDatabase(copy, input.owner);
      return { before, after: readCounts(copy), orphanCount: countOrphans(copy), missingFileCount };
    } finally {
      copy.close();
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [databasePath, imageRoot, email] = process.argv.slice(2);
  const password = process.env.MEMORY_PALACE_OWNER_PASSWORD;
  if (!databasePath || !imageRoot || !email || !password || process.argv.length !== 5) {
    console.error(
      "Usage: MEMORY_PALACE_OWNER_PASSWORD=... node --experimental-strip-types scripts/migrate-legacy-owner.ts <database-path> <image-root> <owner-email>",
    );
    process.exitCode = 1;
  } else {
    dryRunLegacyOwnerMigration({
      databasePath,
      imageRoot,
      owner: {
        email,
        password: password.trim(),
        displayName: "馆长",
        museumName: "人生博物馆",
        museumSlug: "legacy-owner",
      },
    })
      .then((report) => console.log(JSON.stringify(report, null, 2)))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
