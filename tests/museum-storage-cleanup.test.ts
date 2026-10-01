import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  inspectMuseumStorage,
  removeMuseumStorage,
} from "../src/storage/museum-storage-cleanup.ts";

test("J6 removes only one Museum namespace, including unreferenced and original files", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "palace-j6-storage-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const imageRoot = path.join(root, "images");
  const id = randomUUID();
  const other = randomUUID();
  for (const museumId of [id, other]) {
    const directory = path.join(imageRoot, "uploads", "museums", museumId, "original");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "orphan.jpg"), "photo-bytes");
  }
  assert.equal((await inspectMuseumStorage(imageRoot, id)).files, 1);
  await removeMuseumStorage(imageRoot, id);
  assert.equal((await inspectMuseumStorage(imageRoot, id)).exists, false);
  assert.equal(
    await readFile(
      path.join(imageRoot, "uploads", "museums", other, "original", "orphan.jpg"),
      "utf8",
    ),
    "photo-bytes",
  );
  await removeMuseumStorage(imageRoot, id); // Retry after files were already removed.
  await assert.rejects(() => removeMuseumStorage(imageRoot, ".."), /Invalid Museum/);
});

test("J6 refuses symlink/junction ancestors and never deletes a redirected Museum", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "palace-j6-symlink-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const imageRoot = path.join(root, "images");
  const outside = path.join(root, "outside");
  const id = randomUUID();
  await mkdir(path.join(imageRoot, "uploads", "museums"), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(outside, "keep.txt"), "KEEP");
  await symlink(
    outside,
    path.join(imageRoot, "uploads", "museums", id),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(() => inspectMuseumStorage(imageRoot, id), /Unsafe Museum storage/);
  await assert.rejects(() => removeMuseumStorage(imageRoot, id), /Unsafe Museum storage/);
  assert.equal(await readFile(path.join(outside, "keep.txt"), "utf8"), "KEEP");
});
