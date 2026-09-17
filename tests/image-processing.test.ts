import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  createWebOptimizedImage,
  maximumUploadBatchBytes,
  maximumUploadBytes,
  maximumUploadFileCount,
  supportedImageTypes,
} from "../src/storage/image-processor.ts";

test("creates a bounded WebP browsing image", async () => {
  const input = await sharp({
    create: { width: 3000, height: 1200, channels: 3, background: "#8b7258" },
  })
    .png()
    .toBuffer();
  const result = await createWebOptimizedImage(input);
  const metadata = await sharp(result.data).metadata();

  assert.equal(metadata.format, "webp");
  assert.equal(result.width, 2048);
  assert.equal(result.height, 819);
});

test("accepts only Task02 browser image formats", () => {
  assert.deepEqual([...supportedImageTypes].sort(), ["image/jpeg", "image/png", "image/webp"]);
  assert.equal(supportedImageTypes.has("image/x-canon-cr3"), false);
  assert.equal(maximumUploadBytes, 20 * 1024 * 1024);
  assert.equal(maximumUploadBatchBytes, 100 * 1024 * 1024);
  assert.equal(maximumUploadFileCount, 20);
});
