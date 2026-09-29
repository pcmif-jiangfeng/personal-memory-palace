import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import {
  migrateLegacyOwnerInDatabase,
  dryRunLegacyOwnerMigration,
  legacyOwnedTables,
} from "../scripts/migrate-legacy-owner.ts";

const now = "2026-09-25T00:00:00.000Z";
const owner = {
  email: "owner@example.com",
  password: "legacy-owner-password",
  displayName: "馆长",
  museumName: "人生博物馆",
  museumSlug: "legacy-owner",
};

function seedLegacyData(database: DatabaseSync): void {
  database
    .prepare(
      "INSERT INTO stages (id, title, created_at, updated_at, trashed_at) VALUES ('stage', '阶段', ?, ?, ?)",
    )
    .run(now, now, now);
  database
    .prepare(
      "INSERT INTO memories (id, title, story, created_at, updated_at, trashed_at) VALUES ('memory', '回忆', '故事', ?, ?, ?), ('related', '相关', '故事', ?, ?, NULL)",
    )
    .run(now, now, now, now, now);
  database
    .prepare(
      "INSERT INTO uploaded_photos (id, original_name, mime_type, optimized_storage_key, width, height, created_at, library_archived_at) VALUES ('photo', 'photo.jpg', 'image/jpeg', 'uploads/owner/optimized/photo.webp', 100, 100, ?, ?)",
    )
    .run(now, now);
  database
    .prepare(
      "INSERT INTO stage_covers (stage_id, storage_key) VALUES ('stage', 'uploads/owner/optimized/photo.webp')",
    )
    .run();
  database
    .prepare(
      "INSERT INTO memory_images (id, memory_id, storage_key, created_at, is_cover) VALUES ('image', 'memory', 'uploads/owner/optimized/photo.webp', ?, 1)",
    )
    .run(now);
  database
    .prepare(
      "INSERT INTO memory_relations (memory_id, related_memory_id, created_at) VALUES ('memory', 'related', ?)",
    )
    .run(now);
  database
    .prepare(
      "INSERT INTO later_notes (id, memory_id, content, created_at) VALUES ('note', 'memory', '后来', ?)",
    )
    .run(now);
  database
    .prepare(
      "INSERT INTO share_configs (id, memory_id, created_at, updated_at) VALUES ('share', 'memory', ?, ?)",
    )
    .run(now, now);
  database
    .prepare(
      "INSERT INTO photo_deletion_jobs (photo_id, optimized_storage_key, created_at) VALUES ('photo', 'uploads/owner/optimized/photo.webp', ?)",
    )
    .run(now);
  database
    .prepare(
      "INSERT INTO pending_uploads (id, storage_key, created_at) VALUES ('pending', 'uploads/owner/pending/unwritten.webp', ?)",
    )
    .run(now);
}

test("dry-run reports every owned table and never changes the source database", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "memory-palace-owner-migration-"));
  const databasePath = path.join(root, "palace.sqlite");
  const imageRoot = path.join(root, "images");
  try {
    const database = initializeDatabase(databasePath, false);
    seedLegacyData(database);
    database.close();
    const file = path.join(imageRoot, "uploads", "owner", "optimized", "photo.webp");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "image");
    const report = await dryRunLegacyOwnerMigration({ databasePath, imageRoot, owner });
    assert.equal(report.before.users, 0);
    assert.equal(report.after.users, 1);
    assert.equal(report.after.museums, 1);
    assert.equal(report.orphanCount, 0);
    assert.equal(report.missingFileCount, 0);
    for (const table of legacyOwnedTables) {
      assert.equal(report.before[table], table === "memories" ? 2 : 1, table);
      assert.equal(report.after[table], report.before[table], table);
    }
    rmSync(file);
    assert.equal(
      (await dryRunLegacyOwnerMigration({ databasePath, imageRoot, owner })).missingFileCount,
      1,
    );
    const cli = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/migrate-legacy-owner.ts",
        databasePath,
        imageRoot,
        owner.email,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, MEMORY_PALACE_OWNER_PASSWORD: owner.password },
      },
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).missingFileCount, 1);
    assert.doesNotMatch(cli.stdout, /legacy-owner-password/);
    assert.equal(existsSync(databasePath), true);
    const source = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(source.prepare("SELECT COUNT(*) AS n FROM users").get()?.n, 0);
      for (const table of legacyOwnedTables)
        assert.equal(
          source.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE museum_id IS NOT NULL`).get()?.n,
          0,
          table,
        );
    } finally {
      source.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isolated migration assigns every legacy row atomically and refuses a second owner", () => {
  const database = initializeDatabase(":memory:", false);
  try {
    seedLegacyData(database);
    const result = migrateLegacyOwnerInDatabase(database, owner);
    assert.equal(result.email, owner.email);
    assert.equal(
      database.prepare("SELECT storage_usage_ready FROM museums WHERE id=?").get(result.museumId)!
        .storage_usage_ready,
      0,
    );
    assert.notEqual(
      database.prepare("SELECT password_hash FROM users").get()?.password_hash,
      owner.password,
    );
    for (const table of legacyOwnedTables) {
      assert.equal(
        database
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE museum_id = ?`)
          .get(result.museumId)?.n,
        table === "memories" ? 2 : 1,
        table,
      );
    }
    assert.equal(
      database.prepare("SELECT trashed_at FROM memories WHERE id = 'memory'").get()?.trashed_at,
      now,
    );
    assert.equal(
      database.prepare("SELECT library_archived_at FROM uploaded_photos").get()
        ?.library_archived_at,
      now,
    );
    assert.throws(() => migrateLegacyOwnerInDatabase(database, owner), /existing User or Museum/);
  } finally {
    database.close();
  }
});

test("failed ownership assignment rolls back User, Museum and all row updates", () => {
  const database = initializeDatabase(":memory:", false);
  try {
    seedLegacyData(database);
    database.exec(
      "CREATE TEMP TRIGGER reject_pending BEFORE UPDATE ON pending_uploads BEGIN SELECT RAISE(ABORT, 'blocked'); END",
    );
    assert.throws(() => migrateLegacyOwnerInDatabase(database, owner), /blocked/);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM users").get()?.n, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM museums").get()?.n, 0);
    for (const table of legacyOwnedTables) {
      assert.equal(
        database.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE museum_id IS NOT NULL`).get()?.n,
        0,
        table,
      );
    }
  } finally {
    database.close();
  }
});

test("migration refuses ambiguous ownership", () => {
  const database = initializeDatabase(":memory:", false);
  try {
    seedLegacyData(database);
    database
      .prepare(
        "INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES ('other', 'other@example.com', 'hash', 'Other', ?, ?)",
      )
      .run(now, now);
    assert.throws(() => migrateLegacyOwnerInDatabase(database, owner), /existing User or Museum/);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM museums").get()?.n, 0);
  } finally {
    database.close();
  }
});
