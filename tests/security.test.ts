import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { isSharedImageAccessibleInDatabase } from "../src/data/share-repository.ts";
import { withTransaction } from "../src/data/transaction.ts";
import { consumeRateLimit, resetRateLimitsForTests } from "../src/security/rate-limit.ts";

test("rate limiter blocks attempts after the configured threshold and resets by window", () => {
  resetRateLimitsForTests();
  assert.equal(consumeRateLimit("login:test", { limit: 2, windowMs: 1_000 }, 1_000).allowed, true);
  assert.equal(consumeRateLimit("login:test", { limit: 2, windowMs: 1_000 }, 1_100).allowed, true);
  assert.equal(consumeRateLimit("login:test", { limit: 2, windowMs: 1_000 }, 1_200).allowed, false);
  assert.equal(consumeRateLimit("login:test", { limit: 2, windowMs: 1_000 }, 2_001).allowed, true);
});

test("shared media authorization is scoped to the shared memory and active share", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-media-auth-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const now = new Date().toISOString();

  try {
    database
      .prepare(
        `INSERT INTO memories
      (id, stage_id, title, story, visibility, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?, ?, ?)`,
      )
      .run("shared-memory", "共享记忆", "故事", "shared", now, now);
    database
      .prepare(
        `INSERT INTO memories
      (id, stage_id, title, story, visibility, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?, ?, ?)`,
      )
      .run("private-memory", "私人记忆", "故事", "private", now, now);
    database
      .prepare(
        `INSERT INTO memory_images
      (id, memory_id, storage_key, alt_text, sort_order, is_cover, created_at)
      VALUES (?, ?, ?, '', 0, 1, ?)`,
      )
      .run("shared-image", "shared-memory", "uploads/shared.webp", now);
    database
      .prepare(
        `INSERT INTO memory_images
      (id, memory_id, storage_key, alt_text, sort_order, is_cover, created_at)
      VALUES (?, ?, ?, '', 0, 1, ?)`,
      )
      .run("private-image", "private-memory", "uploads/private.webp", now);
    database
      .prepare(
        `INSERT INTO share_configs
      (id, memory_id, enabled, access_mode, password_hash, created_at, updated_at)
      VALUES (?, ?, 1, 'link', NULL, ?, ?)`,
      )
      .run("share-token", "shared-memory", now, now);

    assert.equal(
      isSharedImageAccessibleInDatabase(database, "share-token", "uploads/shared.webp"),
      true,
    );
    assert.equal(
      isSharedImageAccessibleInDatabase(database, "share-token", "uploads/private.webp"),
      false,
    );

    database.prepare("UPDATE share_configs SET enabled = 0 WHERE id = ?").run("share-token");
    assert.equal(
      isSharedImageAccessibleInDatabase(database, "share-token", "uploads/shared.webp"),
      false,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("transaction helper rolls back partial writes", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-transaction-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const now = new Date().toISOString();

  try {
    assert.throws(
      () =>
        withTransaction(database, () => {
          database
            .prepare(
              "INSERT INTO stages (id, title, description, created_at, updated_at) VALUES (?, ?, '', ?, ?)",
            )
            .run("rolled-back-stage", "不会保留", now, now);
          throw new Error("EXPECTED_FAILURE");
        }),
      /EXPECTED_FAILURE/,
    );
    const count = database.prepare("SELECT COUNT(*) AS count FROM stages").get() as {
      count: number;
    };
    assert.equal(count.count, 0);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
