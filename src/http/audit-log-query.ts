import type { AuditLogFilter } from "../data/audit-log-reader.ts";
import { ApiError } from "./errors.ts";

export function readAuditLogQuery(query: {
  page?: string | string[];
  objectType?: string | string[];
  objectId?: string | string[];
}): AuditLogFilter {
  const page = query.page ?? "1";
  const objectType = query.objectType ?? "";
  const objectId = query.objectId ?? "";
  if (
    typeof page !== "string" ||
    !/^[1-9]\d{0,5}$/.test(page) ||
    typeof objectType !== "string" ||
    objectType.length > 80 ||
    typeof objectId !== "string" ||
    objectId.length > 160
  )
    throw new ApiError("INVALID_AUDIT_FILTER", 400);
  return { page: Number(page), objectType: objectType.trim(), objectId: objectId.trim() };
}
