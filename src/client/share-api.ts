import { requestJson } from "./http-client.ts";

export interface ShareConfiguration {
  memoryId: string;
  enabled: boolean;
  mode: "link" | "password";
  password: string;
  rotate: boolean;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object");
  }
  return value as Record<string, unknown>;
}

function decodeShareResponse(value: unknown): { url: string | null } {
  const result = readRecord(value);
  if (typeof result.url === "string") return { url: result.url };
  if (result.ok === true) return { url: null };
  throw new TypeError("Expected a share response");
}

function decodeAccessResponse(value: unknown): void {
  if (readRecord(value).ok !== true) {
    throw new TypeError("Expected a successful share access response");
  }
}

export function configureShare(input: ShareConfiguration): Promise<{ url: string | null }> {
  return requestJson(
    "/api/shares",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    decodeShareResponse,
  );
}

export function requestShareAccess(token: string, password: string): Promise<void> {
  return requestJson(
    "/api/share-access",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    },
    decodeAccessResponse,
  );
}
