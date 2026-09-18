import assert from "node:assert/strict";
import test from "node:test";
import {
  adjacentStageIndex,
  carouselBoundaryState,
  closestStageIndex,
  normalizeStageOffsets,
} from "../src/components/stage-carousel-geometry.ts";

function stageOffsets(count: number, width = 340, gap = 32): number[] {
  return Array.from({ length: count }, (_, index) => index * (width + gap));
}

for (const count of [3, 5, 10, 20]) {
  test(`moves one measured Stage unit across ${count} cards`, () => {
    const offsets = stageOffsets(count);
    let pendingIndex: number | null = 0;
    for (let expected = 1; expected < count; expected += 1) {
      pendingIndex = adjacentStageIndex(offsets, offsets[0], 1, pendingIndex);
      assert.equal(pendingIndex, expected);
    }
    assert.equal(adjacentStageIndex(offsets, offsets.at(-1)!, 1, pendingIndex), count - 1);
  });
}

test("continues from the nearest card after natural scrolling", () => {
  const offsets = stageOffsets(10, 320, 24);
  const betweenSecondAndThird = offsets[2] - 40;
  assert.equal(closestStageIndex(offsets, betweenSecondAndThird), 2);
  assert.equal(adjacentStageIndex(offsets, betweenSecondAndThird, 1), 3);
  assert.equal(adjacentStageIndex(offsets, betweenSecondAndThird, -1), 1);
});

test("removes the responsive leading inset from measured card positions", () => {
  assert.deepEqual(normalizeStageOffsets([16, 398, 780]), [0, 382, 764]);
});

test("reports both boundaries and the no-overflow state with tolerance", () => {
  assert.deepEqual(carouselBoundaryState(0, 900, 900), {
    canScroll: false,
    atStart: true,
    atEnd: true,
  });
  assert.deepEqual(carouselBoundaryState(1, 900, 1800), {
    canScroll: true,
    atStart: true,
    atEnd: false,
  });
  assert.deepEqual(carouselBoundaryState(899, 900, 1800), {
    canScroll: true,
    atStart: false,
    atEnd: true,
  });
});
