import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { findMemoryByIdInDatabase } from "../src/data/memory-repository.ts";

test("rejects an invalid Memory visibility at the SQLite row boundary", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-memory-row-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const now = "2026-09-20T00:00:00.000Z";

  try {
    database.exec("PRAGMA ignore_check_constraints = ON");
    database
      .prepare(
        `INSERT INTO memories
          (id, stage_id, title, story, visibility, created_at, updated_at)
         VALUES ('invalid-visibility', NULL, 'Title', 'Story', 'public', ?, ?)`,
      )
      .run(now, now);

    assert.throws(() => findMemoryByIdInDatabase(database, "invalid-visibility"), /visibility/);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
