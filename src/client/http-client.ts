export type JsonDecoder<T> = (payload: unknown) => T;

export class ClientApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    status: number,
    details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "ClientApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<{ payload?: unknown; valid: boolean }> {
  const body = await response.text();
  if (!body) return { valid: false };
  try {
    return { payload: JSON.parse(body) as unknown, valid: true };
  } catch {
    return { valid: false };
  }
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  decode: JsonDecoder<T>,
): Promise<T> {
  const response = await fetch(input, init);
  const { payload, valid } = await readJson(response);

  if (!response.ok) {
    const errorPayload = isRecord(payload) ? payload : undefined;
    const code = typeof errorPayload?.error === "string" ? errorPayload.error : "REQUEST_FAILED";
    const details = isRecord(errorPayload?.details) ? errorPayload.details : undefined;
    throw new ClientApiError(code, response.status, details);
  }

  if (!valid) throw new ClientApiError("INVALID_RESPONSE", response.status);

  try {
    return decode(payload);
  } catch (error) {
    if (error instanceof ClientApiError) throw error;
    throw new ClientApiError("INVALID_RESPONSE", response.status, undefined, { cause: error });
  }
}
