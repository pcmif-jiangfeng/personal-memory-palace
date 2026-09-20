import { isUploadTaskFinished, type UploadItemStatus } from "./upload-task-model.ts";

export interface UploadItem {
  id: string;
  name: string;
  status: UploadItemStatus;
  error?: string;
  cancelRequested?: boolean;
  photoId?: string;
}

export interface UploadBatch {
  id: string;
  createdAt: string;
  expanded: boolean;
  items: UploadItem[];
}

export type UploadTaskState = readonly UploadBatch[];

export type UploadTaskAction =
  | { type: "add-batch"; batch: UploadBatch }
  | {
      type: "patch-item";
      batchId: string;
      itemId: string;
      patch: Partial<UploadItem>;
    }
  | { type: "toggle-batch"; batchId: string }
  | { type: "dismiss-finished-batch"; batchId: string };

export const initialUploadTaskState: UploadTaskState = Object.freeze([]);

export function uploadTaskReducer(
  state: UploadTaskState,
  action: UploadTaskAction,
): UploadTaskState {
  if (action.type === "add-batch") return [action.batch, ...state];

  if (action.type === "patch-item") {
    return state.map((batch) =>
      batch.id === action.batchId
        ? {
            ...batch,
            items: batch.items.map((item) =>
              item.id === action.itemId ? { ...item, ...action.patch } : item,
            ),
          }
        : batch,
    );
  }

  if (action.type === "toggle-batch") {
    return state.map((batch) =>
      batch.id === action.batchId ? { ...batch, expanded: !batch.expanded } : batch,
    );
  }

  const batch = state.find((candidate) => candidate.id === action.batchId);
  if (!batch || !isUploadTaskFinished(batch.items.map((item) => item.status))) return state;
  return state.filter((candidate) => candidate.id !== action.batchId);
}
