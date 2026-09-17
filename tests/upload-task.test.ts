import assert from "node:assert/strict";
import test from "node:test";
import { calculateTargetDimensions } from "../src/upload/client-image-optimizer.ts";
import { isUploadTaskFinished, summarizeUploadStatuses } from "../src/upload/upload-task-model.ts";

test("client optimizer keeps aspect ratio without enlarging small images", () => {
  assert.deepEqual(calculateTargetDimensions(6000, 4000), { width: 2560, height: 1707 });
  assert.deepEqual(calculateTargetDimensions(900, 1200), { width: 900, height: 1200 });
});

test("upload summary keeps success, failure and cancellation independent", () => {
  const summary = summarizeUploadStatuses([
    "success",
    "failed",
    "cancelled",
    "uploading",
    "waiting",
  ]);
  assert.deepEqual(summary, {
    total: 5,
    completed: 3,
    success: 1,
    failed: 1,
    cancelled: 1,
    active: 1,
  });
  assert.equal(isUploadTaskFinished(["success", "failed", "cancelled"]), true);
  assert.equal(isUploadTaskFinished(["success", "uploading"]), false);
});
