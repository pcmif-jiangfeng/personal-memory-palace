import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDataDirectory } from "../config.ts";
import { getDataset } from "@/data/database";
import type {
  ImageStorage,
  SaveImageInput,
  SaveOptimizedImageInput,
  SavedImage,
  StoredImage,
} from "./image-storage";
import { createWebOptimizedImage, extensionForMimeType } from "./image-processor";

export function getImageDataDirectory(): string {
  return path.join(/* turbopackIgnore: true */ getDataDirectory(), "images");
}

export function resolveStoredImagePath(key: string): string {
  const root = getImageDataDirectory();
  const resolved = path.resolve(root, key);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid image storage key");
  }
  return resolved;
}

async function writeAtomically(filePath: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, data, { flag: "wx" });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export class LocalImageStorage implements ImageStorage {
  resolve(key: string): StoredImage {
    const publicPath =
      key.startsWith("demo/") && key.endsWith(".svg")
        ? `/images/${key}`
        : `/media/${key.split("/").map(encodeURIComponent).join("/")}`;
    return { key, publicPath };
  }

  async save(input: SaveImageInput): Promise<SavedImage> {
    const id = randomUUID();
    const writtenKeys: string[] = [];
    let optimizedStorageKey = "";
    let originalStorageKey: string | null = null;
    try {
      const optimized = await createWebOptimizedImage(input.data);
      optimizedStorageKey = `uploads/${getDataset()}/optimized/${id}.webp`;
      await writeAtomically(resolveStoredImagePath(optimizedStorageKey), optimized.data);
      writtenKeys.push(optimizedStorageKey);

      if (input.preserveOriginal) {
        originalStorageKey = `uploads/${getDataset()}/original/${id}${extensionForMimeType(input.mimeType)}`;
        await writeAtomically(resolveStoredImagePath(originalStorageKey), input.data);
        writtenKeys.push(originalStorageKey);
      }

      return {
        optimizedStorageKey,
        originalStorageKey,
        width: optimized.width,
        height: optimized.height,
      };
    } catch (error) {
      await this.remove(writtenKeys);
      throw error;
    }
  }

  async saveOptimized(input: SaveOptimizedImageInput, storageKey?: string): Promise<SavedImage> {
    const optimizedStorageKey =
      storageKey ?? `uploads/${getDataset()}/optimized/${randomUUID()}.webp`;
    try {
      await writeAtomically(resolveStoredImagePath(optimizedStorageKey), input.data);
      return {
        optimizedStorageKey,
        originalStorageKey: null,
        width: input.width,
        height: input.height,
      };
    } catch (error) {
      await this.remove([optimizedStorageKey]);
      throw error;
    }
  }

  async remove(keys: Array<string | null>): Promise<void> {
    await Promise.all(
      keys
        .filter((key): key is string => Boolean(key))
        .map(async (key) => {
          await rm(resolveStoredImagePath(key), { force: true });
        }),
    );
  }
}

export const imageStorage = new LocalImageStorage();
