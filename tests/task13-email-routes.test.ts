import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Task13B account recovery routes use the unified code flow, never retired link forms", () => {
  const read = (route: string) =>
    readFileSync(new URL(`../src/app/${route}/page.tsx`, import.meta.url), "utf8");
  assert.match(read("forgot-password"), /EmailCodeForm purpose="RESET_PASSWORD"/);
  assert.match(read("reset-password"), /redirect\("\/forgot-password"\)/);
  assert.match(read("resend-verification"), /redirect\("\/verify-email"\)/);
  for (const route of ["forgot-password", "reset-password", "resend-verification"]) {
    assert.doesNotMatch(read(route), /ForgotPasswordForm|ResetPasswordForm|ResendVerificationForm/);
  }
});
