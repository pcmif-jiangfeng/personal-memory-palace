import assert from "node:assert/strict";
import test from "node:test";
import {
  readBooleanFlag,
  readNullableString,
  readNumber,
  readString,
} from "../src/data/row-readers.ts";

const row: Record<string, unknown> = {
  id: "photo-1",
  width: 1920,
  originalKey: null,
  isCover: 1,
};

test("row readers accept the exact SQLite boundary types", () => {
  assert.equal(readString(row, "id"), "photo-1");
  assert.equal(readNumber(row, "width"), 1920);
  assert.equal(readNullableString(row, "originalKey"), null);
  assert.equal(readBooleanFlag(row, "isCover"), true);
});

test("row readers reject missing or mismatched database columns", () => {
  assert.throws(() => readString(row, "missing"), /missing/);
  assert.throws(() => readString(row, "width"), /width/);
  assert.throws(() => readNumber(row, "id"), /id/);
  assert.throws(() => readBooleanFlag({ isCover: 2 }, "isCover"), /isCover/);
});
