import assert from "node:assert/strict";
import test from "node:test";
import { verificationLink } from "../src/email/verification-email.ts";
import { passwordResetLink } from "../src/email/password-reset-email.ts";

test("account email links use localhost only in development and preserve production URLs", () => {
  const variables: Record<string, string | undefined> = process.env;
  const previous = variables.NODE_ENV;
  const token = "a".repeat(43);
  try {
    for (const [environment, base] of [
      ["development", "http://localhost:3000/"],
      ["production", "https://memorymuseum.top/"],
      ["test", "https://memorymuseum.top/"],
    ]) {
      variables.NODE_ENV = environment;
      assert.equal(verificationLink(token), `${base}verify-email#${token}`);
      assert.equal(passwordResetLink(token), `${base}reset-password#${token}`);
    }
  } finally {
    if (previous === undefined) delete variables.NODE_ENV;
    else variables.NODE_ENV = previous;
  }
});
