import { requestJson } from "./http-client.ts";

export interface StageInput {
  title: string;
  description: string;
  coverPhotoId: string | null;
}

function decodeStageResponse(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected a stage response");
  }
  const stage = (value as Record<string, unknown>).stage;
  if (typeof stage !== "object" || stage === null || Array.isArray(stage)) {
    throw new TypeError("Expected a stage response");
  }
}

function decodeDeleteResponse(value: unknown): void {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).ok !== true
  ) {
    throw new TypeError("Expected a deleted stage response");
  }
}

export function createStage(input: StageInput): Promise<void> {
  return requestJson(
    "/api/stages",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    decodeStageResponse,
  );
}

export function updateStage(stageId: string, input: StageInput): Promise<void> {
  return requestJson(
    `/api/stages/${encodeURIComponent(stageId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    decodeStageResponse,
  );
}

export function deleteStage(stageId: string): Promise<void> {
  return requestJson(
    `/api/stages/${encodeURIComponent(stageId)}`,
    { method: "DELETE" },
    decodeDeleteResponse,
  );
}

export function setStagePublic(stageId: string, isPublic: boolean): Promise<void> {
  return requestJson(
    `/api/stages/${encodeURIComponent(stageId)}/publication`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic }),
    },
    decodeDeleteResponse,
  );
}
