import { NextResponse } from "next/server";
import {
  commitOptimizedUpload,
  listUploadedPhotosByIds,
  prepareOptimizedUpload,
  queryWorkspacePhotoCatalog,
  type PhotoCatalogQuery,
} from "@/data/photo-repository";
import { getDataset } from "@/data/database";
import { randomUUID } from "node:crypto";
import { maximumUploadBytes, validateWebOptimizedImage } from "@/storage/image-processor";
import { imageStorage } from "@/storage/local-image-storage";
import { isOwner } from "@/auth";
import { deleteUploadedPhotos } from "@/data/photo-deletion";
import { parsePhotoBatchDelete } from "@/http/schemas";
import {
  apiErrorResponse,
  ownerRequiredResponse,
  sameOriginRequiredResponse,
} from "@/http/api-error";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await isOwner())) return ownerRequiredResponse();
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") ?? "recent";
  const usage = searchParams.get("usage") ?? "all";
  const selection = searchParams.get("selection");
  const requestedLimit = searchParams.get("limit");
  const limit = requestedLimit === null ? 40 : Number(requestedLimit);
  if (
    (source !== "recent" && source !== "library") ||
    (usage !== "all" && usage !== "used" && usage !== "unused") ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 60 ||
    (selection !== null && selection !== "ids")
  ) {
    return NextResponse.json({ error: "INVALID_PHOTO_QUERY" }, { status: 400 });
  }
  const query: PhotoCatalogQuery = {
    source,
    usage,
    limit,
    cursor: searchParams.get("cursor") || undefined,
    stageId: searchParams.get("stageId") || undefined,
    query: searchParams.get("q") || undefined,
  };
  try {
    if (selection === "ids") {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = queryWorkspacePhotoCatalog({ ...query, limit: 60, cursor });
        ids.push(...page.items.map((photo) => photo.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return NextResponse.json({ ids });
    }

    const page = queryWorkspacePhotoCatalog(query);
    return NextResponse.json({
      items: page.items.map((photo) => ({
        id: photo.id,
        name: photo.originalName,
        src: imageStorage.resolve(photo.optimizedStorageKey).publicPath,
        hasOriginal: Boolean(photo.originalStorageKey),
        libraryMember: photo.libraryMember,
        activeMemoryCount: photo.activeMemoryCount,
        memoryTitles: photo.memoryTitles,
        stageIds: photo.stageIds,
      })),
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    return apiErrorResponse(error, "photos:list");
  }
}

export async function DELETE(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  if (!(await isOwner())) return ownerRequiredResponse();
  try {
    const input = await parsePhotoBatchDelete(request);
    const names = new Map(
      listUploadedPhotosByIds(input.ids).map((photo) => [photo.id, photo.originalName]),
    );
    const result = await deleteUploadedPhotos(input.ids);
    return NextResponse.json({
      ...result,
      failures: result.failures.map((failure) => ({
        ...failure,
        name: names.get(failure.photoId) ?? failure.photoId,
      })),
    });
  } catch (error) {
    return apiErrorResponse(error, "photos:batch-delete");
  }
}

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
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
  const storageKey = `uploads/${getDataset()}/optimized/${randomUUID()}.webp`;
  const operationId = prepareOptimizedUpload(storageKey);
  try {
    saved = await imageStorage.saveOptimized(validated, storageKey);
    const requestedName = formData.get("originalName");
    const originalName =
      typeof requestedName === "string" && requestedName.trim()
        ? requestedName.trim().slice(0, 255)
        : "未命名照片.webp";
    const photo = commitOptimizedUpload(operationId, {
      originalName,
      mimeType: "image/webp",
      saved,
    });
    return NextResponse.json({ photos: [photo] }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "IMAGE_STORAGE_FAILED" }, { status: 500 });
  }
}
