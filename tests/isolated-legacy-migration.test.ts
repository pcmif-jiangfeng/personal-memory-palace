import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import sharp from "sharp";
import {
  dryRunLegacyOwnerMigration,
  legacyOwnedTables,
  migrateLegacyOwnerInDatabase,
} from "../scripts/migrate-legacy-owner.ts";
import { getDatabase, initializeDatabase } from "../src/data/database.ts";
import {
  findMemoryDetails,
  listActiveMemories,
  listStageShelfItems,
  listTrashedMemories,
  listTrashedStages,
} from "../src/data/memory-repository.ts";
import { queryWorkspacePhotoCatalog } from "../src/data/photo-repository.ts";
import {
  getSharedMemory,
  isSharedImageAccessibleInDatabase,
} from "../src/data/share-repository.ts";
import { imageStorage, resolveStoredImagePath } from "../src/storage/local-image-storage.ts";

const now = "2026-09-25T00:00:00.000Z";
const owner = {
  email: "owner@example.com",
  password: "isolated-test-password",
  displayName: "馆长",
  museumName: "人生博物馆",
  museumSlug: "owner-museum",
};
const photoKey = "uploads/owner/optimized/11111111-1111-4111-8111-111111111111.webp";
const libraryKey = "uploads/owner/optimized/22222222-2222-4222-8222-222222222222.webp";

