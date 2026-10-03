import { ApiError } from "./errors.ts";
import { readJsonObject } from "./schemas.ts";

export interface QuotaAdjustment {
  storageQuotaBytes: number;
  expectedQuotaBytes: number;
  expectedOwnerId: string;
}

export function validateQuotaAdjustment(input: QuotaAdjustment): void {
  if (
    typeof input.expectedOwnerId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.expectedOwnerId)
  )
    throw new ApiError("INVALID_STORAGE_QUOTA_OWNER", 400);
  for (const value of [input.storageQuotaBytes, input.expectedQuotaBytes]) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new ApiError("INVALID_STORAGE_QUOTA", 400);
    }
  }
}

export async function parseQuotaAdjustment(request: Request): Promise<QuotaAdjustment> {
  const input = await readJsonObject(request);
  if (
    Object.keys(input).some(
      (key) => !["storageQuotaBytes", "expectedQuotaBytes", "expectedOwnerId"].includes(key),
    )
  ) {
    throw new ApiError("INVALID_STORAGE_QUOTA", 400);
  }
  const adjustment = {
    storageQuotaBytes: input.storageQuotaBytes as number,
    expectedQuotaBytes: input.expectedQuotaBytes as number,
    expectedOwnerId: input.expectedOwnerId as string,
  };
  validateQuotaAdjustment(adjustment);
  return adjustment;
}
