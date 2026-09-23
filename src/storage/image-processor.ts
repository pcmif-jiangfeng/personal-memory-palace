import sharp from "sharp";

export const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
export const maximumUploadBytes = 20 * 1024 * 1024;
export const maximumUploadBatchBytes = 100 * 1024 * 1024;
export const maximumUploadFileCount = 20;
export const maximumOptimizedDimension = 2560;

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

export type ImagePreviewVariant = "thumbnail" | "preview";

export async function createWebPreview(
  data: Buffer,
  variant: ImagePreviewVariant,
): Promise<Buffer> {
  const maxDimension = variant === "thumbnail" ? 640 : 1440;
  const quality = variant === "thumbnail" ? 74 : 78;
  return sharp(data, { failOn: "error" })
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toBuffer();
}

export async function validateWebOptimizedImage(data: Buffer): Promise<OptimizedImage> {
  if (data.length === 0 || data.length > maximumUploadBytes) {
    throw new Error("Invalid optimized image size");
  }
  const image = sharp(data, { failOn: "error", limitInputPixels: maximumOptimizedDimension ** 2 });
  const metadata = await image.metadata();
  if (
    metadata.format !== "webp" ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > maximumOptimizedDimension ||
    metadata.height > maximumOptimizedDimension ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new Error("Invalid optimized image");
  }
  await image.clone().raw().toBuffer();
  return { data, width: metadata.width, height: metadata.height };
}

export function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}
