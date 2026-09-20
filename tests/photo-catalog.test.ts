import assert from "node:assert/strict";
import test from "node:test";
import { createPhotoCatalogQuery, photoCatalogKey } from "../src/components/use-photo-catalog.ts";

test("builds a stable photo catalog query from filters and pagination", () => {
  const filters = {
    source: "library" as const,
    usageFilter: "unused" as const,
    memoryQuery: "  海边  ",
    stageId: "stage-1",
  };

  assert.deepEqual(createPhotoCatalogQuery(filters, "cursor-2", 24), {
    source: "library",
    usage: "unused",
    query: "  海边  ",
    stageId: "stage-1",
    cursor: "cursor-2",
    limit: 24,
  });
  assert.equal(photoCatalogKey(filters), '["library","unused","  海边  ","stage-1"]');
});

test("catalog keys distinguish filter values without delimiter collisions", () => {
  const first = photoCatalogKey({
    source: "library",
    usageFilter: "all",
    memoryQuery: "a|b",
    stageId: "c",
  });
  const second = photoCatalogKey({
    source: "library",
    usageFilter: "all",
    memoryQuery: "a",
    stageId: "b|c",
  });

  assert.notEqual(first, second);
});
