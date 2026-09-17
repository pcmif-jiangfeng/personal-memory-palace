export type UploadItemStatus =
  "waiting" | "compressing" | "uploading" | "success" | "failed" | "cancelled";

export interface UploadTaskSummary {
  total: number;
  completed: number;
  success: number;
  failed: number;
  cancelled: number;
  active: number;
}

export function summarizeUploadStatuses(statuses: UploadItemStatus[]): UploadTaskSummary {
  const success = statuses.filter((status) => status === "success").length;
  const failed = statuses.filter((status) => status === "failed").length;
  const cancelled = statuses.filter((status) => status === "cancelled").length;
  return {
    total: statuses.length,
    completed: success + failed + cancelled,
    success,
    failed,
    cancelled,
    active: statuses.filter((status) => status === "compressing" || status === "uploading").length,
  };
}

export function isUploadTaskFinished(statuses: UploadItemStatus[]): boolean {
  const summary = summarizeUploadStatuses(statuses);
  return summary.total > 0 && summary.completed === summary.total;
}
