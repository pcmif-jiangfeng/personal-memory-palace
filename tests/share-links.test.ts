import assert from "node:assert/strict";
import test from "node:test";
import { publicMemoryUrl, publicSiteUrl } from "../src/domain/share-links.ts";

test("share links always use the public production site", () => {
  assert.equal(publicSiteUrl, "https://memorymuseum.top/");
  assert.equal(publicMemoryUrl("memory id"), "https://memorymuseum.top/memories/memory%20id");
});
