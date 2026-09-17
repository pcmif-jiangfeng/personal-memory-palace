import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerSessionToken,
  isOwnerPasswordValid,
  verifyOwnerSessionToken,
} from "../src/security/owner-session.ts";

test("owner password validation and signed sessions reject tampering and password changes", () => {
  const previousPassword = process.env.MEMORY_PALACE_OWNER_PASSWORD;
  const previousSecret = process.env.MEMORY_PALACE_SESSION_SECRET;

  try {
    process.env.MEMORY_PALACE_OWNER_PASSWORD = "correct horse battery staple";
    process.env.MEMORY_PALACE_SESSION_SECRET = "test-session-secret-with-more-than-32-characters";

    assert.equal(isOwnerPasswordValid("correct horse battery staple"), true);
    assert.equal(isOwnerPasswordValid("incorrect"), false);

    const now = Date.now();
    const token = createOwnerSessionToken(now);
    assert.equal(verifyOwnerSessionToken(token, now), true);
    assert.equal(verifyOwnerSessionToken(`${token}tampered`, now), false);
    assert.equal(verifyOwnerSessionToken(token, now + 31 * 24 * 60 * 60 * 1000), false);

    process.env.MEMORY_PALACE_OWNER_PASSWORD = "a different owner password";
    assert.equal(verifyOwnerSessionToken(token, now), false);
  } finally {
    if (previousPassword === undefined) delete process.env.MEMORY_PALACE_OWNER_PASSWORD;
    else process.env.MEMORY_PALACE_OWNER_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.MEMORY_PALACE_SESSION_SECRET;
    else process.env.MEMORY_PALACE_SESSION_SECRET = previousSecret;
  }
});
