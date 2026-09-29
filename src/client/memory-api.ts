import { requestJson } from "./http-client.ts";
import { memoryMuseumUrl } from "./memory-museum-url.ts";

export interface CreateMemoryInput {
  title: string;
  story: string;
  stageId: string | null;
  photoIds: string[];
  coverPhotoId: string;
  relatedMemoryIds: string[];
}

export interface MemoryDetailsInput {
  version: number;
  title: string;
  story: string;
  stageId: string | null;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object");
  }
  return value as Record<string, unknown>;
}

function decodeOk(value: unknown): void {
  if (readRecord(value).ok !== true) throw new TypeError("Expected a successful response");
}

function decodeMemoryVersion(value: unknown): number {
  const record = readRecord(value);
  decodeOk(value);
  if (!Number.isSafeInteger(record.version) || (record.version as number) < 1)
    throw new TypeError("Expected a Memory version");
  return record.version as number;
}

function performExhibitAction(
  memoryId: string,
  action: Record<string, unknown>,
  version: number,
  museumId?: string,
): Promise<number> {
  return requestJson(
    memoryMuseumUrl(`/api/memories/${encodeURIComponent(memoryId)}`, museumId),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...action, version }),
    },
    decodeMemoryVersion,
  );
}

function decodeCreatedMemory(value: unknown): { id: string } {
  const memory = readRecord(readRecord(value).memory);
  if (typeof memory.id !== "string") throw new TypeError("Expected a created memory");
  return { id: memory.id };
}

function decodeRecall(value: unknown): { id: string } | null {
  const memory = readRecord(value).memory;
  if (memory === null) return null;
  const record = readRecord(memory);
  if (typeof record.id !== "string") throw new TypeError("Expected a recalled memory");
  return { id: record.id };
}

function performMemoryAction(
  memoryId: string,
  action: Record<string, unknown>,
  museumId?: string,
): Promise<void> {
  return requestJson(
    memoryMuseumUrl(`/api/memories/${encodeURIComponent(memoryId)}`, museumId),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    },
    decodeOk,
  );
}

export function createMemory(input: CreateMemoryInput): Promise<{ id: string }> {
  return requestJson(
    memoryMuseumUrl("/api/memories"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    decodeCreatedMemory,
  );
}

export function updateMemoryDetails(memoryId: string, input: MemoryDetailsInput): Promise<number> {
  return requestJson(
    memoryMuseumUrl(`/api/memories/${encodeURIComponent(memoryId)}`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "details", ...input }),
    },
    decodeMemoryVersion,
  );
}

export function setMemoryPublic(memoryId: string, isPublic: boolean): Promise<void> {
  return performMemoryAction(memoryId, { action: "publication", isPublic });
}

export function addMemoryNote(memoryId: string, content: string): Promise<void> {
  return performMemoryAction(memoryId, { action: "note", content });
}

export function updateMemoryRelations(memoryId: string, relatedMemoryIds: string[]): Promise<void> {
  return performMemoryAction(memoryId, { action: "relations", relatedMemoryIds });
}

export function trashMemory(memoryId: string): Promise<void> {
  return performMemoryAction(memoryId, { action: "trash" });
}

export function addMemoryPhotos(
  memoryId: string,
  photoIds: string[],
  version: number,
  museumId?: string,
): Promise<number> {
  return performExhibitAction(memoryId, { action: "addPhotos", photoIds }, version, museumId);
}

export function removeMemoryPhoto(
  memoryId: string,
  photoId: string,
  version: number,
  museumId?: string,
): Promise<number> {
  return performExhibitAction(memoryId, { action: "removePhoto", photoId }, version, museumId);
}

export function reorderMemoryPhotos(
  memoryId: string,
  photoIds: string[],
  version: number,
  museumId?: string,
): Promise<number> {
  return performExhibitAction(memoryId, { action: "reorderPhotos", photoIds }, version, museumId);
}

export function setMemoryCover(
  memoryId: string,
  photoId: string,
  version: number,
  museumId?: string,
): Promise<number> {
  return performExhibitAction(memoryId, { action: "setCover", photoId }, version, museumId);
}

export function updateMemoryExhibitMetadata(
  memoryId: string,
  photoId: string,
  title: string,
  description: string,
  version: number,
  museumId?: string,
): Promise<number> {
  return performExhibitAction(
    memoryId,
    {
      action: "exhibitMetadata",
      photoId,
      title,
      description,
    },
    version,
    museumId,
  );
}

export function recallMemory(): Promise<{ id: string } | null> {
  return requestJson(memoryMuseumUrl("/api/recall"), { cache: "no-store" }, decodeRecall);
}
