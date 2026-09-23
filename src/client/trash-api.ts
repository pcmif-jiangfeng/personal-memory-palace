import { requestJson } from "./http-client.ts";

export type TrashType = "memory" | "stage";
export type TrashAction = "restore" | "permanent";

export interface TrashBatchResult {
  succeededIds: string[];
  failures: Array<{ id: string; error: string }>;
}

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

function decodeTrashBatchResult(value: unknown): TrashBatchResult {
  const result = readRecord(value);
  if (!Array.isArray(result.succeededIds) || !Array.isArray(result.failures)) {
    throw new TypeError("Expected a trash batch result");
  }
  return {
    succeededIds: result.succeededIds.map(readString),
    failures: result.failures.map((failure) => {
      const item = readRecord(failure);
      return { id: readString(item.id), error: readString(item.error) };
    }),
  };
}

export function applyTrashAction(
  type: TrashType,
  ids: string[],
  action: TrashAction,
): Promise<TrashBatchResult> {
  return requestJson(
    "/api/trash",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ids, action, confirm: action === "permanent" }),
    },
    decodeTrashBatchResult,
  );
}
