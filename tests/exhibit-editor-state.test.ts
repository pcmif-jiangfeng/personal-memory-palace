import assert from "node:assert/strict";
import test from "node:test";
import {
  createExhibitDraft,
  saveExhibitEditorMetadata,
  selectExhibitEditorPhoto,
  updateExhibitDraft,
} from "../src/components/use-exhibit-editor.ts";

const exhibits = [
  {
    photoId: "cover-photo",
    name: "封面.jpg",
    src: "/media/cover-photo",
    isCover: true,
    exhibitTitle: "封面说明",
    exhibitDescription: "旧说明",
  },
  {
    photoId: "lake-photo",
    name: "湖畔.jpg",
    src: "/media/lake-photo",
    isCover: false,
    exhibitTitle: "",
    exhibitDescription: "",
  },
];

test("selects an exhibit, edits its metadata and saves the selected photo", async () => {
  const selection = selectExhibitEditorPhoto({
    currentPhotoId: exhibits[0].photoId,
    targetPhoto: exhibits[1],
    metadataDirty: false,
    discardConfirmed: true,
  });
  assert.deepEqual(selection, {
    selectedPhotoId: "lake-photo",
    draft: createExhibitDraft(exhibits[1]),
  });

  const draft = updateExhibitDraft(selection!.draft, {
    title: "校园湖畔",
    description: "那天的云很低。",
  });
  const saved: Array<{ photoId: string; draft: typeof draft }> = [];

  assert.equal(
    await saveExhibitEditorMetadata(exhibits[1], draft, async (photoId, metadata) => {
      saved.push({ photoId, draft: metadata });
      return true;
    }),
    true,
  );
  assert.deepEqual(saved, [{ photoId: "lake-photo", draft }]);
});
