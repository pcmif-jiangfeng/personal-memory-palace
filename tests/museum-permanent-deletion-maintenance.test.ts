import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { museumPhotoStorageKey } from "../src/storage/photo-storage-key.ts";
import { permanentlyDeleteMuseum } from "../src/application/permanent-museum-deletion.ts";
import { finalizeMuseumDeletion } from "../scripts/finalize-museum-deletion.ts";
import { runMuseumDeletionWorker } from "../scripts/run-museum-deletion-worker.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "palace-j6-maintenance-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const data = path.join(root, "data");
  const backups = path.join(root, "backups");
  await mkdir(data);
  const db = initializeDatabase(path.join(data, "palace.sqlite"), false);
  const user = createUserInDatabase(db, {
    email: "owner@example.com",
    displayName: "Owner",
    passwordHash: "fixture-hash",
  });
  const otherUser = createUserInDatabase(db, {
    email: "other@example.com",
    displayName: "Other",
    passwordHash: "fixture-hash",
  });
  const museums = ["due", "other"].map((slug, index) =>
    createMuseumInDatabase(db, { ownerId: index === 0 ? user.id : otherUser.id, name: slug, slug }),
  );
  db.exec("UPDATE museums SET museum_type='shared'");
  const files: string[] = [];
  for (const museum of museums) {
    const key = museumPhotoStorageKey(museum.id);
    const file = path.join(data, "images", key);
    const original = key.replace("/optimized/", "/original/").replace(/\.webp$/, ".jpg");
    for (const asset of [key, original]) {
      await mkdir(path.dirname(path.join(data, "images", asset)), { recursive: true });
      await writeFile(path.join(data, "images", asset), `bytes-${museum.slug}`);
    }
    await writeFile(path.join(path.dirname(file), "unreferenced.webp"), `orphan-${museum.slug}`);
    db.prepare(
      "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,original_storage_key,width,height,created_at) VALUES (?,?,'photo','image/webp',?,?,1,1,'now')",
    ).run(randomUUID(), museum.id, key, original);
    files.push(file);
  }
  db.prepare(
    "UPDATE museums SET status='pending_deletion',deletion_scheduled_at='2000-01-01T00:00:00.000Z' WHERE id=?",
  ).run(museums[0].id);
  db.close();
  return { root, data, backups, museums, files, id: museums[0].id };
}

test("controlled worker is read-only by default and refuses missing maintenance authority", async (t) => {
  const f = await fixture(t),
    file = path.join(f.data, "palace.sqlite"),
    before = await readFile(file);
  const result = await runMuseumDeletionWorker({ dataDirectory: f.data, limit: 1 });
  assert.deepEqual(result, { dryRun: true, results: [{ museumId: f.id, status: "planned" }] });
  assert.deepEqual(await readFile(file), before);
  await assert.rejects(
    runMuseumDeletionWorker({ dataDirectory: f.data, apply: true }),
    /stopped writers/,
  );
  await assert.rejects(runMuseumDeletionWorker({ dataDirectory: f.data, limit: 21 }), /1..20/);
  assert.deepEqual(await readFile(file), before);
});

test("worker records safe failure, freezes access and retries only after its backoff with a verified backup", async (t) => {
  const f = await fixture(t),
    file = path.join(f.data, "palace.sqlite");
  await rm(f.files[0]);
  const options = {
    dataDirectory: f.data,
    apply: true,
    quiesced: true,
    backupRoot: f.backups,
    limit: 1,
  };
  assert.deepEqual((await runMuseumDeletionWorker(options)).results, [
    { museumId: f.id, status: "failed" },
  ]);
  const db = new DatabaseSync(file);
  try {
    const row = db
      .prepare(
        "SELECT status,deletion_attempts,deletion_last_error,deletion_next_attempt_at FROM museums WHERE id=?",
      )
      .get(f.id)!;
    assert.equal(row.status, "pending_deletion");
    assert.equal(row.deletion_attempts, 1);
    assert.equal(row.deletion_last_error, "CLEANUP_FAILED");
    assert.ok(Date.parse(String(row.deletion_next_attempt_at)) > Date.now());
    assert.deepEqual((await runMuseumDeletionWorker(options)).results, []);
    await writeFile(f.files[0], "bytes-due");
    db.prepare("UPDATE museums SET deletion_next_attempt_at='2000-01-01T00:00:00Z' WHERE id=?").run(
      f.id,
    );
    assert.deepEqual((await runMuseumDeletionWorker(options)).results, [
      { museumId: f.id, status: "deleted" },
    ]);
    assert.equal(db.prepare("SELECT 1 FROM museums WHERE id=?").get(f.id), undefined);
    assert.ok(db.prepare("SELECT 1 FROM museums WHERE id=?").get(f.museums[1].id));
    assert.ok(existsSync(f.files[1]));
  } finally {
    db.close();
  }
});

