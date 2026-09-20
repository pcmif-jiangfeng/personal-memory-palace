import assert from "node:assert/strict";
import test from "node:test";
import { ClientApiError, requestJson } from "../src/client/http-client.ts";

function replaceFetch(fetcher: typeof fetch): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("requestJson decodes a successful JSON response", async () => {
  const restore = replaceFetch(async () => Response.json({ value: "memory" }, { status: 200 }));
  try {
    const result = await requestJson("/api/test", undefined, (payload) => {
      if (typeof payload !== "object" || payload === null || !("value" in payload)) {
        throw new TypeError("Expected response value");
      }
      assert.equal(typeof payload.value, "string");
      return payload.value as string;
    });
    assert.equal(result, "memory");
  } finally {
    restore();
  }
});

test("requestJson exposes API error code, status and details", async () => {
  const restore = replaceFetch(async () =>
    Response.json(
      { error: "PHOTO_IN_USE", details: { references: { memories: [], stages: [] } } },
      { status: 409 },
    ),
  );
  try {
    await assert.rejects(
      requestJson("/api/photos/photo-1", { method: "DELETE" }, () => undefined),
      (error: unknown) => {
        assert.equal(error instanceof ClientApiError, true);
        if (!(error instanceof ClientApiError)) return false;
        assert.equal(error.code, "PHOTO_IN_USE");
        assert.equal(error.status, 409);
        assert.deepEqual(error.details, { references: { memories: [], stages: [] } });
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("requestJson rejects malformed successful responses at the client boundary", async () => {
  const restore = replaceFetch(async () => new Response("not-json", { status: 200 }));
  try {
    await assert.rejects(
      requestJson("/api/test", undefined, () => "unused"),
      (error: unknown) =>
        error instanceof ClientApiError &&
        error.code === "INVALID_RESPONSE" &&
        error.status === 200,
    );
  } finally {
    restore();
  }
});

test("requestJson preserves aborted requests", async () => {
  const abortError = new DOMException("The operation was aborted", "AbortError");
  const restore = replaceFetch(async () => {
    throw abortError;
  });
  try {
    await assert.rejects(
      requestJson("/api/test", { signal: AbortSignal.abort() }, () => undefined),
      (error: unknown) => error === abortError,
    );
  } finally {
    restore();
  }
});
