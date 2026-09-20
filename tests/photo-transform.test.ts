import assert from "node:assert/strict";
import test from "node:test";
import { normalizePhotoTransform } from "../src/components/use-photo-transform.ts";

const metrics = {
  imageWidth: 800,
  imageHeight: 600,
  viewportWidth: 400,
  viewportHeight: 300,
};

test("normalizes minimum scale to a centered transform", () => {
  assert.deepEqual(normalizePhotoTransform({ scale: 0.2, x: 90, y: -40 }, metrics), {
    scale: 1,
    x: 0,
    y: 0,
  });
});

test("clamps zoomed transforms against scale and viewport bounds", () => {
  const normalized = normalizePhotoTransform({ scale: 8, x: 5000, y: -5000 }, metrics);

  assert.equal(normalized.scale, 5);
  assert.equal(normalized.x, 1800);
  assert.equal(normalized.y, -1350);
});
