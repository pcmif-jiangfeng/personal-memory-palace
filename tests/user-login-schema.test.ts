import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/http/errors.ts";
import { parseUserLogin } from "../src/http/schemas.ts";

function loginRequest(value: unknown): Request {
  return new Request("http://localhost/api/user-auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

test("User login normalizes email but preserves password exactly", async () => {
  const input = await parseUserLogin(
    loginRequest({ email: "  Person@Example.COM  ", password: "  long-password  " }),
  );
  assert.deepEqual(input, { email: "person@example.com", password: "  long-password  " });
});

test("User login rejects malformed credentials at the request boundary", async () => {
  for (const [value, code] of [
    [{ email: "not-an-email", password: "password" }, "INVALID_EMAIL"],
    [{ email: "person@example.com" }, "INVALID_PASSWORD"],
  ] as const) {
    await assert.rejects(
      parseUserLogin(loginRequest(value)),
      (error: unknown) => error instanceof ApiError && error.code === code,
    );
  }
});
