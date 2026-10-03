import { NextResponse } from "next/server";
import {
  listUploadedPhotosByIds,
  queryWorkspacePhotoCatalog,
  type PhotoCatalogQuery,
} from "@/data/photo-repository";
import { maximumUploadBytes } from "@/storage/image-processor";
import { imageStorage } from "@/storage/local-image-storage";
import { trashScopedPhotos } from "@/data/photo-trash";
import { getDatabase } from "@/data/database";
import { memoryRequestScope } from "@/memory-request-scope";
import { parsePhotoBatchDelete } from "@/http/schemas";
import { uploadScopedPhoto } from "@/application/scoped-photo-upload";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = await memoryRequestScope(request);
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
      (selection !== null && selection !== "ids") ||
      (searchParams.get("q")?.length ?? 0) > 1000 ||
      (searchParams.get("cursor")?.length ?? 0) > 1000
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
    if (selection === "ids") {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = queryWorkspacePhotoCatalog({ ...query, limit: 60, cursor }, scope.museumId);
        ids.push(...page.items.map((photo) => photo.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return NextResponse.json({ ids }, { headers: { "Cache-Control": "no-store" } });
    }
    const page = queryWorkspacePhotoCatalog(query, scope.museumId);
    return NextResponse.json(
      {
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
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, "photos:list");
  }
}

export async function DELETE(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const scope = await memoryRequestScope(request);
    const input = await parsePhotoBatchDelete(request);
    const names = new Map(
      listUploadedPhotosByIds(input.ids, scope.museumId).map((photo) => [
        photo.id,
        photo.originalName,
      ]),
    );
    const result = trashScopedPhotos(getDatabase(), scope, input.ids);
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
  try {
    const scope = await memoryRequestScope(request);
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maximumUploadBytes + 1024 * 1024)
      return NextResponse.json({ error: "OPTIMIZED_IMAGE_TOO_LARGE" }, { status: 413 });
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "INVALID_FORM_DATA" }, { status: 400 });
    }
    const files = formData.getAll("photos").filter((value): value is File => value instanceof File);
    if (files.length !== 1) return NextResponse.json({ error: "PHOTOS_REQUIRED" }, { status: 400 });
    const file = files[0];
    if (file.size > maximumUploadBytes)
      return NextResponse.json({ error: "OPTIMIZED_IMAGE_TOO_LARGE" }, { status: 413 });
    let data: Buffer;
    try {
      data = Buffer.from(await file.arrayBuffer());
    } catch {
      return NextResponse.json({ error: "INVALID_OPTIMIZED_IMAGE" }, { status: 422 });
    }
    const requestedName = formData.get("originalName");
    const result = await uploadScopedPhoto(getDatabase(), scope, {
      data,
      requestedName: typeof requestedName === "string" ? requestedName : null,
    });
    if (!result.ok)
      return NextResponse.json(
        { error: result.error },
        { status: result.error === "INVALID_OPTIMIZED_IMAGE" ? 422 : 500 },
      );
    return NextResponse.json(
      { photos: [result.photo] },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, "photos:upload");
  }
}
