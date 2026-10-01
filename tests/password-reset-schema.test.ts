import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/http/errors.ts";
import { parsePasswordResetConfirmation } from "../src/http/schemas.ts";

function confirmationRequest(value: unknown): Request {
  return new Request("http://localhost/api/password-reset/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

test("reset confirmation accepts eight-character passwords and rejects seven non-padding characters", async () => {
  const token = "a".repeat(43);
  assert.deepEqual(
    await parsePasswordResetConfirmation(confirmationRequest({ token, newPassword: "abcdefgh" })),
    { token, newPassword: "abcdefgh" },
  );
  for (const newPassword of ["abcdefg", " abcdefg "]) {
    await assert.rejects(
      parsePasswordResetConfirmation(confirmationRequest({ token, newPassword })),
      (error: unknown) => error instanceof ApiError && error.code === "PASSWORD_TOO_SHORT",
    );
  }
});

test("reset confirmation validates a token and preserves the new password", async () => {
  const token = "a".repeat(43);
  assert.deepEqual(
    await parsePasswordResetConfirmation(
      confirmationRequest({ token, newPassword: "  new-password-123  " }),
    ),
    { token, newPassword: "  new-password-123  " },
  );
});

test("reset confirmation rejects short passwords and malformed tokens", async () => {
  for (const [input, code] of [
    [{ token: "bad", newPassword: "new-password-123" }, "INVALID_RESET_TOKEN"],
    [{ token: "a".repeat(43), newPassword: "short" }, "PASSWORD_TOO_SHORT"],
  ] as const) {
    await assert.rejects(
      parsePasswordResetConfirmation(confirmationRequest(input)),
      (error: unknown) => error instanceof ApiError && error.code === code,
    );
  }
});
