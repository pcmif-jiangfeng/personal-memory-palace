import assert from "node:assert/strict";
import test from "node:test";
import { uploadOptimizedPhoto } from "../src/application/photo-upload-service.ts";

const uploadedPhoto = {
  id: "photo-1",
  originalName: "holiday.jpg",
  mimeType: "image/webp",
  optimizedStorageKey: "uploads/owner/optimized/fixed.webp",
  originalStorageKey: null,
  width: 1200,
  height: 800,
  createdAt: "2026-09-20T00:00:00.000Z",
  usedAt: null,
  libraryArchivedAt: null,
};

test("uploads a validated image through storage before committing its record", async () => {
  const calls: string[] = [];
  const result = await uploadOptimizedPhoto(
    { data: Buffer.from("image"), requestedName: "  holiday.jpg  " },
    {
      createStorageKey: () => "uploads/owner/optimized/fixed.webp",
      validate: async () => {
        calls.push("validate");
        return { data: Buffer.from("webp"), width: 1200, height: 800 };
      },
      prepare: (storageKey) => {
        calls.push(`prepare:${storageKey}`);
        return "operation-1";
      },
      save: async (_image, storageKey) => {
        calls.push(`save:${storageKey}`);
        return {
          optimizedStorageKey: storageKey,
          originalStorageKey: null,
          width: 1200,
          height: 800,
        };
      },
      commit: (operationId, item) => {
        calls.push(`commit:${operationId}:${item.originalName}`);
        return uploadedPhoto;
      },
    },
  );

  assert.deepEqual(calls, [
    "validate",
    "prepare:uploads/owner/optimized/fixed.webp",
    "save:uploads/owner/optimized/fixed.webp",
    "commit:operation-1:holiday.jpg",
  ]);
  assert.deepEqual(result, { ok: true, photo: uploadedPhoto });
});

test("reports invalid optimized image data before creating a pending upload", async () => {
  let prepared = false;
  const result = await uploadOptimizedPhoto(
    { data: Buffer.from("broken"), requestedName: null },
    {
      createStorageKey: () => "unused",
      validate: async () => {
        throw new Error("invalid");
      },
      prepare: () => {
        prepared = true;
        return "unused";
      },
      save: async () => {
        throw new Error("unreachable");
      },
      commit: () => uploadedPhoto,
    },
  );

  assert.equal(prepared, false);
  assert.deepEqual(result, { ok: false, error: "INVALID_OPTIMIZED_IMAGE" });
});