test("J6 maintenance dry-run and invalid confirmations leave database and photos unchanged", async (t) => {
  const f = await fixture(t);
  const databasePath = path.join(f.data, "palace.sqlite");
  const before = await readFile(databasePath);
  const plan = await finalizeMuseumDeletion({ dataDirectory: f.data, museumId: f.id });
  assert.ok("dryRun" in plan && plan.dryRun);
  assert.ok("files" in plan && plan.files === 3);
  assert.deepEqual(await readFile(databasePath), before);
  await assert.rejects(
    () => finalizeMuseumDeletion({ dataDirectory: f.data, museumId: f.id, apply: true }),
    /Apply requires/,
  );
  assert.deepEqual(await readFile(databasePath), before);
  assert.ok(existsSync(f.files[0]));
  const invalidRoot = path.join(f.data, "invalid-backups");
  await assert.rejects(
    () =>
      finalizeMuseumDeletion({
        dataDirectory: f.data,
        museumId: f.id,
        apply: true,
        quiesced: true,
        confirm: f.id,
        backupRoot: invalidRoot,
      }),
    /outside the data directory/,
  );
  assert.equal(existsSync(invalidRoot), false);
});

test("J6 real maintenance CLI verifies a recoverable backup before deleting only the due Museum", async (t) => {
  const f = await fixture(t);
  const command = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "scripts/finalize-museum-deletion.ts",
      f.data,
      f.id,
      "--apply",
      "--quiesced",
      "--confirm",
      f.id,
      "--backup-root",
      f.backups,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(command.status, 0, command.stderr);
  const result = JSON.parse(command.stdout);
  assert.equal(result.deleted, true);
  assert.equal(result.verified, true);
  assert.match(result.backupFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(existsSync(path.join(f.data, "images", "uploads", "museums", f.id)), false);
  assert.equal(await readFile(f.files[1], "utf8"), "bytes-other");
  const db = new DatabaseSync(path.join(f.data, "palace.sqlite"), { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT COUNT(*) n FROM museums").get()!.n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get()!.n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM uploaded_photos").get()!.n, 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
  assert.equal(
    (await readdir(f.backups)).some((entry) => entry.startsWith(".verify-")),
    false,
  );
  assert.equal(
    await readFile(
      path.join(
        result.backupDirectory,
        "uploads",
        "museums",
        f.id,
        "optimized",
        "unreferenced.webp",
      ),
      "utf8",
    ),
    "orphan-due",
  );
  const backupDb = new DatabaseSync(
    path.join(result.backupDirectory, "database", "palace.sqlite"),
    { readOnly: true },
  );
  try {
    assert.equal(backupDb.prepare("SELECT COUNT(*) n FROM museums").get()!.n, 2);
  } finally {
    backupDb.close();
  }
});

test("J6 missing referenced photo aborts restore verification without deleting DB content", async (t) => {
  const f = await fixture(t);
  await rm(f.files[0]);
  await assert.rejects(
    () =>
      finalizeMuseumDeletion({
        dataDirectory: f.data,
        museumId: f.id,
        apply: true,
        quiesced: true,
        confirm: f.id,
        backupRoot: f.backups,
      }),
    /Referenced image is missing/,
  );
  const db = new DatabaseSync(path.join(f.data, "palace.sqlite"), { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT COUNT(*) n FROM museums").get()!.n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM uploaded_photos").get()!.n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM museum_permanent_deletion_jobs").get()!.n, 0);
  } finally {
    db.close();
  }
  assert.equal(existsSync(path.join(f.data, ".museum-permanent-delete.lock")), false);
});

test("J6 interrupted final transaction retains the original backup and can resume after files are gone", async (t) => {
  const f = await fixture(t);
  const databasePath = path.join(f.data, "palace.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TRIGGER fail_final_delete BEFORE DELETE ON museums BEGIN SELECT RAISE(ABORT,'final failure'); END",
  );
  db.close();
  const options = {
    dataDirectory: f.data,
    museumId: f.id,
    apply: true,
    quiesced: true,
    confirm: f.id,
    backupRoot: f.backups,
  };
  await assert.rejects(() => finalizeMuseumDeletion(options), /final failure/);
  assert.equal(existsSync(f.files[0]), false);
  const staged = new DatabaseSync(databasePath);
  const job = staged
    .prepare("SELECT * FROM museum_permanent_deletion_jobs WHERE museum_id=?")
    .get(f.id)!;
  assert.ok(job);
  staged.exec("DROP TRIGGER fail_final_delete");
  staged.close();
  const result = await finalizeMuseumDeletion(options);
  assert.ok("deleted" in result && result.deleted);
  assert.ok("backupDirectory" in result && result.backupDirectory === job.backup_directory);
  assert.equal(await readFile(f.files[1], "utf8"), "bytes-other");
});

test("J6 backup failure and backup tampering leave a safe retry state", async (t) => {
  const f = await fixture(t);
  const images = path.join(f.data, "images");
  const db = new DatabaseSync(path.join(f.data, "palace.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  try {
    await assert.rejects(
      () =>
        permanentlyDeleteMuseum(db, images, f.id, {
          quiesced: false,
          backup: {
            create: async () => {
              throw new Error("must not run");
            },
            verify: async () => "a".repeat(64),
          },
        }),
      /quiesced/,
    );
    await assert.rejects(
      () =>
        permanentlyDeleteMuseum(db, images, f.id, {
          quiesced: true,
          backup: {
            create: async () => "/backup",
            verify: async () => {
              throw new Error("backup failure");
            },
          },
        }),
      /backup failure/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM uploaded_photos").get()!.n, 2);
    // Inject a final transaction failure at the trusted backup boundary to retain a cleanup job.
    const fingerprint = "a".repeat(64);
    await assert.rejects(
      () =>
        permanentlyDeleteMuseum(db, images, f.id, {
          quiesced: true,
          backup: {
            create: async () => "/backup",
            verify: async () => {
              db.exec(
                "CREATE TRIGGER fail_last BEFORE DELETE ON museums BEGIN SELECT RAISE(ABORT,'last failure'); END",
              );
              return fingerprint;
            },
          },
        }),
      /last failure/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM museum_permanent_deletion_jobs").get()!.n, 1);
    await assert.rejects(
      () =>
        permanentlyDeleteMuseum(db, images, f.id, {
          quiesced: true,
          backup: {
            create: async () => {
              throw new Error("must reuse backup");
            },
            verify: async () => "b".repeat(64),
          },
        }),
      /backup changed/,
    );
    assert.ok(db.prepare("SELECT id FROM museums WHERE id=?").get(f.id));
  } finally {
    db.close();
  }
});

test("J6 filesystem cleanup failure retains a journal; retry removes files only after the unsafe entry is corrected", async (t) => {
  const f = await fixture(t);
  const images = path.join(f.data, "images");
  const db = new DatabaseSync(path.join(f.data, "palace.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  const outside = path.join(f.root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "keep.txt"), "KEEP");
  const link = path.join(images, "uploads", "museums", f.id, "unsafe-link");
  try {
    const backup = { create: async () => "/verified-backup", verify: async () => "a".repeat(64) };
    await assert.rejects(
      () =>
        permanentlyDeleteMuseum(db, images, f.id, {
          quiesced: true,
          backup: {
            ...backup,
            verify: async () => {
              await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
              return "a".repeat(64);
            },
          },
        }),
      /Unsafe Museum storage entry/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM museum_permanent_deletion_jobs").get()!.n, 1);
    assert.equal(await readFile(path.join(outside, "keep.txt"), "utf8"), "KEEP");
    await rm(link, { recursive: true, force: true });
    assert.equal(
      (await permanentlyDeleteMuseum(db, images, f.id, { quiesced: true, backup })).deleted,
      true,
    );
    assert.equal(await readFile(f.files[1], "utf8"), "bytes-other");
  } finally {
    db.close();
  }
});

test("J6 cancellation during backup aborts before the DB stage, and cancelled Museums cannot be permanently deleted", async (t) => {
  const f = await fixture(t);
  const db = new DatabaseSync(path.join(f.data, "palace.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  try {
    await assert.rejects(
      () =>
        permanentlyDeleteMuseum(db, path.join(f.data, "images"), f.id, {
          quiesced: true,
          backup: {
            create: async () => "/backup",
            verify: async () => {
              db.prepare(
                "UPDATE museums SET status='active',deletion_scheduled_at=NULL,version=version+1 WHERE id=?",
              ).run(f.id);
              return "a".repeat(64);
            },
          },
        }),
      /not due/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM uploaded_photos").get()!.n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM museum_permanent_deletion_jobs").get()!.n, 0);
    assert.ok(existsSync(f.files[0]));
  } finally {
    db.close();
  }
});
