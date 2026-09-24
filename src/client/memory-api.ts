import { requestJson } from "./http-client.ts";

export interface CreateMemoryInput {
  title: string;
  story: string;
  stageId: string | null;
  photoIds: string[];
  coverPhotoId: string;
  relatedMemoryIds: string[];
}

export interface MemoryDetailsInput {
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

function performMemoryAction(memoryId: string, action: Record<string, unknown>): Promise<void> {
  return requestJson(
    `/api/memories/${encodeURIComponent(memoryId)}`,
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
    "/api/memories",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    decodeCreatedMemory,
  );
}

export function updateMemoryDetails(memoryId: string, input: MemoryDetailsInput): Promise<void> {
  return performMemoryAction(memoryId, { action: "details", ...input });
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

export function addMemoryPhotos(memoryId: string, photoIds: string[]): Promise<void> {
  return performMemoryAction(memoryId, { action: "addPhotos", photoIds });
}

export function removeMemoryPhoto(memoryId: string, photoId: string): Promise<void> {
  return performMemoryAction(memoryId, { action: "removePhoto", photoId });
}

export function reorderMemoryPhotos(memoryId: string, photoIds: string[]): Promise<void> {
  return performMemoryAction(memoryId, { action: "reorderPhotos", photoIds });
}

export function setMemoryCover(memoryId: string, photoId: string): Promise<void> {
  return performMemoryAction(memoryId, { action: "setCover", photoId });
}

export function updateMemoryExhibitMetadata(
  memoryId: string,
  photoId: string,
  title: string,
  description: string,
): Promise<void> {
  return performMemoryAction(memoryId, {
    action: "exhibitMetadata",
    photoId,
    title,
    description,
  });
}

export function recallMemory(): Promise<{ id: string } | null> {
  return requestJson("/api/recall", { cache: "no-store" }, decodeRecall);
}
