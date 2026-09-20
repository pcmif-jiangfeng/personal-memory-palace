import assert from "node:assert/strict";
import test from "node:test";
import {
  dragPhotoTransform,
  nextQuickZoomScale,
  pinchPhotoTransform,
  trackpadNavigationAllowed,
  viewerOrientationChanged,
} from "../src/components/photo-gesture-state.ts";

test("mouse drag preserves scale and offsets from the drag origin", () => {
  assert.deepEqual(
    dragPhotoTransform(
      { scale: 2, x: 10, y: -5 },
      { x: 100, y: 80, originX: 10, originY: -5 },
      { x: 125, y: 60 },
    ),
    { scale: 2, x: 35, y: -25 },
  );
});

test("touch pinch scales around its captured content point", () => {
  assert.deepEqual(
    pinchPhotoTransform(
      { distance: 100, scale: 2, contentX: 20, contentY: -10 },
      { x: 15, y: 25 },
      150,
    ),
    { scale: 3, x: -45, y: 55 },
  );
});

test("double tap toggles between minimum and quick zoom", () => {
  assert.equal(nextQuickZoomScale(1), 2.5);
  assert.equal(nextQuickZoomScale(2.5), 1);
});

test("trackpad navigation enforces its cooldown boundary", () => {
  assert.equal(trackpadNavigationAllowed(1_000, 700, 420), false);
  assert.equal(trackpadNavigationAllowed(1_120, 700, 420), true);
});

test("orientation change ignores the first measurement", () => {
  assert.equal(viewerOrientationChanged(null, "portrait"), false);
  assert.equal(viewerOrientationChanged("portrait", "portrait"), false);
  assert.equal(viewerOrientationChanged("portrait", "landscape"), true);
});
