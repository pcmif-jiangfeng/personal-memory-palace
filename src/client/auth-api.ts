import { requestJson } from "./http-client.ts";

function decodeLoginResponse(value: unknown): void {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).ok !== true
  ) {
    throw new TypeError("Expected a successful login response");
  }
}

export function login(password: string): Promise<void> {
  return requestJson(
    "/api/auth",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    },
    decodeLoginResponse,
  );
}
