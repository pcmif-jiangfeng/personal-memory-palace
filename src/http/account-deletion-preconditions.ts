import { ApiError } from "./errors.ts";

export function readAccountDeletionPage(value: string | string[] | null | undefined): number {
  if (value == null) return 1;
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value))
    throw new ApiError("INVALID_DELETION_PAGE", 400);
  return Number(value);
}
