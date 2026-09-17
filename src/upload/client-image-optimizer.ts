export const clientImageMaximumDimension = 2560;
export const clientImageWebpQuality = 0.82;
export const maximumOptimizedUploadBytes = 20 * 1024 * 1024;

const acceptedSourceTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export class ImageOptimizationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export function calculateTargetDimensions(
  width: number,
  height: number,
  maximumDimension = clientImageMaximumDimension,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ImageOptimizationError("INVALID_DIMENSIONS");
  }
  const scale = Math.min(1, maximumDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
}

async function loadWithImageElement(file: File, signal: AbortSignal): Promise<HTMLImageElement> {
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    throwIfAborted(signal);
    return image;
  } catch (error) {
    URL.revokeObjectURL(source);
    throw error;
  }
}

export async function optimizeImageForUpload(file: File, signal: AbortSignal): Promise<Blob> {
  if (file.size === 0) throw new ImageOptimizationError("EMPTY_FILE");
  if (!acceptedSourceTypes.has(file.type)) {
    throw new ImageOptimizationError("UNSUPPORTED_TYPE");
  }
  throwIfAborted(signal);

  let bitmap: ImageBitmap | null = null;
  let image: HTMLImageElement | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } else {
      image = await loadWithImageElement(file, signal);
    }
    throwIfAborted(signal);

    const sourceWidth = bitmap?.width ?? image?.naturalWidth ?? 0;
    const sourceHeight = bitmap?.height ?? image?.naturalHeight ?? 0;
    const target = calculateTargetDimensions(sourceWidth, sourceHeight);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new ImageOptimizationError("CANVAS_UNAVAILABLE");
    context.drawImage(bitmap ?? image!, 0, 0, target.width, target.height);
    throwIfAborted(signal);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", clientImageWebpQuality),
    );
    throwIfAborted(signal);
    if (!blob || blob.type !== "image/webp") {
      throw new ImageOptimizationError("WEBP_UNAVAILABLE");
    }
    if (blob.size > maximumOptimizedUploadBytes) {
      throw new ImageOptimizationError("OPTIMIZED_TOO_LARGE");
    }
    return blob;
  } catch (error) {
    if (
      error instanceof ImageOptimizationError ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw error;
    }
    throw new ImageOptimizationError("DECODE_FAILED");
  } finally {
    bitmap?.close();
    if (image) URL.revokeObjectURL(image.src);
  }
}
