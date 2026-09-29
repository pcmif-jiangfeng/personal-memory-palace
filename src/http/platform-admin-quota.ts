import { ApiError } from "./errors.ts";
import { readJsonObject } from "./schemas.ts";

export interface QuotaAdjustment {
  storageQuotaBytes: number;
  expectedQuotaBytes: number;
}

export function validateQuotaAdjustment(input: QuotaAdjustment): void {
  for (const value of [input.storageQuotaBytes, input.expectedQuotaBytes]) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new ApiError("INVALID_STORAGE_QUOTA", 400);
    }
  }
}

export async function parseQuotaAdjustment(request: Request): Promise<QuotaAdjustment> {
  const input = await readJsonObject(request);
  if (
    Object.keys(input).some((key) => !["storageQuotaBytes", "expectedQuotaBytes"].includes(key))
  ) {
    throw new ApiError("INVALID_STORAGE_QUOTA", 400);
  }
  const adjustment = {
    storageQuotaBytes: input.storageQuotaBytes as number,
    expectedQuotaBytes: input.expectedQuotaBytes as number,
  };
  validateQuotaAdjustment(adjustment);
  return adjustment;
}
