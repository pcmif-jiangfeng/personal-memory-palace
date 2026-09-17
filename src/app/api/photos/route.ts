import { NextResponse } from "next/server";
import { addUploadedPhotos } from "@/data/photo-repository";
import { maximumUploadBytes, validateWebOptimizedImage } from "@/storage/image-processor";
import { imageStorage } from "@/storage/local-image-storage";
import { isOwner } from "@/auth";
import { ownerRequiredResponse } from "@/http/api-error";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isOwner())) return ownerRequiredResponse();
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumUploadBytes + 1024 * 1024) {
    return NextResponse.json({ error: "OPTIMIZED_IMAGE_TOO_LARGE" }, { status: 413 });
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "INVALID_FORM_DATA" }, { status: 400 });
  }
  const files = formData.getAll("photos").filter((value): value is File => value instanceof File);
  if (files.length !== 1) {
    return NextResponse.json({ error: "PHOTOS_REQUIRED" }, { status: 400 });
  }
  const file = files[0];
  if (file.size > maximumUploadBytes) {
    return NextResponse.json({ error: "OPTIMIZED_IMAGE_TOO_LARGE" }, { status: 413 });
  }

  let validated: Awaited<ReturnType<typeof validateWebOptimizedImage>>;
  try {
    validated = await validateWebOptimizedImage(Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json({ error: "INVALID_OPTIMIZED_IMAGE" }, { status: 422 });
  }

  let saved: Awaited<ReturnType<typeof imageStorage.saveOptimized>> | null = null;
  try {
    saved = await imageStorage.saveOptimized(validated);
    const requestedName = formData.get("originalName");
    const originalName =
      typeof requestedName === "string" && requestedName.trim()
        ? requestedName.trim().slice(0, 255)
        : "未命名照片.webp";
    const photos = addUploadedPhotos([{ originalName, mimeType: "image/webp", saved }]);
    return NextResponse.json({ photos }, { status: 201 });
  } catch {
    if (saved) await imageStorage.remove([saved.optimizedStorageKey]);
    return NextResponse.json({ error: "IMAGE_STORAGE_FAILED" }, { status: 500 });
  }
}
