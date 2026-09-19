import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPhotoPosition,
  clampPhotoScale,
  fitPhotoWithinViewport,
  zoomPhotoAroundPoint,
} from "../src/components/photo-viewer-geometry.ts";

const metrics = {
  imageWidth: 800,
  imageHeight: 600,
  viewportWidth: 1000,
  viewportHeight: 800,
};

test("photo viewer scale remains between 1x and 5x", () => {
  assert.equal(clampPhotoScale(0.2), 1);
  assert.equal(clampPhotoScale(2.5), 2.5);
  assert.equal(clampPhotoScale(8), 5);
});

test("photo position is centered at minimum scale and bounded while zoomed", () => {
  assert.deepEqual(clampPhotoPosition({ x: 120, y: -80 }, 1, metrics), { x: 0, y: 0 });
  assert.deepEqual(clampPhotoPosition({ x: 900, y: -900 }, 2, metrics), { x: 300, y: -200 });
});

test("zooming around an off-center point keeps that photo detail anchored", () => {
  const result = zoomPhotoAroundPoint({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 }, metrics);
  assert.deepEqual(result, { scale: 2, x: -100, y: -50 });
  assert.deepEqual(zoomPhotoAroundPoint(result, 1, { x: 100, y: 50 }, metrics), {
    scale: 1,
    x: 0,
    y: 0,
  });
});

test("fits every common photo ratio fully inside the available viewer area", () => {
  assert.deepEqual(fitPhotoWithinViewport(1600, 900, 320, 500), {
    width: 320,
    height: 180,
  });
  assert.deepEqual(fitPhotoWithinViewport(900, 1600, 320, 500), {
    width: 281.25,
    height: 500,
  });
  assert.deepEqual(fitPhotoWithinViewport(1000, 1000, 320, 500), {
    width: 320,
    height: 320,
  });
  assert.deepEqual(fitPhotoWithinViewport(4000, 500, 320, 500), {
    width: 320,
    height: 40,
  });
  assert.deepEqual(fitPhotoWithinViewport(500, 4000, 320, 500), {
    width: 62.5,
    height: 500,
  });
});
