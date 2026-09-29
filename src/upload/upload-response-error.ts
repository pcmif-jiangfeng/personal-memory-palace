import { copy } from "../i18n/zh-CN.ts";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function uploadResponseErrorMessage(
  status: number,
  code?: string,
  details?: unknown,
): string {
  if (code === "STORAGE_QUOTA_EXCEEDED") {
    if (typeof details === "object" && details !== null && !Array.isArray(details)) {
      const values = details as Record<string, unknown>;
      const used = values.storageUsedBytes;
      const quota = values.storageQuotaBytes;
      const reserved = values.reservedBytes;
      if (
        [used, quota, reserved].every(
          (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
        )
      ) {
        return `照片存储空间不足：当前用量 ${formatBytes(used as number)}，上限 ${formatBytes(quota as number)}${reserved ? `，进行中的上传已预留 ${formatBytes(reserved as number)}` : ""}。请清理不需要的照片或联系管理员调整额度；文字和记忆仍可编辑。`;
      }
    }
    return "照片存储空间不足，无法新增照片；文字和记忆仍可编辑。";
  }
  if (code === "STORAGE_USAGE_NOT_READY")
    return "照片用量尚未核对，请联系管理员重算存储用量后再上传；文字和记忆仍可编辑。";
  if (status === 401) return copy.uploadTasks.responseErrors.unauthorized;
  if (status === 413 || code === "OPTIMIZED_IMAGE_TOO_LARGE")
    return copy.uploadTasks.responseErrors.tooLarge;
  if (code === "INVALID_OPTIMIZED_IMAGE") return copy.uploadTasks.responseErrors.invalid;
  return copy.uploadTasks.responseErrors.failed;
}