async function verifyRenderedPages(isolatedData: string, webp: Buffer): Promise<void> {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve an HTTP port");
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const origin = `http://127.0.0.1:${address.port}`;
  const server = spawn(
    process.execPath,
    [
      path.resolve("node_modules/next/dist/bin/next"),
      "start",
      "--port",
      String(address.port),
      "--hostname",
      "127.0.0.1",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEMORY_PALACE_DATA_DIR: isolatedData,
        MEMORY_PALACE_DATASET: "owner",
        MEMORY_PALACE_OWNER_PASSWORD: owner.password,
        MEMORY_PALACE_SESSION_SECRET: "isolated-migration-test-secret-1234567890",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  server.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  server.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (server.exitCode !== null) throw new Error(`Isolated server exited: ${output}`);
      try {
        const response = await fetch(origin);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Server is still starting. */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(ready, true, `Isolated server did not start: ${output}`);
    const home = await fetch(origin);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /旧回忆/);
    const memory = await fetch(`${origin}/memories/memory-shared`);
    assert.equal(memory.status, 200);
    assert.match(await memory.text(), /旧故事/);
    const share = await fetch(`${origin}/share/legacy-share-token`);
    assert.equal(share.status, 200);
    assert.match(await share.text(), /旧回忆/);
    const media = await fetch(`${origin}/media/${photoKey}?share=legacy-share-token`);
    assert.equal(media.status, 200);
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), webp);
  } finally {
    server.kill();
    if (server.exitCode === null) {
      await Promise.race([
        new Promise<void>((resolve) => server.once("exit", () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
  }
}

function count(database: DatabaseSync, table: string): number {
  return Number(database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
}

test("an isolated legacy snapshot preserves content, shares, trash and image paths after migration", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "memory-palace-c3-"));
  const legacyData = path.join(root, "legacy");
  const isolatedData = path.join(root, "isolated");
  const previousDataDir = process.env.MEMORY_PALACE_DATA_DIR;
  const previousDataset = process.env.MEMORY_PALACE_DATASET;
  let applicationDatabase: DatabaseSync | undefined;
  try {
    mkdirSync(legacyData);
    const source = initializeDatabase(path.join(legacyData, "palace.sqlite"), false);
    try {
      source
        .prepare(
          "INSERT INTO stages (id, title, created_at, updated_at) VALUES ('stage-active', '旧展厅', ?, ?)",
        )
        .run(now, now);
      source
        .prepare(
          "INSERT INTO stages (id, title, created_at, updated_at, trashed_at) VALUES ('stage-trash', '已删除展厅', ?, ?, ?)",
        )
        .run(now, now, now);
      source
        .prepare(
          "INSERT INTO memories (id, stage_id, title, story, visibility, created_at, updated_at) VALUES ('memory-shared', 'stage-active', '旧回忆', '旧故事', 'shared', ?, ?), ('memory-related', NULL, '关联回忆', '关联故事', 'private', ?, ?)",
        )
        .run(now, now, now, now);
      source
        .prepare(
          "INSERT INTO memories (id, title, story, created_at, updated_at, trashed_at) VALUES ('memory-trash', '已删除回忆', '保留故事', ?, ?, ?)",
        )
        .run(now, now, now);
      source
        .prepare(
          "INSERT INTO uploaded_photos (id, original_name, mime_type, optimized_storage_key, width, height, created_at, used_at) VALUES ('photo-used', 'used.webp', 'image/webp', ?, 1, 1, ?, ?)",
        )
        .run(photoKey, now, now);
      source
        .prepare(
          "INSERT INTO uploaded_photos (id, original_name, mime_type, optimized_storage_key, width, height, created_at, library_archived_at) VALUES ('photo-library', 'library.webp', 'image/webp', ?, 1, 1, ?, ?)",
        )
        .run(libraryKey, now, now);
      source
        .prepare("INSERT INTO stage_covers (stage_id, storage_key) VALUES ('stage-active', ?)")
        .run(photoKey);
      source
        .prepare(
          "INSERT INTO memory_images (id, memory_id, storage_key, is_cover, created_at) VALUES ('image-used', 'memory-shared', ?, 1, ?)",
        )
        .run(photoKey, now);
      source
        .prepare(
          "INSERT INTO memory_relations (memory_id, related_memory_id, created_at) VALUES ('memory-shared', 'memory-related', ?)",
        )
        .run(now);
      source
        .prepare(
          "INSERT INTO later_notes (id, memory_id, content, created_at) VALUES ('note-old', 'memory-shared', '后来的话', ?)",
        )
        .run(now);
      source
        .prepare(
          "INSERT INTO share_configs (id, memory_id, enabled, access_mode, created_at, updated_at) VALUES ('legacy-share-token', 'memory-shared', 1, 'link', ?, ?)",
        )
        .run(now, now);
    } finally {
      source.close();
    }

    const webp = await sharp({
      create: { width: 1, height: 1, channels: 4, background: "#ffffff" },
    })
      .webp()
      .toBuffer();
    for (const key of [photoKey, libraryKey]) {
      const file = path.join(legacyData, "images", key);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, webp);
    }
    cpSync(legacyData, isolatedData, { recursive: true });
    const isolatedPath = path.join(isolatedData, "palace.sqlite");
    const imageRoot = path.join(isolatedData, "images");
    const dryRun = await dryRunLegacyOwnerMigration({
      databasePath: isolatedPath,
      imageRoot,
      owner,
    });
    assert.equal(dryRun.missingFileCount, 0);
    assert.equal(dryRun.orphanCount, 0);
    assert.equal(dryRun.before.memories, 3);
    assert.equal(dryRun.before.stages, 2);
    assert.equal(dryRun.before.uploaded_photos, 2);

    const migrated = new DatabaseSync(isolatedPath);
    let museumId: string;
    try {
      migrated.exec("PRAGMA foreign_keys = ON");
      museumId = migrateLegacyOwnerInDatabase(migrated, owner).museumId;
      for (const table of legacyOwnedTables) {
        assert.equal(count(migrated, table), dryRun.before[table], table);
        assert.equal(
          Number(
            migrated.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE museum_id = ?`).get(museumId)
              ?.n,
          ),
          dryRun.before[table],
          table,
        );
      }
      assert.equal(migrated.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      assert.equal(migrated.prepare("PRAGMA foreign_key_check").all().length, 0);
      assert.equal(
        isSharedImageAccessibleInDatabase(migrated, "legacy-share-token", photoKey),
        true,
      );
      assert.equal(count(migrated, "share_configs"), dryRun.before.share_configs);
    } finally {
      migrated.close();
    }

    process.env.MEMORY_PALACE_DATA_DIR = isolatedData;
    process.env.MEMORY_PALACE_DATASET = "owner";
    applicationDatabase = getDatabase();
    assert.equal(
      listStageShelfItems().some(
        (stage) => stage.title === "旧展厅" && stage.coverKey === photoKey,
      ),
      true,
    );
    assert.equal(listActiveMemories().length, 2);
    const pageMemory = findMemoryDetails("memory-shared");
    assert.equal(pageMemory?.story, "旧故事");
    assert.equal(pageMemory?.images[0]?.storageKey, photoKey);
    assert.equal(pageMemory?.relatedMemories[0]?.id, "memory-related");
    assert.equal(pageMemory?.laterNotes[0]?.content, "后来的话");
    assert.equal(getSharedMemory("legacy-share-token")?.id, "memory-shared");
    assert.deepEqual(
      listTrashedMemories().map((memory) => memory.id),
      ["memory-trash"],
    );
    assert.deepEqual(
      listTrashedStages().map((stage) => stage.id),
      ["stage-trash"],
    );
    assert.deepEqual(
      queryWorkspacePhotoCatalog({ source: "library" })
        .items.map((photo) => photo.id)
        .sort(),
      ["photo-library", "photo-used"],
    );
    assert.equal(imageStorage.resolve(photoKey).publicPath, `/media/${photoKey}`);
    assert.deepEqual(readFileSync(resolveStoredImagePath(photoKey)), webp);
    assert.deepEqual(readFileSync(resolveStoredImagePath(libraryKey)), webp);
    if (process.env.VERIFY_ISOLATED_PAGE_HTTP === "1") {
      await verifyRenderedPages(isolatedData, webp);
    }
  } finally {
    applicationDatabase?.close();
    if (previousDataDir === undefined) delete process.env.MEMORY_PALACE_DATA_DIR;
    else process.env.MEMORY_PALACE_DATA_DIR = previousDataDir;
    if (previousDataset === undefined) delete process.env.MEMORY_PALACE_DATASET;
    else process.env.MEMORY_PALACE_DATASET = previousDataset;
    rmSync(root, { recursive: true, force: true });
  }
});
