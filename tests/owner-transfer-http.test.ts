import assert from "node:assert/strict";
import test from "node:test";
import { parseOwnerTransferAction } from "../src/http/owner-transfer-request.ts";

const request = (body: unknown) =>
  new Request("http://localhost/api/museums/m/transfer", {
    method: "POST",
    body: JSON.stringify(body),
  });
test("transfer HTTP accepts only explicit request/accept/reject/cancel commands", async () => {
  for (const input of [
    { action: "request", targetUserId: "target", version: 1, confirm: true },
    ...["accept", "reject", "cancel"].map((action) => ({
      action,
      requestId: "request",
      confirm: true,
    })),
  ])
    assert.deepEqual(await parseOwnerTransferAction(request(input)), input);
  for (const input of [
    {},
    { confirm: true, targetUserId: "target", version: 1, oldOwnerDisposition: "leave" },
    { action: "request", targetUserId: "target", version: 1, confirm: true, actorUserId: "forged" },
    {
      action: "request",
      targetUserId: "target",
      version: 1,
      confirm: true,
      oldOwnerDisposition: "stay",
    },
    { action: "request", targetUserId: "../target", version: 1, confirm: true },
    { action: "request", targetUserId: "target", version: "1", confirm: true },
    { action: "accept", requestId: "id", confirm: false },
    { action: "accept", requestId: "id", confirm: true, museumId: "other" },
    { action: "accept", requestId: "id", confirm: true, targetUserId: "other" },
    { action: "automatic", requestId: "id", confirm: true },
    { action: ["accept"], requestId: "id", confirm: true },
  ])
    await assert.rejects(parseOwnerTransferAction(request(input)));
});
