import sharp from "sharp";

export const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
export const maximumUploadBytes = 20 * 1024 * 1024;
export const maximumUploadBatchBytes = 100 * 1024 * 1024;
export const maximumUploadFileCount = 20;

export interface OptimizedImage {
  data: Buffer;
  width: number;
  height: number;
}

export async function createWebOptimizedImage(data: Buffer): Promise<OptimizedImage> {
  const result = await sharp(data, { failOn: "error" })
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  if (!result.info.width || !result.info.height) {
    throw new Error("Unable to determine optimized image dimensions");
  }

  return { data: result.data, width: result.info.width, height: result.info.height };
}

export function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}
