import assert from "node:assert/strict";
import test from "node:test";
import { sendTransactionalEmail } from "../src/email/transactional-email.ts";

const configuration = { apiKey: "secret-test-key", from: "Palace <from@example.com>" };
const message = {
  to: "private@example.com",
  subject: "Code",
  text: "123456",
  html: "<p>123456</p>",
};

test("provider failures carry safe status, error code and request correlation without email, code or key", async () => {
  await assert.rejects(
    sendTransactionalEmail(
      message,
      configuration,
      async () =>
        new Response(
          JSON.stringify({
            name: "validation_error",
            message: "private@example.com secret-test-key 123456",
          }),
          { status: 403, headers: { "x-request-id": "11111111-1111-4111-8111-111111111111" } },
        ),
    ),
    (error) => {
      const value = error as Error & { status: number; providerCode: string; requestId: string };
      assert.equal(value.status, 403);
      assert.equal(value.providerCode, "validation_error");
      assert.match(value.requestId, /^[0-9a-f-]{36}$/);
      assert.doesNotMatch(
        value.message + JSON.stringify(value),
        /private@example.com|secret-test-key|123456/,
      );
      return true;
    },
  );
});

test("network errors do not leak raw provider exceptions", async () => {
  await assert.rejects(
    sendTransactionalEmail(message, configuration, async () => {
      throw new Error("secret-test-key private@example.com");
    }),
    (error) => {
      assert.doesNotMatch(String(error), /secret-test-key|private@example.com/);
      return true;
    },
  );
});

test("successful delivery receipt reports only safe provider IDs, not delivered status or raw payload", async () => {
  const receipt = await sendTransactionalEmail(message, configuration, async () =>
    Response.json({ id: "11111111-1111-4111-8111-111111111111", extra: "secret-test-key" }),
  );
  assert.equal(receipt.messageId, "11111111-1111-4111-8111-111111111111");
  assert.match(receipt.requestId, /^[0-9a-f-]{36}$/);
  assert.doesNotMatch(JSON.stringify(receipt), /secret-test-key|delivered/);
  const invalid = await sendTransactionalEmail(message, configuration, async () =>
    Response.json({ id: "private@example.com" }),
  );
  assert.equal(invalid.messageId, null);
});
