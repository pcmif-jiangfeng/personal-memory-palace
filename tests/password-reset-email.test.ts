import assert from "node:assert/strict";
import test from "node:test";
import { passwordResetLink, sendPasswordResetEmail } from "../src/email/password-reset-email.ts";

test("reset email uses a fragment link and the existing transactional provider", async () => {
  const token = "b".repeat(43);
  assert.equal(passwordResetLink(token), `https://memorymuseum.top/reset-password#${token}`);
  let sent: { url: string; init: RequestInit } | undefined;
  await sendPasswordResetEmail(
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
  assert.match(body.text, /reset-password#b{43}/);
  assert.match(body.html, /reset-password#b{43}/);
});
