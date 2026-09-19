import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { applyTrashBatchInDatabase } from "../src/data/management-repository.ts";

function createFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-trash-batch-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const now = "2026-09-19T00:00:00.000Z";
  for (const id of ["stage-1", "stage-2"]) {
    database
      .prepare(
        `INSERT INTO stages
         (id, title, description, created_at, updated_at, trashed_at)
         VALUES (?, ?, '', ?, ?, ?)`,
      )
      .run(id, id, now, now, now);
  }
  for (const id of ["memory-1", "memory-2"]) {
    database
      .prepare(
        `INSERT INTO memories
         (id, stage_id, title, story, visibility, created_at, updated_at, trashed_at)
         VALUES (?, NULL, ?, 'Story', 'private', ?, ?, ?)`,
      )
      .run(id, id, now, now, now);
  }
  return { directory, database };
}

test("Memory and Stage batch restore stay isolated", () => {
  const { directory, database } = createFixture();
  try {
    assert.deepEqual(
      applyTrashBatchInDatabase(database, "memory", "restore", ["memory-1", "memory-2"]),
      { succeededIds: ["memory-1", "memory-2"], failures: [] },
    );
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM memories WHERE trashed_at IS NULL")
          .get() as { count: number }
      ).count,
      2,
    );
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM stages WHERE trashed_at IS NOT NULL")
          .get() as { count: number }
      ).count,
      2,
    );

    assert.deepEqual(
      applyTrashBatchInDatabase(database, "stage", "restore", ["stage-1", "stage-2"]),
      { succeededIds: ["stage-1", "stage-2"], failures: [] },
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Memory and Stage batch permanent deletion reuse their own single-item semantics", () => {
  const { directory, database } = createFixture();
  try {
    assert.deepEqual(
      applyTrashBatchInDatabase(database, "memory", "permanent", ["memory-1", "memory-2"]),
      { succeededIds: ["memory-1", "memory-2"], failures: [] },
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM memories").get() as { count: number }).count,
      0,
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM stages").get() as { count: number }).count,
      2,
    );

    assert.deepEqual(
      applyTrashBatchInDatabase(database, "stage", "permanent", ["stage-1", "stage-2"]),
      { succeededIds: ["stage-1", "stage-2"], failures: [] },
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM stages").get() as { count: number }).count,
      0,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
