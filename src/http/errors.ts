export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, string | number>;

  constructor(code: string, status: number, details?: Record<string, string | number>) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
