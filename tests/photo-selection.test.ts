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

test("desktop and keyboard clicks toggle while touch selection only adds", async () => {
  const { resolvePhotoClickIntent } =
    await import("../src/components/photo-selection-interaction.ts");

  assert.equal(
    resolvePhotoClickIntent({ suppressed: false, detail: 1, touch: false, selectionMode: false }),
    "toggle",
  );
  assert.equal(
    resolvePhotoClickIntent({ suppressed: false, detail: 0, touch: false, selectionMode: false }),
    "toggle",
  );
  assert.equal(
    resolvePhotoClickIntent({ suppressed: false, detail: 1, touch: true, selectionMode: true }),
    "select",
  );
  assert.equal(
    resolvePhotoClickIntent({ suppressed: false, detail: 1, touch: true, selectionMode: false }),
    "none",
  );
  assert.equal(
    resolvePhotoClickIntent({ suppressed: true, detail: 1, touch: false, selectionMode: false }),
    "ignore",
  );
});

test("long press movement threshold ignores jitter and cancels after a drag", async () => {
  const { movedPastLongPressThreshold } =
    await import("../src/components/photo-selection-interaction.ts");

  assert.equal(movedPastLongPressThreshold({ x: 10, y: 10 }, { x: 16, y: 18 }), false);
  assert.equal(movedPastLongPressThreshold({ x: 10, y: 10 }, { x: 23, y: 10 }), true);
});
