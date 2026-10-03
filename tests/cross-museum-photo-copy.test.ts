import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { museumPhotoStorageKey } from "../src/storage/photo-storage-key.ts";
import { copyPhotoToMuseum } from "../src/application/cross-museum-photo-copy.ts";
import { recoverPendingUploads } from "../src/data/photo-deletion-service.ts";
import { parseMuseumCopyTarget } from "../src/http/museum-copy.ts";
import { ApiError } from "../src/http/errors.ts";

function fixture(t: TestContext, originals = true) {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  const users = ["source", "target", "member"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "fixture-hash",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const museums = users.slice(0, 2).map((user) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      name: user.displayName,
      slug: user.displayName,
      storageQuotaBytes: 100000,
    }),
  );
  for (const museum of museums)
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'created','updated')",
    ).run(museum.id, users[2].id);
  const optimized = museumPhotoStorageKey(museums[0].id);
  const original = originals
    ? optimized.replace("/optimized/", "/original/").replace(/\.webp$/, ".jpg")
    : null;
  db.prepare(
    `INSERT INTO uploaded_photos
    (id,museum_id,original_name,mime_type,optimized_storage_key,original_storage_key,width,height,created_at)
    VALUES ('source-photo',?,'照片.jpg','image/jpeg',?,?,2,2,'now')`,
  ).run(museums[0].id, optimized, original);
  const files = new Map([[optimized, Buffer.from("optimized")]]);
  if (original) files.set(original, Buffer.from("original-photo"));
  const storage = {
    size: async (key: string) => {
      if (!files.has(key)) throw new Error("Missing fixture file");
      return files.get(key)!.length;
    },
    copy: async (from: string, to: string) => {
      files.set(to, Buffer.from(files.get(from)!));
    },
    remove: async (keys: Array<string | null>) => {
      for (const key of keys) if (key) files.delete(key);
    },
  };
  const scope = { userId: users[2].id, museumId: museums[0].id };
  const sourceRow = () => db.prepare("SELECT * FROM uploaded_photos WHERE id='source-photo'").get();
  return { db, users, museums, scope, files, storage, optimized, original, sourceRow };
}

const errorCode = (code: string) => (error: unknown) =>
  error instanceof ApiError && error.code === code;

test("K1 copies optimized and original assets with fresh keys and Photo, charges target only and leaves source untouched", async (t) => {
  const f = fixture(t);
  const source = f.sourceRow();
  const copied = await copyPhotoToMuseum(f.db, f.scope, "source-photo", f.museums[1].id, f.storage);
  assert.notEqual(copied.id, "source-photo");
  assert.notEqual(copied.optimizedStorageKey, f.optimized);
  assert.ok(copied.originalStorageKey);
  assert.notEqual(copied.originalStorageKey, f.original);
  for (const key of [copied.optimizedStorageKey, copied.originalStorageKey])
    assert.ok(key!.startsWith(`uploads/museums/${f.museums[1].id}/`));
  assert.deepEqual(f.files.get(copied.optimizedStorageKey), f.files.get(f.optimized));
  assert.deepEqual(f.files.get(copied.originalStorageKey!), f.files.get(f.original!));
  assert.equal(copied.usedAt, null);
  assert.deepEqual(f.sourceRow(), source);
  assert.equal(
    f.db.prepare("SELECT storage_used_bytes FROM museums WHERE id=?").get(f.museums[1].id)!
      .storage_used_bytes,
    f.files.get(f.optimized)!.length + f.files.get(f.original!)!.length,
  );
  assert.equal(
    f.db.prepare("SELECT storage_used_bytes FROM museums WHERE id=?").get(f.scope.museumId)!
      .storage_used_bytes,
    0,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM pending_uploads").get()!.n, 0);
  const audit = f.db.prepare("SELECT * FROM audit_logs WHERE action='photo.copy'").get()!;
  assert.equal(audit.museum_id, f.museums[1].id);
  assert.equal(audit.actor_user_id, f.scope.userId);
});

test("K1 rejects foreign photo IDs, inaccessible and pending Museums, same-Museum targets and unverified actors before writes", async (t) => {
  const f = fixture(t);
  const copy = (scope = f.scope, id = "source-photo", target = f.museums[1].id) =>
    copyPhotoToMuseum(f.db, scope, id, target, f.storage);
  await assert.rejects(copy(f.scope, "foreign"), errorCode("PHOTO_NOT_FOUND"));
  await assert.rejects(
    copy(f.scope, "source-photo", f.scope.museumId),
    errorCode("COPY_TARGET_MUST_DIFFER"),
  );
  f.db
    .prepare("UPDATE museum_memberships SET status='revoked' WHERE museum_id=?")
    .run(f.museums[1].id);
  await assert.rejects(copy(), errorCode("MUSEUM_NOT_FOUND"));
  f.db.exec("UPDATE museum_memberships SET status='active'");
  f.db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(f.museums[1].id);
  await assert.rejects(copy(), errorCode("MUSEUM_NOT_FOUND"));
  f.db.exec("UPDATE museums SET status='active'");
  f.db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(f.scope.userId);
  await assert.rejects(copy(), errorCode("EMAIL_VERIFICATION_REQUIRED"));
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM uploaded_photos").get()!.n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM pending_uploads").get()!.n, 0);
  assert.equal(f.files.size, 2);
});

