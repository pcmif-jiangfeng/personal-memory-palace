import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { validateQuotaAdjustment, type QuotaAdjustment } from "../http/platform-admin-quota.ts";
import { requirePlatformAdminInDatabase } from "./platform-admin.ts";
import { withTransaction } from "./transaction.ts";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { readNumber } from "./row-readers.ts";

export function adjustMuseumQuotaInDatabase(
  database: DatabaseSync,
  userId: string | null,
  museumId: string,
  input: QuotaAdjustment,
) {
  return withTransaction(database, () => {
    const actorUserId = requirePlatformAdminInDatabase(database, userId);
    validateQuotaAdjustment(input);
    const museum = database
      .prepare("SELECT storage_quota_bytes FROM museums WHERE id=?")
      .get(museumId);
    if (!museum) throw new ApiError("MUSEUM_NOT_FOUND", 404);
    const before = readNumber(museum, "storage_quota_bytes");
    if (before !== input.expectedQuotaBytes) throw new ApiError("STORAGE_QUOTA_CONFLICT", 409);
    if (before !== input.storageQuotaBytes) {
      // Quota is operational metadata: do not change content versions, ownership or used bytes.
      database
        .prepare("UPDATE museums SET storage_quota_bytes=? WHERE id=?")
        .run(input.storageQuotaBytes, museumId);
      writeAuditLogInDatabase(database, {
        actorUserId,
        museumId,
        action: "admin.quota.update",
        objectType: "museum",
        objectId: museumId,
        diff: { beforeQuotaBytes: before, afterQuotaBytes: input.storageQuotaBytes },
      });
    }
    return { id: museumId, storageQuotaBytes: input.storageQuotaBytes };
  });
}
