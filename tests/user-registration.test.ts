import assert from "node:assert/strict";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { registerUserInDatabase } from "../src/data/user-registration.ts";
import { ApiError } from "../src/http/errors.ts";
import { parseUserRegistration } from "../src/http/schemas.ts";

function registrationRequest(value: unknown): Request {
  return new Request("http://localhost/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

test("registration accepts eight-character passwords and rejects seven non-padding characters", async () => {
  const input = { email: "person@example.com", password: "abcdefgh", displayName: "馆长" };
  assert.equal((await parseUserRegistration(registrationRequest(input))).password, "abcdefgh");
  for (const password of ["abcdefg", " abcdefg "]) {
    await assert.rejects(
      parseUserRegistration(registrationRequest({ ...input, password })),
      (error: unknown) => error instanceof ApiError && error.code === "PASSWORD_TOO_SHORT",
    );
  }
});

test("registration validation normalizes email and preserves the password before hashing", async () => {
  const input = await parseUserRegistration(
    registrationRequest({
      email: "  Person@Example.COM  ",
      password: "  long-password-123  ",
      displayName: "  馆长  ",
    }),
  );
  assert.deepEqual(input, {
    email: "person@example.com",
    password: "  long-password-123  ",
    displayName: "馆长",
  });

  for (const [value, code] of [
    [{ email: "invalid", password: "long-password-123", displayName: "馆长" }, "INVALID_EMAIL"],
    [{ email: "person@example.com", password: "short", displayName: "馆长" }, "PASSWORD_TOO_SHORT"],
    [
      { email: "person@example.com", password: "long-password-123", displayName: "  " },
      "INVALID_DISPLAYNAME",
    ],
  ] as const) {
    await assert.rejects(
      parseUserRegistration(registrationRequest(value)),
      (error: unknown) => error instanceof ApiError && error.code === code,
    );
  }
});

test("registration stores a salted password hash and rejects duplicate email", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-register-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const password = "long-password-123";

  try {
    const registered = registerUserInDatabase(database, {
      email: "person@example.com",
      password,
      displayName: "馆长",
    });
    assert.equal(registered.emailVerified, false);
    assert.equal(registered.email, "person@example.com");
    assert.equal("passwordHash" in registered, false);

    const row = database
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(registered.id) as {
      password_hash: string;
    };
    assert.notEqual(row.password_hash, password);
    const [scheme, encodedSalt, encodedDigest] = row.password_hash.split("$");
    assert.equal(scheme, "scrypt");
    const expected = Buffer.from(encodedDigest, "base64url");
    const actual = scryptSync(password, Buffer.from(encodedSalt, "base64url"), expected.length);
    assert.equal(timingSafeEqual(actual, expected), true);

    assert.throws(
      () =>
        registerUserInDatabase(database, {
          email: "PERSON@example.com",
          password: "another-long-password",
          displayName: "另一个馆长",
        }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === "EMAIL_ALREADY_REGISTERED" &&
        error.status === 409,
    );
    const count = database.prepare("SELECT COUNT(*) AS count FROM users").get() as {
      count: number;
    };
    assert.equal(count.count, 1);
    const museumCount = database.prepare("SELECT COUNT(*) AS count FROM museums").get() as {
      count: number;
    };
    assert.equal(museumCount.count, 0);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
