import { randomUUID } from "node:crypto";
import { getDataset } from "../data/database.ts";
import { commitOptimizedUpload, prepareOptimizedUpload } from "../data/photo-repository.ts";
import type { UploadedPhoto } from "../domain/models.ts";
import type { SaveOptimizedImageInput, SavedImage } from "../storage/image-storage.ts";
import { validateWebOptimizedImage } from "../storage/image-processor.ts";
import { imageStorage } from "../storage/local-image-storage.ts";

export interface PhotoUploadDependencies {
  createStorageKey: () => string;
  validate: (data: Buffer) => Promise<SaveOptimizedImageInput>;
  prepare: (storageKey: string) => string;
  save: (image: SaveOptimizedImageInput, storageKey: string) => Promise<SavedImage>;
  commit: (
    operationId: string,
    item: { originalName: string; mimeType: string; saved: SavedImage },
  ) => UploadedPhoto;
}

export type PhotoUploadResult =
  | { ok: true; photo: UploadedPhoto }
  | { ok: false; error: "INVALID_OPTIMIZED_IMAGE" | "IMAGE_STORAGE_FAILED" };

const defaultDependencies: PhotoUploadDependencies = {
  createStorageKey: () => `uploads/${getDataset()}/optimized/${randomUUID()}.webp`,
  validate: validateWebOptimizedImage,
  prepare: prepareOptimizedUpload,
  save: (image, storageKey) => imageStorage.saveOptimized(image, storageKey),
  commit: commitOptimizedUpload,
};

function normalizeOriginalName(requestedName: string | null): string {
  return requestedName?.trim().slice(0, 255) || "未命名照片.webp";
}

export async function uploadOptimizedPhoto(
  input: { data: Buffer; requestedName: string | null },
  dependencies: PhotoUploadDependencies = defaultDependencies,
): Promise<PhotoUploadResult> {
  let validated: SaveOptimizedImageInput;
  try {
    validated = await dependencies.validate(input.data);
  } catch {
    return { ok: false, error: "INVALID_OPTIMIZED_IMAGE" };
  }

  try {
    const storageKey = dependencies.createStorageKey();
    const operationId = dependencies.prepare(storageKey);
    const saved = await dependencies.save(validated, storageKey);
    const photo = dependencies.commit(operationId, {
      originalName: normalizeOriginalName(input.requestedName),
      mimeType: "image/webp",
      saved,
    });
    return { ok: true, photo };
  } catch {
    return { ok: false, error: "IMAGE_STORAGE_FAILED" };
  }
}
