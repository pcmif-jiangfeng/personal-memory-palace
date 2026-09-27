import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { initializeDatabase } from "../src/data/database.ts";
import {
  createEmailVerificationTokenInDatabase,
  verifyEmailVerificationTokenInDatabase,
} from "../src/data/email-verification.ts";
import { createLegacySecondaryTables } from "./legacy-secondary-tables.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { createUserInDatabase, findUserByIdInDatabase } from "../src/data/user-repository.ts";
import { ApiError } from "../src/http/errors.ts";
import { parseEmailVerification } from "../src/http/schemas.ts";

test("verification token is hashed at rest, expires, and can be consumed once", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-verification-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const issuedAt = new Date("2026-09-25T00:00:00.000Z");

  try {
    const user = createUserInDatabase(database, {
      email: "person@example.com",
      passwordHash: "existing-hash",
      displayName: "馆长",
    });
    const token = createEmailVerificationTokenInDatabase(database, user.id, issuedAt);
    const stored = database
      .prepare("SELECT token_hash, expires_at FROM email_verification_tokens WHERE user_id = ?")
      .get(user.id) as { token_hash: string; expires_at: string };

    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(stored.token_hash, token);
    assert.equal(stored.token_hash, createHash("sha256").update(token).digest("hex"));
    assert.equal(stored.expires_at, "2026-09-26T00:00:00.000Z");
    assert.equal(
      verifyEmailVerificationTokenInDatabase(database, token, new Date("2026-09-25T01:00:00.000Z")),
      true,
    );
    assert.equal(findUserByIdInDatabase(database, user.id)?.emailVerified, true);
    assert.equal(verifyEmailVerificationTokenInDatabase(database, token, issuedAt), false);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM email_verification_tokens").get()?.count,
      0,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("expired and replaced tokens cannot verify a User", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE memories (id TEXT PRIMARY KEY);
    CREATE TABLE stages (id TEXT PRIMARY KEY);
    CREATE TABLE uploaded_photos (id TEXT PRIMARY KEY);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations (version, applied_at)
    VALUES (1, '2026-09-01'), (2, '2026-09-01'), (3, '2026-09-01'),
           (4, '2026-09-01'), (5, '2026-09-01'), (6, '2026-09-01');
  `);

  createLegacySecondaryTables(database);
  try {
    runDatabaseMigrations(database);
    runDatabaseMigrations(database);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 7").get()
        ?.count,
      1,
    );

    const user = createUserInDatabase(database, {
      email: "another@example.com",
      passwordHash: "existing-hash",
      displayName: "馆长",
    });
    const issuedAt = new Date("2026-09-25T00:00:00.000Z");
    const expiredToken = createEmailVerificationTokenInDatabase(database, user.id, issuedAt);
    assert.equal(
      verifyEmailVerificationTokenInDatabase(
        database,
        expiredToken,
        new Date("2026-09-26T00:00:00.000Z"),
      ),
      false,
    );
    assert.equal(findUserByIdInDatabase(database, user.id)?.emailVerified, false);

    const freshToken = createEmailVerificationTokenInDatabase(database, user.id, issuedAt);
    assert.notEqual(freshToken, expiredToken);
    assert.equal(verifyEmailVerificationTokenInDatabase(database, expiredToken, issuedAt), false);
    assert.equal(verifyEmailVerificationTokenInDatabase(database, freshToken, issuedAt), true);
    assert.throws(() => createEmailVerificationTokenInDatabase(database, user.id, issuedAt));
  } finally {
    database.close();
  }
});

test("verification request rejects malformed tokens", async () => {
  const request = new Request("http://localhost/api/verify-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "not-a-token" }),
  });
  await assert.rejects(
    parseEmailVerification(request),
    (error: unknown) => error instanceof ApiError && error.code === "INVALID_VERIFICATION_TOKEN",
  );
});