test("K1 quota covers combined assets and rolls back all reservations before any files are copied", async (t) => {
  const f = fixture(t);
  f.db
    .prepare(
      "UPDATE users SET storage_quota_bytes=? WHERE id=(SELECT owner_id FROM museums WHERE id=?)",
    )
    .run(f.files.get(f.optimized)!.length, f.museums[1].id);
  await assert.rejects(
    copyPhotoToMuseum(f.db, f.scope, "source-photo", f.museums[1].id, f.storage),
    errorCode("STORAGE_QUOTA_EXCEEDED"),
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM photo_asset_usage").get()!.n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM pending_uploads").get()!.n, 0);
  assert.equal(f.files.size, 2);
});

test("K1 revocation during asynchronous saving prevents commit and leaves recoverable target-only journals", async (t) => {
  const f = fixture(t);
  const source = f.sourceRow();
  await assert.rejects(
    copyPhotoToMuseum(f.db, f.scope, "source-photo", f.museums[1].id, {
      ...f.storage,
      copy: async (from, to) => {
        await f.storage.copy(from, to);
        f.db
          .prepare("UPDATE museum_memberships SET status='revoked' WHERE museum_id=?")
          .run(f.scope.museumId);
      },
    }),
    errorCode("MUSEUM_NOT_FOUND"),
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM uploaded_photos").get()!.n, 1);
  assert.deepEqual(f.sourceRow(), source);
  assert.equal((await recoverPendingUploads(f.db, f.storage)).recovered, 2);
  assert.equal(f.files.size, 2);
  assert.equal(
    f.db.prepare("SELECT storage_used_bytes FROM museums WHERE id=?").get(f.museums[1].id)!
      .storage_used_bytes,
    0,
  );
});

test("K1 audit failure rolls back the copied Photo and preserves file recovery records", async (t) => {
  const f = fixture(t, false);
  f.db.exec(
    "CREATE TRIGGER fail_copy_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failure'); END",
  );
  await assert.rejects(
    copyPhotoToMuseum(f.db, f.scope, "source-photo", f.museums[1].id, f.storage),
    /audit failure/,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM uploaded_photos").get()!.n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM pending_uploads").get()!.n, 1);
  assert.equal((await recoverPendingUploads(f.db, f.storage)).recovered, 1);
  assert.equal(f.files.size, 1);
});

test("K1 physical copies survive source file deletion and use independent filesystem objects", async (t) => {
  const f = fixture(t, false);
  const directory = await mkdtemp(path.join(tmpdir(), "palace-k1-copy-"));
  const oldData = process.env.MEMORY_PALACE_DATA_DIR;
  process.env.MEMORY_PALACE_DATA_DIR = directory;
  t.after(async () => {
    if (oldData === undefined) delete process.env.MEMORY_PALACE_DATA_DIR;
    else process.env.MEMORY_PALACE_DATA_DIR = oldData;
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const sourcePath = path.join(directory, "images", f.optimized);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ffffff" } })
    .webp()
    .toBuffer();
  await writeFile(sourcePath, bytes);
  const copied = await copyPhotoToMuseum(f.db, f.scope, "source-photo", f.museums[1].id);
  const targetPath = path.join(directory, "images", copied.optimizedStorageKey);
  assert.deepEqual(await readFile(targetPath), bytes);
  const [sourceInfo, targetInfo] = await Promise.all([stat(sourcePath), stat(targetPath)]);
  if (sourceInfo.ino !== 0) assert.notEqual(sourceInfo.ino, targetInfo.ino);
  await rm(sourcePath);
  assert.deepEqual(await readFile(targetPath), bytes);
});

test("K1 request allows only a valid target Museum, rejecting forged actors and storage paths", async () => {
  const request = (value: unknown) =>
    new Request("http://localhost/api/photos/photo/copy", {
      method: "POST",
      body: JSON.stringify(value),
    });
  assert.equal(await parseMuseumCopyTarget(request({ targetMuseumId: "museum-1" })), "museum-1");
  for (const value of [
    {},
    { targetMuseumId: "../other" },
    { targetMuseumId: 1 },
    { targetMuseumId: "museum-1", userId: "owner" },
    { targetMuseumId: "museum-1", storageKey: "secret" },
  ])
    await assert.rejects(parseMuseumCopyTarget(request(value)), errorCode("INVALID_COPY_TARGET"));
});
