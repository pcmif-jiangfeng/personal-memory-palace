import assert from "node:assert/strict";
import test from "node:test";
import { ClientApiError } from "../src/client/http-client.ts";
import {
  archivePhoto,
  deletePhoto,
  deletePhotos,
  listPhotoIds,
  listPhotos,
} from "../src/client/photo-api.ts";

function replaceFetch(fetcher: typeof fetch): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

const photo = {
  id: "photo-1",
  name: "记忆.jpg",
  src: "/media/photo-1",
  hasOriginal: true,
  libraryMember: true,
  activeMemoryCount: 1,
  memoryTitles: ["童年"],
  stageIds: ["stage-1"],
};

test("listPhotos owns photo catalog query construction and decoding", async () => {
  let requestedUrl = "";
  const restore = replaceFetch(async (input) => {
    requestedUrl = String(input);
    return Response.json({ items: [photo], nextCursor: "next-page" });
  });
  try {
    const page = await listPhotos({
      source: "library",
      usage: "used",
      query: "  童年  ",
      stageId: "stage-1",
      cursor: "cursor-1",
      limit: 24,
    });
    assert.deepEqual(page, { items: [photo], nextCursor: "next-page" });
    const url = new URL(requestedUrl, "http://localhost");
    assert.equal(url.pathname, "/api/photos");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      source: "library",
      usage: "used",
      q: "童年",
      stageId: "stage-1",
      cursor: "cursor-1",
      limit: "24",
    });
  } finally {
    restore();
  }
});

test("listPhotoIds requests the bounded selection response", async () => {
  let requestedUrl = "";
  const restore = replaceFetch(async (input) => {
    requestedUrl = String(input);
    return Response.json({ ids: ["photo-1", "photo-2"] });
  });
  try {
    assert.deepEqual(await listPhotoIds({ source: "recent", limit: 24 }), ["photo-1", "photo-2"]);
    const url = new URL(requestedUrl, "http://localhost");
    assert.equal(url.searchParams.get("selection"), "ids");
  } finally {
    restore();
  }
});

test("photo mutations centralize methods and batch-delete response mapping", async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const restore = replaceFetch(async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    if (init?.method === "DELETE" && String(input) === "/api/photos") {
      return Response.json({
        deletedIds: ["photo-1"],
        failures: [
          {
            photoId: "photo-2",
            name: "仍被引用.jpg",
            error: "PHOTO_IN_USE",
            details: {
              references: {
                memories: [{ id: "memory-1", title: "童年", isCover: true }],
                stages: [],
              },
            },
          },
        ],
      });
    }
    return Response.json(
      String(input).endsWith("/archive")
        ? { archived: true }
        : { deleted: true, alreadyDeleted: false },
    );
  });
  try {
    const batch = await deletePhotos(["photo-1", "photo-2"]);
    await archivePhoto("photo/3");
    await deletePhoto("photo/4");

    assert.deepEqual(batch.failures[0].references, {
      memories: [{ id: "memory-1", title: "童年", isCover: true }],
      stages: [],
    });
    assert.deepEqual(requests, [
      {
        url: "/api/photos",
        method: "DELETE",
        body: { ids: ["photo-1", "photo-2"] },
      },
      { url: "/api/photos/photo%2F3/archive", method: "POST", body: null },
      { url: "/api/photos/photo%2F4", method: "DELETE", body: null },
    ]);
  } finally {
    restore();
  }
});

test("deletePhoto preserves structured PHOTO_IN_USE details", async () => {
  const restore = replaceFetch(async () =>
    Response.json(
      {
        error: "PHOTO_IN_USE",
        details: {
          references: {
            memories: [{ id: "memory-1", title: "童年", isCover: false }],
            stages: [{ id: "stage-1", title: "小学" }],
          },
        },
      },
      { status: 409 },
    ),
  );
  try {
    await assert.rejects(deletePhoto("photo-1"), (error: unknown) => {
      assert.equal(error instanceof ClientApiError, true);
      if (!(error instanceof ClientApiError)) return false;
      assert.equal(error.code, "PHOTO_IN_USE");
      assert.deepEqual(error.details, {
        references: {
          memories: [{ id: "memory-1", title: "童年", isCover: false }],
          stages: [{ id: "stage-1", title: "小学" }],
        },
      });
      return true;
    });
  } finally {
    restore();
  }
});
