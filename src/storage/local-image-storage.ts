import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDataset } from "@/data/database";
import type { ImageStorage, SaveImageInput, SavedImage, StoredImage } from "./image-storage";
import { createWebOptimizedImage, extensionForMimeType } from "./image-processor";

export function getImageDataDirectory(): string {
  const dataDirectory = process.env.MEMORY_PALACE_DATA_DIR
    ? path.resolve(/* turbopackIgnore: true */ process.env.MEMORY_PALACE_DATA_DIR)
    : path.join(process.cwd(), "data");
  return path.join(/* turbopackIgnore: true */ dataDirectory, "images");
}

export function resolveStoredImagePath(key: string): string {
  const root = getImageDataDirectory();
  const resolved = path.resolve(root, key);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid image storage key");
  }
  return resolved;
}

export class LocalImageStorage implements ImageStorage {
  resolve(key: string): StoredImage {
    const publicPath = key.startsWith("demo/") && key.endsWith(".svg")
      ? `/images/${key}`
      : `/media/${key.split("/").map(encodeURIComponent).join("/")}`;
    return { key, publicPath };
  }

  async save(input: SaveImageInput): Promise<SavedImage> {
    const id = randomUUID();
    const optimized = await createWebOptimizedImage(input.data);
    const optimizedStorageKey = `uploads/${getDataset()}/optimized/${id}.webp`;
    const optimizedPath = resolveStoredImagePath(optimizedStorageKey);
    await mkdir(path.dirname(optimizedPath), { recursive: true });
    await writeFile(optimizedPath, optimized.data);

    let originalStorageKey: string | null = null;
    if (input.preserveOriginal) {
      originalStorageKey = `uploads/${getDataset()}/original/${id}${extensionForMimeType(input.mimeType)}`;
      const originalPath = resolveStoredImagePath(originalStorageKey);
      await mkdir(path.dirname(originalPath), { recursive: true });
      await writeFile(originalPath, input.data);
    }

    return {
      optimizedStorageKey,
      originalStorageKey,
      width: optimized.width,
      height: optimized.height,
    };
  }

  async remove(keys: Array<string | null>): Promise<void> {
    await Promise.all(keys.filter((key): key is string => Boolean(key)).map(async (key) => {
      await rm(resolveStoredImagePath(key), { force: true });
    }));
  }
}

export const imageStorage = new LocalImageStorage();
