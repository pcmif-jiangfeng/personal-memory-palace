import assert from "node:assert/strict";
import test from "node:test";
import { removePhotoSelections } from "../src/components/photo-selection.ts";
import { removeBatchDeletedPhotos } from "../src/components/photo-workspace-state.ts";

const photos = [
  {
    id: "deleted-photo",
    name: "可删除.jpg",
    src: "/media/deleted-photo",
    hasOriginal: false,
    libraryMember: true,
    activeMemoryCount: 0,
    memoryTitles: [],
    stageIds: [],
  },
  {
    id: "referenced-photo",
    name: "仍被引用.jpg",
    src: "/media/referenced-photo",
    hasOriginal: false,
    libraryMember: true,
    activeMemoryCount: 1,
    memoryTitles: ["大学时光"],
    stageIds: [],
  },
];

test("keeps a failed batch deletion selected while removing the successful photo", () => {
  const selected = new Set(photos.map((photo) => photo.id));
  const apiResult = {
    deletedIds: ["deleted-photo"],
    failures: [
      {
        photoId: "referenced-photo",
        name: "仍被引用.jpg",
        error: "PHOTO_IN_USE",
      },
    ],
  };

  assert.deepEqual(
    removeBatchDeletedPhotos(photos, apiResult).map((photo) => photo.id),
    ["referenced-photo"],
  );
  assert.deepEqual(
    [...removePhotoSelections(selected, apiResult.deletedIds)],
    ["referenced-photo"],
  );
});
