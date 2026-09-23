import assert from "node:assert/strict";
import test from "node:test";
import {
  initialUploadTaskState,
  uploadTaskReducer,
  type UploadBatch,
} from "../src/upload/upload-task-reducer.ts";

function batch(overrides: Partial<UploadBatch> = {}): UploadBatch {
  return {
    id: "batch-1",
    createdAt: "10:30",
    expanded: false,
    items: [
      { id: "item-1", name: "one.jpg", status: "waiting" },
      { id: "item-2", name: "two.jpg", status: "uploading" },
    ],
    ...overrides,
  };
}

test("prepends a new upload batch without mutating existing state", () => {
  const existing = batch({ id: "existing" });
  const added = batch({ id: "added" });

  const next = uploadTaskReducer([existing], { type: "add-batch", batch: added });

  assert.deepEqual(
    next.map((entry) => entry.id),
    ["added", "existing"],
  );
  assert.equal(next[1], existing);
});

test("patches only the requested upload item", () => {
  const original = batch();

  const next = uploadTaskReducer([original], {
    type: "patch-item",
    batchId: "batch-1",
    itemId: "item-2",
    patch: { status: "success", photoId: "photo-1", cancelRequested: false },
  });

  assert.equal(next[0].items[0], original.items[0]);
  assert.deepEqual(next[0].items[1], {
    id: "item-2",
    name: "two.jpg",
    status: "success",
    photoId: "photo-1",
    cancelRequested: false,
  });
  assert.equal(original.items[1].status, "uploading");
});

test("tracks queued upload progress while a second item is cancelled", () => {
  let state = uploadTaskReducer(initialUploadTaskState, {
    type: "add-batch",
    batch: batch({
      items: [
        { id: "item-1", name: "one.jpg", status: "waiting" },
        { id: "item-2", name: "two.jpg", status: "waiting" },
      ],
    }),
  });

  state = uploadTaskReducer(state, {
    type: "patch-item",
    batchId: "batch-1",
    itemId: "item-1",
    patch: { status: "compressing" },
  });
  state = uploadTaskReducer(state, {
    type: "patch-item",
    batchId: "batch-1",
    itemId: "item-2",
    patch: { status: "cancelled", cancelRequested: false },
  });
  state = uploadTaskReducer(state, {
    type: "patch-item",
    batchId: "batch-1",
    itemId: "item-1",
    patch: { status: "uploading" },
  });
  state = uploadTaskReducer(state, {
    type: "patch-item",
    batchId: "batch-1",
    itemId: "item-1",
    patch: { status: "success", photoId: "photo-1", cancelRequested: false },
  });

  assert.deepEqual(
    state[0].items.map((item) => ({ id: item.id, status: item.status, photoId: item.photoId })),
    [
      { id: "item-1", status: "success", photoId: "photo-1" },
      { id: "item-2", status: "cancelled", photoId: undefined },
    ],
  );
});
test("toggles batch expansion independently", () => {
  const first = batch({ id: "first", expanded: false });
  const second = batch({ id: "second", expanded: true });

  const next = uploadTaskReducer([first, second], {
    type: "toggle-batch",
    batchId: "first",
  });

  assert.equal(next[0].expanded, true);
  assert.equal(next[1], second);
});

test("dismisses only batches whose items are all finished", () => {
  const active = batch({ id: "active" });
  const finished = batch({
    id: "finished",
    items: [
      { id: "success", name: "done.jpg", status: "success" },
      { id: "failed", name: "bad.jpg", status: "failed" },
      { id: "cancelled", name: "skip.jpg", status: "cancelled" },
    ],
  });
  const state = [active, finished];

  const activeResult = uploadTaskReducer(state, {
    type: "dismiss-finished-batch",
    batchId: "active",
  });
  const finishedResult = uploadTaskReducer(state, {
    type: "dismiss-finished-batch",
    batchId: "finished",
  });

  assert.equal(activeResult, state);
  assert.deepEqual(finishedResult, [active]);
});

test("exposes an immutable empty initial state", () => {
  assert.deepEqual(initialUploadTaskState, []);
  assert.equal(Object.isFrozen(initialUploadTaskState), true);
});
