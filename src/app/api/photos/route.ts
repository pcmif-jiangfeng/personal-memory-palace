import { NextResponse } from "next/server";
import { addUploadedPhotos } from "@/data/photo-repository";
import {
  maximumUploadBatchBytes,
  maximumUploadBytes,
  maximumUploadFileCount,
  supportedImageTypes,
} from "@/storage/image-processor";
import { imageStorage } from "@/storage/local-image-storage";
import { isOwner } from "@/auth";
import { ownerRequiredResponse } from "@/http/api-error";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isOwner())) return ownerRequiredResponse();
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumUploadBatchBytes + 1024 * 1024) {
    return NextResponse.json({ error: "UPLOAD_BATCH_TOO_LARGE" }, { status: 413 });
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "INVALID_FORM_DATA" }, { status: 400 });
  }
  const files = formData.getAll("photos").filter((value): value is File => value instanceof File);
  const preserveOriginal = formData.get("preserveOriginal") === "true";
  if (files.length === 0) {
    return NextResponse.json({ error: "PHOTOS_REQUIRED" }, { status: 400 });
  }
  if (
    files.length > maximumUploadFileCount ||
    files.reduce((sum, file) => sum + file.size, 0) > maximumUploadBatchBytes
  ) {
    return NextResponse.json({ error: "UPLOAD_BATCH_TOO_LARGE" }, { status: 413 });
  }
  const invalid = files.find(
    (file) => !supportedImageTypes.has(file.type) || file.size > maximumUploadBytes,
  );
  if (invalid) {
    return NextResponse.json({ error: "INVALID_IMAGE", file: invalid.name }, { status: 400 });
  }

  const stored: Array<{
    originalName: string;
    mimeType: string;
    saved: Awaited<ReturnType<typeof imageStorage.save>>;
  }> = [];
  try {
    for (const file of files) {
      const saved = await imageStorage.save({
        data: Buffer.from(await file.arrayBuffer()),
        originalName: file.name,
        mimeType: file.type,
        preserveOriginal,
      });
      stored.push({ originalName: file.name, mimeType: file.type, saved });
    }
    const photos = addUploadedPhotos(stored);
    return NextResponse.json({ photos }, { status: 201 });
  } catch {
    await imageStorage.remove(
      stored.flatMap(({ saved }) => [saved.optimizedStorageKey, saved.originalStorageKey]),
    );
    return NextResponse.json({ error: "IMAGE_PROCESSING_FAILED" }, { status: 422 });
  }
}
