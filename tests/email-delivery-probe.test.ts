import assert from "node:assert/strict";
import test from "node:test";
import { codeEmailMessage } from "../src/email/code-email.ts";
import { testEmailDelivery } from "../scripts/test-email-delivery.ts";

test("delivery probe uses the canonical code template and never marks API acceptance as inbox delivery", async (t) => {
  const previous = { key: process.env.RESEND_API_KEY, from: process.env.MEMORY_PALACE_EMAIL_FROM };
  process.env.RESEND_API_KEY = "test-secret-key";
  process.env.MEMORY_PALACE_EMAIL_FROM = "test@example.com";
  t.after(() => {
    if (previous.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.key;
    if (previous.from === undefined) delete process.env.MEMORY_PALACE_EMAIL_FROM;
    else process.env.MEMORY_PALACE_EMAIL_FROM = previous.from;
  });
  let calls = 0;
  const results = await testEmailDelivery(["test@qq.com"], async (_url, request) => {
    calls++;
    const body = JSON.parse(String(request?.body));
    assert.match(body.subject, /投递测试/);
    assert.match(body.text, /验证码是 \d{6}/);
    assert.match(body.html, /不绑定任何账号/);
    return Response.json({ id: "11111111-1111-4111-8111-111111111111" });
  });
  assert.equal(calls, 1);
  assert.equal(results[0].providerStatus, "accepted");
  assert.equal(results[0].inboxStatus, "requires-recipient-check");
  assert.doesNotMatch(JSON.stringify(results), /test@qq.com|test-secret-key/);
  await assert.rejects(testEmailDelivery(["test@unapproved.example"]), /user-controlled/);
  assert.throws(
    () => codeEmailMessage("test@example.com", "1234<script>", "REGISTER"),
    /six digits/,
  );
});
