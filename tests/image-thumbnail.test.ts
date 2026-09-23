import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  LocalImageStorage,
  readOrCreateImagePreview,
  resolveImagePreviewPath,
} from "../src/storage/local-image-storage.ts";
import { imageVariantUrl } from "../src/components/image-variant-url.ts";

test("thumbnail URLs preserve sharing tokens and leave demo assets unchanged", () => {
  const photo = "/media/uploads/owner/optimized/123.webp";
  assert.equal(imageVariantUrl(photo), `${photo}?variant=thumbnail`);
  assert.equal(imageVariantUrl(photo, "preview"), `${photo}?variant=preview`);
  assert.equal(imageVariantUrl(`${photo}?share=secret`), `${photo}?share=secret&variant=thumbnail`);
  assert.equal(imageVariantUrl("/images/demo/cover.svg"), "/images/demo/cover.svg");
});

test("old optimized photos gain a cached thumbnail that refreshes when changed", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-thumbnail-"));
  const imagePath = path.join(directory, "photo.webp");
  const thumbnailPath = path.join(directory, "thumbnail.webp");
  const previewPath = path.join(directory, "preview.webp");
  try {
    const first = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: "#705742" },
    })
      .webp()
      .toBuffer();
    writeFileSync(imagePath, first);
    const thumbnail = await readOrCreateImagePreview(
      imagePath,
      thumbnailPath,
      statSync(imagePath).mtimeMs,
      "thumbnail",
    );
    assert.equal((await sharp(thumbnail).metadata()).width, 640);
    const preview = await readOrCreateImagePreview(
      imagePath,
      previewPath,
      statSync(imagePath).mtimeMs,
      "preview",
    );
    assert.equal((await sharp(preview).metadata()).width, 1440);
    assert.deepEqual(
      await readOrCreateImagePreview(
        imagePath,
        thumbnailPath,
        statSync(imagePath).mtimeMs,
        "thumbnail",
      ),
      thumbnail,
    );

    const changed = await sharp({
      create: { width: 800, height: 800, channels: 3, background: "#235f70" },
    })
      .webp()
      .toBuffer();
    writeFileSync(imagePath, changed);
    const later = new Date(Date.now() + 10_000);
    utimesSync(imagePath, later, later);
    const refreshed = await readOrCreateImagePreview(
      imagePath,
      thumbnailPath,
      statSync(imagePath).mtimeMs,
      "thumbnail",
    );
    assert.equal((await sharp(refreshed).metadata()).height, 640);
    assert.notDeepEqual(refreshed, thumbnail);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("removing an optimized photo also removes its generated previews", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-preview-delete-"));
  const previousDataDirectory = process.env.MEMORY_PALACE_DATA_DIR;
  const key = "uploads/owner/optimized/12345678-1234-1234-1234-123456789abc.webp";
  const imagePath = path.join(directory, "images", ...key.split("/"));
  try {
    process.env.MEMORY_PALACE_DATA_DIR = directory;
    mkdirSync(path.dirname(imagePath), { recursive: true });
    const previewPaths = [
      resolveImagePreviewPath(key, "thumbnail"),
      resolveImagePreviewPath(key, "preview"),
    ];
    for (const filePath of [imagePath, ...previewPaths]) {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, "image");
    }
    await new LocalImageStorage().remove([key]);
    for (const filePath of [imagePath, ...previewPaths]) {
      assert.equal(existsSync(filePath), false);
    }
  } finally {
    if (previousDataDirectory === undefined) delete process.env.MEMORY_PALACE_DATA_DIR;
    else process.env.MEMORY_PALACE_DATA_DIR = previousDataDirectory;
    rmSync(directory, { recursive: true, force: true });
  }
});
