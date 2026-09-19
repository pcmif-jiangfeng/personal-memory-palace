import assert from "node:assert/strict";
import test from "node:test";
import { createClientRandomId } from "../src/upload/client-random-id.ts";

test("client id generation falls back when randomUUID is unavailable", () => {
  const source = {
    getRandomValues(bytes: Uint8Array) {
      bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      return bytes;
    },
  };

  assert.equal(createClientRandomId(source), "00010203-0405-4607-8809-0a0b0c0d0e0f");
});

test("client id generation uses native randomUUID when available", () => {
  const source = {
    randomUUID: () => "native-id",
    getRandomValues(bytes: Uint8Array) {
      return bytes;
    },
  };

  assert.equal(createClientRandomId(source), "native-id");
});
