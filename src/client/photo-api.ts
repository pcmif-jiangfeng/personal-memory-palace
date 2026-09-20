import { ClientApiError, requestJson } from "./http-client.ts";
import type {
  PhotoBatchDeleteResult,
  PhotoCatalogPage,
  PhotoCatalogQuery,
  PhotoMemoryReference,
  PhotoReferences,
  PhotoStageReference,
  WorkspacePhotoView,
} from "../contracts/photo.ts";

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object");
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Expected a string");
  return value;
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new TypeError("Expected a boolean");
  return value;
}

function readNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("Expected a finite number");
  }
  return value;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new TypeError("Expected an array");
  return value.map(readString);
}

function readWorkspacePhoto(value: unknown): WorkspacePhotoView {
  const photo = readRecord(value);
  return {
    id: readString(photo.id),
    name: readString(photo.name),
    src: readString(photo.src),
    hasOriginal: readBoolean(photo.hasOriginal),
    libraryMember: readBoolean(photo.libraryMember),
    activeMemoryCount: readNumber(photo.activeMemoryCount),
    memoryTitles: readStringArray(photo.memoryTitles),
    stageIds: readStringArray(photo.stageIds),
  };
}

function readMemoryReference(value: unknown): PhotoMemoryReference {
  const reference = readRecord(value);
  return {
    id: readString(reference.id),
    title: readString(reference.title),
    isCover: readBoolean(reference.isCover),
  };
}

function readStageReference(value: unknown): PhotoStageReference {
  const reference = readRecord(value);
  return {
    id: readString(reference.id),
    title: readString(reference.title),
  };
}

function readPhotoReferences(value: unknown): PhotoReferences {
  const references = readRecord(value);
  if (!Array.isArray(references.memories) || !Array.isArray(references.stages)) {
    throw new TypeError("Expected photo references");
  }
  return {
    memories: references.memories.map(readMemoryReference),
    stages: references.stages.map(readStageReference),
  };
}

function readPhotoCatalogPage(value: unknown): PhotoCatalogPage {
  const page = readRecord(value);
  if (!Array.isArray(page.items)) throw new TypeError("Expected photo items");
  if (page.nextCursor !== null && typeof page.nextCursor !== "string") {
    throw new TypeError("Expected a cursor or null");
  }
  return {
    items: page.items.map(readWorkspacePhoto),
    nextCursor: page.nextCursor,
  };
}

function photoCatalogUrl(query: PhotoCatalogQuery, selection?: "ids"): string {
  const parameters = new URLSearchParams({
    source: query.source,
    limit: String(query.limit),
  });
  if (query.source === "library") {
    parameters.set("usage", query.usage ?? "all");
    const normalizedQuery = query.query?.trim();
    if (normalizedQuery) parameters.set("q", normalizedQuery);
    if (query.stageId) parameters.set("stageId", query.stageId);
  }
  if (query.cursor) parameters.set("cursor", query.cursor);
  if (selection) parameters.set("selection", selection);
  return `/api/photos?${parameters}`;
}

export function listPhotos(
  query: PhotoCatalogQuery,
  signal?: AbortSignal,
): Promise<PhotoCatalogPage> {
  return requestJson(photoCatalogUrl(query), { signal }, readPhotoCatalogPage);
}

export function listPhotoIds(query: PhotoCatalogQuery): Promise<string[]> {
  return requestJson(photoCatalogUrl(query, "ids"), undefined, (value) => {
    const result = readRecord(value);
    return readStringArray(result.ids);
  });
}

export function deletePhotos(ids: string[]): Promise<PhotoBatchDeleteResult> {
  return requestJson(
    "/api/photos",
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    },
    (value) => {
      const result = readRecord(value);
      const deletedIds = readStringArray(result.deletedIds);
      if (!Array.isArray(result.failures)) throw new TypeError("Expected deletion failures");
      return {
        deletedIds,
        failures: result.failures.map((failureValue) => {
          const failure = readRecord(failureValue);
          const details =
            typeof failure.details === "object" && failure.details !== null
              ? readRecord(failure.details)
              : undefined;
          return {
            photoId: readString(failure.photoId),
            error: readString(failure.error),
            ...(typeof failure.name === "string" ? { name: failure.name } : {}),
            ...(details?.references ? { references: readPhotoReferences(details.references) } : {}),
          };
        }),
      };
    },
  );
}

export function archivePhoto(photoId: string): Promise<void> {
  return requestJson(
    `/api/photos/${encodeURIComponent(photoId)}/archive`,
    { method: "POST" },
    (value) => {
      const result = readRecord(value);
      if (result.archived !== true) throw new TypeError("Expected archived photo response");
    },
  );
}

export function deletePhoto(photoId: string): Promise<void> {
  return requestJson(
    `/api/photos/${encodeURIComponent(photoId)}`,
    { method: "DELETE" },
    (value) => {
      const result = readRecord(value);
      if (typeof result.deleted !== "boolean" || typeof result.alreadyDeleted !== "boolean") {
        throw new TypeError("Expected deleted photo response");
      }
    },
  );
}

export function referencesFromPhotoError(error: unknown): PhotoReferences | undefined {
  if (!(error instanceof ClientApiError) || error.code !== "PHOTO_IN_USE") return undefined;
  try {
    return readPhotoReferences(error.details?.references);
  } catch {
    return undefined;
  }
}
