import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import {
  requestPasswordResetInDatabase,
  resetPasswordInDatabase,
} from "../src/data/password-reset.ts";
import { loginUserInDatabase, findUserBySessionInDatabase } from "../src/data/user-auth.ts";
import { registerUserInDatabase } from "../src/data/user-registration.ts";

test("reset requests hide unknown emails, hash tokens and throttle repeat sends", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-reset-request-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const issuedAt = new Date("2026-09-25T00:00:00.000Z");
  try {
    const user = registerUserInDatabase(database, {
      email: "person@example.com",
      password: "old-password-123",
      displayName: "馆长",
    });
    const sent: string[] = [];
    const send = async (_email: string, token: string) => {
      sent.push(token);
    };
    await requestPasswordResetInDatabase(database, "missing@example.com", send, issuedAt);
    assert.equal(sent.length, 0);
    await requestPasswordResetInDatabase(database, user.email, send, issuedAt);
    assert.equal(sent.length, 1);
    const stored = database
      .prepare("SELECT token_hash, expires_at FROM password_reset_tokens WHERE user_id = ?")
      .get(user.id) as { token_hash: string; expires_at: string };
    assert.equal(stored.token_hash, createHash("sha256").update(sent[0]).digest("hex"));
    assert.notEqual(stored.token_hash, sent[0]);
    assert.equal(stored.expires_at, "2026-09-25T01:00:00.000Z");
    await requestPasswordResetInDatabase(
      database,
      user.email,
      send,
      new Date(issuedAt.getTime() + 30_000),
    );
    assert.equal(sent.length, 1);
    await requestPasswordResetInDatabase(
      database,
      user.email,
      send,
      new Date(issuedAt.getTime() + 61_000),
    );
    assert.equal(sent.length, 2);
    assert.notEqual(sent[0], sent[1]);
    assert.equal(resetPasswordInDatabase(database, sent[0], "new-password-123", issuedAt), false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("one-time reset changes the password and revokes all existing User sessions", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-reset-confirm-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const issuedAt = new Date("2026-09-25T00:00:00.000Z");
  try {
    const user = registerUserInDatabase(database, {
      email: "person@example.com",
      password: "old-password-123",
      displayName: "馆长",
    });
    database.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(user.id);
    const first = loginUserInDatabase(database, user.email, "old-password-123", issuedAt);
    const second = loginUserInDatabase(database, user.email, "old-password-123", issuedAt);
    if (first.status !== "authenticated" || second.status !== "authenticated")
      throw new Error("Expected sessions");
    let token = "";
    await requestPasswordResetInDatabase(
      database,
      user.email,
      async (_email, value) => {
        token = value;
      },
      issuedAt,
    );
    assert.equal(
      resetPasswordInDatabase(
        database,
        token,
        "new-password-123",
        new Date(issuedAt.getTime() + 1000),
      ),
      true,
    );
    assert.equal(findUserBySessionInDatabase(database, first.sessionToken, issuedAt), null);
    assert.equal(findUserBySessionInDatabase(database, second.sessionToken, issuedAt), null);
    assert.equal(
      loginUserInDatabase(database, user.email, "old-password-123", issuedAt).status,
      "invalid",
    );
    assert.equal(
      loginUserInDatabase(database, user.email, "new-password-123", issuedAt).status,
      "authenticated",
    );
    assert.equal(resetPasswordInDatabase(database, token, "third-password-123", issuedAt), false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("expired reset tokens cannot change a password", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-reset-expiry-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const issuedAt = new Date("2026-09-25T00:00:00.000Z");
  try {
    const user = registerUserInDatabase(database, {
      email: "person@example.com",
      password: "old-password-123",
      displayName: "馆长",
    });
    let token = "";
    await requestPasswordResetInDatabase(
      database,
      user.email,
      async (_email, value) => {
        token = value;
      },
      issuedAt,
    );
    assert.equal(
      resetPasswordInDatabase(
        database,
        token,
        "new-password-123",
        new Date("2026-09-25T01:00:00.000Z"),
      ),
      false,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
