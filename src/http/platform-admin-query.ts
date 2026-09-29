import { ApiError } from "./errors.ts";

export function readPlatformAdminPage(value: string | string[] | undefined): number {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value))
    throw new ApiError("INVALID_ADMIN_PAGE", 400);
  return Number(value);
}
