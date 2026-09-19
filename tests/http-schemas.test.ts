import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/http/errors.ts";
import {
  parseCreateMemory,
  parseMemoryAction,
  parseOwnerLogin,
  parseShareConfiguration,
} from "../src/http/schemas.ts";

function jsonRequest(value: unknown): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

async function rejectsWithCode(operation: Promise<unknown>, code: string) {
  await assert.rejects(
    operation,
    (error: unknown) => error instanceof ApiError && error.code === code,
  );
}

test("request schemas reject malformed shapes instead of trusting TypeScript assertions", async () => {
  await rejectsWithCode(parseOwnerLogin(jsonRequest([])), "INVALID_JSON_BODY");
  await rejectsWithCode(parseOwnerLogin(jsonRequest({ password: 123 })), "INVALID_PASSWORD");
  await rejectsWithCode(
    parseShareConfiguration(jsonRequest({ memoryId: "memory", enabled: true, mode: "public" })),
    "INVALID_MODE",
  );
  await rejectsWithCode(
    parseShareConfiguration(
      jsonRequest({ memoryId: "memory", enabled: true, mode: "link", rotate: "yes" }),
    ),
    "INVALID_ROTATE",
  );
  await rejectsWithCode(parseMemoryAction(jsonRequest({ action: "delete" })), "INVALID_ACTION");
});

test("share configuration accepts an explicit token rotation request", async () => {
  const input = await parseShareConfiguration(
    jsonRequest({ memoryId: "memory", enabled: true, mode: "link", rotate: true }),
  );
  assert.equal(input.rotate, true);
});

test("create-memory schema normalizes identifiers and enforces photo membership inputs", async () => {
  const input = await parseCreateMemory(
    jsonRequest({
      title: "  标题  ",
      story: "故事",
      photoIds: ["photo-1", "photo-1", "photo-2"],
      coverPhotoId: "photo-1",
      relatedMemoryIds: [],
    }),
  );
  assert.equal(input.title, "标题");
  assert.deepEqual(input.photoIds, ["photo-1", "photo-2"]);

  await rejectsWithCode(
    parseCreateMemory(
      jsonRequest({ title: "标题", story: "故事", photoIds: [], coverPhotoId: "photo-1" }),
    ),
    "INVALID_PHOTOIDS",
  );
});
