import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePhotoSwipeDirection,
  resolvePhotoViewerIndex,
} from "../src/components/photo-viewer-state.ts";

const photos = [{ id: "first" }, { id: "cover" }, { id: "last" }];

test("resolves first, middle and last photos by stable id", () => {
  assert.equal(resolvePhotoViewerIndex(photos, "first"), 0);
  assert.equal(resolvePhotoViewerIndex(photos, "cover"), 1);
  assert.equal(resolvePhotoViewerIndex(photos, "last"), 2);
});

test("cover position does not override the clicked photo", () => {
  assert.equal(resolvePhotoViewerIndex(photos, "last"), 2);
});

test("falls back safely when the requested photo was removed", () => {
  assert.equal(resolvePhotoViewerIndex(photos, "removed", 1), 1);
  assert.equal(resolvePhotoViewerIndex(photos, "removed", 99), 2);
  assert.equal(resolvePhotoViewerIndex([], "removed"), -1);
});

test("recognizes deliberate horizontal swipes without stealing vertical gestures", () => {
  assert.equal(resolvePhotoSwipeDirection(-80, 10, 56), 1);
  assert.equal(resolvePhotoSwipeDirection(80, 10, 56), -1);
  assert.equal(resolvePhotoSwipeDirection(30, 5, 56), 0);
  assert.equal(resolvePhotoSwipeDirection(80, 100, 56), 0);
});
