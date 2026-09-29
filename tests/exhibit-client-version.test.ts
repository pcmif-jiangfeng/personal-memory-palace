import assert from "node:assert/strict";
import test from "node:test";
import { ClientApiError } from "../src/client/http-client.ts";
import {
  addMemoryPhotos,
  removeMemoryPhoto,
  reorderMemoryPhotos,
  setMemoryCover,
  updateMemoryExhibitMetadata,
} from "../src/client/memory-api.ts";

test("every Exhibit client write sends its loaded version and Museum and returns the saved version", async () => {
  const originalFetch = globalThis.fetch;
  const expectedActions = [
    "addPhotos",
    "removePhoto",
    "reorderPhotos",
    "setCover",
    "exhibitMetadata",
  ];
  const received: string[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/memories/memory%20id?museumId=museum-id");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.version, 5);
    received.push(String(body.action));
    return Response.json({ ok: true, version: 6 });
  };
  try {
    assert.equal(await addMemoryPhotos("memory id", ["p"], 5, "museum-id"), 6);
    assert.equal(await removeMemoryPhoto("memory id", "p", 5, "museum-id"), 6);
    assert.equal(await reorderMemoryPhotos("memory id", ["p"], 5, "museum-id"), 6);
    assert.equal(await setMemoryCover("memory id", "p", 5, "museum-id"), 6);
    assert.equal(
      await updateMemoryExhibitMetadata("memory id", "p", "Title", "Description", 5, "museum-id"),
      6,
    );
    assert.deepEqual(received, expectedActions);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Exhibit version conflicts are surfaced without automatic retry", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({ error: "MEMORY_VERSION_CONFLICT" }, { status: 409 });
  };
  try {
    await assert.rejects(
      setMemoryCover("memory", "p", 5),
      (error: unknown) =>
        error instanceof ClientApiError &&
        error.code === "MEMORY_VERSION_CONFLICT" &&
        error.status === 409,
    );
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Exhibit client rejects successful responses without a valid saved version", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const version of [undefined, null, 0, "6", 1.5]) {
      globalThis.fetch = async () => Response.json({ ok: true, version });
      await assert.rejects(
        setMemoryCover("memory", "p", 5),
        (error: unknown) => error instanceof ClientApiError && error.code === "INVALID_RESPONSE",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
