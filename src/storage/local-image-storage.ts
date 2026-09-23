import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDataDirectory } from "../config.ts";
import { getDataset } from "../data/database.ts";
import type {
  ImageStorage,
  SaveImageInput,
  SaveOptimizedImageInput,
  SavedImage,
  StoredImage,
} from "./image-storage.ts";
import {
  createWebOptimizedImage,
  createWebPreview,
  extensionForMimeType,
  type ImagePreviewVariant,
} from "./image-processor.ts";

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

export function resolveImagePreviewPath(key: string, variant: ImagePreviewVariant): string {
  return resolveStoredImagePath(`cache/${key}.${variant}.webp`);
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

export async function readOrCreateImagePreview(
  imagePath: string,
  previewPath: string,
  sourceModifiedAt: number,
  variant: ImagePreviewVariant,
): Promise<Buffer> {
  try {
    const cached = await stat(previewPath);
    if (cached.mtimeMs >= sourceModifiedAt) return await readFile(previewPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const preview = await createWebPreview(await readFile(imagePath), variant);
  await writeAtomically(previewPath, preview);
  return preview;
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
          const imagePath = resolveStoredImagePath(key);
          await rm(imagePath, { force: true });
          if (/^uploads\/(demo|owner)\/optimized\/[0-9a-f-]+\.webp$/.test(key)) {
            await Promise.all(
              (["thumbnail", "preview"] as const).map((variant) =>
                rm(resolveImagePreviewPath(key, variant), { force: true }),
              ),
            );
          }
        }),
    );
  }
}

export const imageStorage = new LocalImageStorage();
