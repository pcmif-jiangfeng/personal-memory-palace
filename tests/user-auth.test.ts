import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import {
  loginUserInDatabase,
  findUserBySessionInDatabase,
  revokeUserSessionInDatabase,
} from "../src/data/user-auth.ts";
import { registerUserInDatabase } from "../src/data/user-registration.ts";

test("valid credentials create a revocable User session without Owner privileges", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-user-auth-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const now = new Date("2026-09-25T00:00:00.000Z");
  try {
    const user = registerUserInDatabase(database, {
      email: "person@example.com",
      password: "correct-password-123",
      displayName: "馆长",
    });
    assert.equal(
      loginUserInDatabase(database, user.email, "wrong-password-123", now).status,
      "invalid",
    );
    assert.equal(
      loginUserInDatabase(database, "missing@example.com", "correct-password-123", now).status,
      "invalid",
    );
    assert.equal(
      loginUserInDatabase(database, user.email, "correct-password-123", now).status,
      "unverified",
    );
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM user_sessions").get()?.count, 0);

    database.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(user.id);
    const login = loginUserInDatabase(database, user.email, "correct-password-123", now);
    assert.equal(login.status, "authenticated");
    if (login.status !== "authenticated") throw new Error("Expected authenticated session");
    assert.match(login.sessionToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(findUserBySessionInDatabase(database, login.sessionToken, now)?.id, user.id);
    assert.equal(findUserBySessionInDatabase(database, `${login.sessionToken}x`, now), null);
    assert.equal(
      database.prepare("SELECT token_hash FROM user_sessions").get()?.token_hash ===
        login.sessionToken,
      false,
    );

    revokeUserSessionInDatabase(database, login.sessionToken);
    assert.equal(findUserBySessionInDatabase(database, login.sessionToken, now), null);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("User session expires server-side", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-user-expiry-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const now = new Date("2026-09-25T00:00:00.000Z");
  try {
    const user = registerUserInDatabase(database, {
      email: "person@example.com",
      password: "correct-password-123",
      displayName: "馆长",
    });
    database.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(user.id);
    const login = loginUserInDatabase(database, user.email, "correct-password-123", now);
    if (login.status !== "authenticated") throw new Error("Expected authenticated session");
    assert.equal(
      findUserBySessionInDatabase(
        database,
        login.sessionToken,
        new Date("2026-10-03T00:00:00.000Z"),
      ),
      null,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
