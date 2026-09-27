import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { initializeDatabase } from "../src/data/database.ts";
import { sendVerificationEmail, verificationLink } from "../src/email/verification-email.ts";
import { resendVerificationEmail } from "../src/email/resend-verification.ts";

test("verification mail keeps the token in the URL fragment and sends through Resend", async () => {
  const token = "a".repeat(43);
  assert.equal(verificationLink(token), `https://memorymuseum.top/verify-email#${token}`);
  let sent: { url: string; init: RequestInit } | undefined;
  await sendVerificationEmail(
    "person@example.com",
    token,
    {
      apiKey: "test-key",
      from: "Palace <hello@example.com>",
    },
    async (url, init) => {
      sent = { url: String(url), init: init! };
      return new Response(JSON.stringify({ id: "email-id" }), { status: 200 });
    },
  );
  assert.equal(sent?.url, "https://api.resend.com/emails");
  assert.equal((sent?.init.headers as Record<string, string>).Authorization, "Bearer test-key");
  const body = JSON.parse(String(sent?.init.body));
  assert.equal(body.to, "person@example.com");
  assert.match(body.html, /verify-email#a{43}/);
  assert.match(body.text, /verify-email#a{43}/);
});

test("resend is generic for unknown users and enforces an account cooldown", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-mail-"));
  const db = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const user = createUserInDatabase(db, {
    email: "person@example.com",
    passwordHash: "test-hash",
    displayName: "馆长",
  });
  const sent: string[] = [];
  const send = async (_email: string, token: string) => {
    sent.push(token);
  };
  const now = new Date("2026-09-25T12:00:00.000Z");
  try {
    await resendVerificationEmail(db, "unknown@example.com", send, now);
    assert.equal(sent.length, 0);
    await resendVerificationEmail(db, user.email, send, now);
    assert.equal(sent.length, 1);
    await resendVerificationEmail(db, user.email, send, new Date(now.getTime() + 30_000));
    assert.equal(sent.length, 1);
    await resendVerificationEmail(db, user.email, send, new Date(now.getTime() + 61_000));
    assert.equal(sent.length, 2);
    assert.notEqual(sent[0], sent[1]);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
