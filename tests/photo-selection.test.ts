import assert from "node:assert/strict";
import test from "node:test";
import {
  addPhotoSelection,
  replacePhotoSelection,
  togglePhotoSelection,
} from "../src/components/photo-selection.ts";

test("photo selection toggles without mutating the previous state", () => {
  const original = new Set(["photo-1"]);
  const added = togglePhotoSelection(original, "photo-2");
  const removed = togglePhotoSelection(added, "photo-1");

  assert.deepEqual([...original], ["photo-1"]);
  assert.deepEqual([...added], ["photo-1", "photo-2"]);
  assert.deepEqual([...removed], ["photo-2"]);
});

test("swipe selection only adds photos and select-all replaces the result", () => {
  const selected = addPhotoSelection(new Set(["photo-1"]), "photo-2");
  const repeated = addPhotoSelection(selected, "photo-2");
  const all = replacePhotoSelection(["photo-3", "photo-4", "photo-4"]);

  assert.deepEqual([...selected], ["photo-1", "photo-2"]);
  assert.deepEqual([...repeated], ["photo-1", "photo-2"]);
  assert.deepEqual([...all], ["photo-3", "photo-4"]);
});
