import assert from "node:assert/strict";
import test from "node:test";
import { parseEmailInviteCreation, parseEmailInviteAcceptance } from "../src/http/email-invites.ts";

const request = (body: unknown) =>
  new Request("http://localhost/api/invites", { method: "POST", body: JSON.stringify(body) });
test("email invite boundary rejects legacy modes, forged identity, expiry and bearer credentials", async () => {
  assert.deepEqual(await parseEmailInviteCreation(request({ targetEmail: " A@Example.com " })), {
    targetEmail: "a@example.com",
  });
  for (const body of [
    {},
    { targetEmail: null },
    { targetEmail: "invalid" },
    { targetEmail: "a@example.com", expiresAt: null },
    { targetEmail: "a@example.com", userId: "forged" },
    { useMode: "multi-use", maxUses: null, expiresAt: null },
  ])
    await assert.rejects(parseEmailInviteCreation(request(body)));
  const inviteId = "14a89bc5-9cfa-4ec4-8af4-f376c3042713";
  assert.deepEqual(await parseEmailInviteAcceptance(request({ inviteId })), { inviteId });
  for (const body of [
    {},
    { token: "a".repeat(43) },
    { inviteId: "a".repeat(43) },
    { inviteId, userId: "forged" },
    { inviteId, targetEmail: "other@example.com" },
  ])
    await assert.rejects(parseEmailInviteAcceptance(request(body)));
});
