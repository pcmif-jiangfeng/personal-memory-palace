import assert from "node:assert/strict";
import test from "node:test";
import { parseLaterNoteAction } from "../src/http/later-note.ts";

function request(body: unknown) {
  return new Request("http://localhost/api/later-notes/n", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
test("Note HTTP boundary accepts only its action fields and never accepts an author override", async () => {
  assert.deepEqual(
    await parseLaterNoteAction(request({ action: "update", content: " Note ", version: 2 })),
    { action: "update", content: "Note", version: 2 },
  );
  for (const body of [
    { action: "update", content: "Note", version: 2, authorUserId: "owner" },
    { action: "update", content: " ", version: 2 },
    { action: "update", content: "Note", version: 0 },
    { action: "update", content: "Note", version: "2" },
    { action: "permanent", confirm: false },
    { action: "trash", museumId: "foreign" },
    { action: "unknown" },
  ])
    await assert.rejects(parseLaterNoteAction(request(body)));
  assert.deepEqual(await parseLaterNoteAction(request({ action: "permanent", confirm: true })), {
    action: "permanent",
    confirm: true,
  });
  assert.deepEqual(await parseLaterNoteAction(request({ action: "restore" })), {
    action: "restore",
  });
});
