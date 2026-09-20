"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { ImageOptimizationError, optimizeImageForUpload } from "@/upload/client-image-optimizer";
import { createClientRandomId } from "@/upload/client-random-id";
import { copy } from "@/i18n/zh-CN";
import { isUploadTaskFinished, summarizeUploadStatuses } from "@/upload/upload-task-model";
import {
  initialUploadTaskState,
  uploadTaskReducer,
  type UploadBatch,
  type UploadItem,
} from "@/upload/upload-task-reducer";

interface QueueEntry {
  batchId: string;
  itemId: string;
  file: File;
  onPhotoUploaded?: (photoId: string) => void | Promise<void>;
}

interface ActiveEntry {
  controller: AbortController;
  phase: "compressing" | "uploading";
}

interface UploadTaskContextValue {
  startUpload: (
    files: File[],
    options?: {
      onPhotoUploaded?: (photoId: string) => void | Promise<void>;
    },
  ) => void;
}

const UploadTaskContext = createContext<UploadTaskContextValue | null>(null);
const maximumFilesPerBatch = 20;
const uploadConcurrency = 2;

function taskKey(batchId: string, itemId: string): string {
  return `${batchId}:${itemId}`;
}

function optimizationErrorMessage(error: unknown): string {
  if (error instanceof ImageOptimizationError) {
    if (error.code === "EMPTY_FILE") return copy.uploadTasks.optimizationErrors.empty;
    if (error.code === "UNSUPPORTED_TYPE") return copy.uploadTasks.optimizationErrors.unsupported;
    if (error.code === "OPTIMIZED_TOO_LARGE") return copy.uploadTasks.optimizationErrors.tooLarge;
    if (error.code === "WEBP_UNAVAILABLE")
      return copy.uploadTasks.optimizationErrors.webpUnavailable;
  }
  return copy.uploadTasks.optimizationErrors.invalid;
}

function responseErrorMessage(status: number, code?: string): string {
  if (status === 401) return copy.uploadTasks.responseErrors.unauthorized;
  if (status === 413 || code === "OPTIMIZED_IMAGE_TOO_LARGE")
    return copy.uploadTasks.responseErrors.tooLarge;
  if (code === "INVALID_OPTIMIZED_IMAGE") return copy.uploadTasks.responseErrors.invalid;
  return copy.uploadTasks.responseErrors.failed;
}

function statusText(item: UploadItem): string {
  if (item.status === "waiting") return copy.uploadTasks.statuses.waiting;
  if (item.status === "compressing") return copy.uploadTasks.statuses.compressing;
  if (item.status === "uploading") {
    return item.cancelRequested
      ? copy.uploadTasks.statuses.confirming
      : copy.uploadTasks.statuses.uploading;
  }
  if (item.status === "success") return copy.uploadTasks.statuses.success;
  if (item.status === "cancelled") return copy.uploadTasks.statuses.cancelled;
  return copy.uploadTasks.statuses.failed;
}

export function useUploadTasks(): UploadTaskContextValue {
  const context = useContext(UploadTaskContext);
  if (!context) throw new Error("useUploadTasks must be used within UploadTaskProvider");
  return context;
}

export function UploadTaskProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [batches, dispatch] = useReducer(uploadTaskReducer, initialUploadTaskState);
  const queueRef = useRef<QueueEntry[]>([]);
  const activeRef = useRef(new Map<string, ActiveEntry>());
  const cancelledRef = useRef(new Set<string>());
  const pumpRef = useRef<() => void>(() => undefined);

  const patchItem = useCallback((batchId: string, itemId: string, patch: Partial<UploadItem>) => {
    dispatch({ type: "patch-item", batchId, itemId, patch });
  }, []);

  const processEntry = useCallback(
    async (entry: QueueEntry, controller: AbortController) => {
      const key = taskKey(entry.batchId, entry.itemId);
      try {
        patchItem(entry.batchId, entry.itemId, { status: "compressing", error: undefined });
        const optimized = await optimizeImageForUpload(entry.file, controller.signal);
        if (cancelledRef.current.has(key)) return;

        const active = activeRef.current.get(key);
        if (active) active.phase = "uploading";
        patchItem(entry.batchId, entry.itemId, { status: "uploading" });
        const formData = new FormData();
        formData.append("photos", optimized, "optimized.webp");
        formData.set("originalName", entry.file.name);
        const response = await fetch("/api/photos", { method: "POST", body: formData });
        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
          photos?: Array<{ id: string }>;
        };
        const photoId = result.photos?.[0]?.id;
        if (response.ok && photoId) {
          try {
            await entry.onPhotoUploaded?.(photoId);
            patchItem(entry.batchId, entry.itemId, {
              status: "success",
              photoId,
              cancelRequested: false,
            });
          } catch {
            patchItem(entry.batchId, entry.itemId, {
              status: "failed",
              photoId,
              error: copy.uploadTasks.addToMemoryFailed,
              cancelRequested: false,
            });
          }
          router.refresh();
        } else if (cancelledRef.current.has(key)) {
          patchItem(entry.batchId, entry.itemId, { status: "cancelled", cancelRequested: false });
        } else {
          patchItem(entry.batchId, entry.itemId, {
            status: "failed",
            error: responseErrorMessage(response.status, result.error),
            cancelRequested: false,
          });
        }
      } catch (error) {
        if (cancelledRef.current.has(key) && activeRef.current.get(key)?.phase === "compressing") {
          patchItem(entry.batchId, entry.itemId, { status: "cancelled", cancelRequested: false });
        } else {
          patchItem(entry.batchId, entry.itemId, {
            status: "failed",
            error:
              activeRef.current.get(key)?.phase === "uploading"
                ? copy.uploadTasks.uncertainResult
                : optimizationErrorMessage(error),
            cancelRequested: false,
          });
        }
      } finally {
        activeRef.current.delete(key);
        queueMicrotask(() => pumpRef.current());
      }
    },
    [patchItem, router],
  );

  const pump = useCallback(() => {
    while (activeRef.current.size < uploadConcurrency && queueRef.current.length > 0) {
      const entry = queueRef.current.shift()!;
      const key = taskKey(entry.batchId, entry.itemId);
      if (cancelledRef.current.has(key)) continue;
      const controller = new AbortController();
      activeRef.current.set(key, { controller, phase: "compressing" });
      void processEntry(entry, controller);
    }
  }, [processEntry]);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const startUpload = useCallback(
    (files: File[], options?: { onPhotoUploaded?: (photoId: string) => void | Promise<void> }) => {
      if (files.length === 0) return;
      const batchId = createClientRandomId();
      const items = files.map<UploadItem>((file, index) => ({
        id: createClientRandomId(),
        name: file.name || copy.uploadTasks.unnamed(index + 1),
        status: index < maximumFilesPerBatch ? "waiting" : "failed",
        error: index < maximumFilesPerBatch ? undefined : copy.uploadTasks.batchLimit,
      }));
      const batch: UploadBatch = {
        id: batchId,
        createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        expanded: false,
        items,
      };
      dispatch({ type: "add-batch", batch });
      queueRef.current.push(
        ...items.slice(0, maximumFilesPerBatch).map((item, index) => ({
          batchId,
          itemId: item.id,
          file: files[index],
          onPhotoUploaded: options?.onPhotoUploaded,
        })),
      );
      queueMicrotask(() => pumpRef.current());
    },
    [],
  );

  const cancelItem = useCallback(
    (batchId: string, itemId: string) => {
      const key = taskKey(batchId, itemId);
      const active = activeRef.current.get(key);
      if (!active) {
        cancelledRef.current.add(key);
        patchItem(batchId, itemId, { status: "cancelled", cancelRequested: false });
        return;
      }
      cancelledRef.current.add(key);
      if (active.phase === "compressing") {
        active.controller.abort();
        patchItem(batchId, itemId, { status: "cancelled", cancelRequested: false });
      } else {
        patchItem(batchId, itemId, { cancelRequested: true });
      }
    },
    [patchItem],
  );

  const cancelBatch = useCallback(
    (batchId: string) => {
      const batch = batches.find((candidate) => candidate.id === batchId);
      batch?.items.forEach((item) => {
        if (["waiting", "compressing", "uploading"].includes(item.status)) {
          cancelItem(batchId, item.id);
        }
      });
    },
    [batches, cancelItem],
  );

  const toggleBatch = useCallback((batchId: string) => {
    dispatch({ type: "toggle-batch", batchId });
  }, []);

  const dismissBatch = useCallback((batchId: string) => {
    dispatch({ type: "dismiss-finished-batch", batchId });
  }, []);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      const hasUnfinished = batches.some(
        (batch) => !isUploadTaskFinished(batch.items.map((item) => item.status)),
      );
      if (!hasUnfinished) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [batches]);

  const context = useMemo(() => ({ startUpload }), [startUpload]);

  return (
    <UploadTaskContext.Provider value={context}>
      {children}
      {batches.length > 0 ? (
        <aside
          className="upload-task-stack"
          aria-label={copy.uploadTasks.ariaLabel}
          aria-live="polite"
        >
          {batches.map((batch) => {
            const summary = summarizeUploadStatuses(batch.items.map((item) => item.status));
            const finished = summary.completed === summary.total;
            return (
              <section
                className={`upload-task-card${batch.expanded ? "" : " is-collapsed"}`}
                key={batch.id}
              >
                <div className="upload-task-heading">
                  <button
                    type="button"
                    onClick={() => toggleBatch(batch.id)}
                    aria-expanded={batch.expanded}
                    aria-label={
                      batch.expanded
                        ? copy.uploadTasks.collapseDetails
                        : copy.uploadTasks.expandDetails
                    }
                  >
                    <span>{copy.uploadTasks.title(batch.createdAt)}</span>
                    <strong>
                      {summary.completed} / {summary.total}
                    </strong>
                    <small aria-hidden="true">
                      {batch.expanded ? copy.uploadTasks.collapse : copy.uploadTasks.expand}
                    </small>
                  </button>
                  {finished ? (
                    <button
                      type="button"
                      className="upload-task-dismiss"
                      onClick={() => dismissBatch(batch.id)}
                      aria-label={copy.uploadTasks.dismiss}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                <progress value={summary.completed} max={summary.total} />
                {batch.expanded ? (
                  <div className="upload-task-details">
                    <p className="upload-task-summary">
                      {copy.uploadTasks.summary(summary.success, summary.failed, summary.cancelled)}
                    </p>
                    <ul>
                      {batch.items.map((item) => (
                        <li key={item.id}>
                          <span title={item.name}>{item.name}</span>
                          <div>
                            <small className={`upload-status is-${item.status}`}>
                              {statusText(item)}
                            </small>
                            {["waiting", "compressing", "uploading"].includes(item.status) ? (
                              <button
                                type="button"
                                disabled={item.cancelRequested}
                                onClick={() => cancelItem(batch.id, item.id)}
                              >
                                {item.cancelRequested
                                  ? copy.uploadTasks.cancelPending
                                  : copy.uploadTasks.cancel}
                              </button>
                            ) : null}
                          </div>
                          {item.error ? <p role="alert">{item.error}</p> : null}
                        </li>
                      ))}
                    </ul>
                    <div className="upload-task-actions">
                      {!finished ? (
                        <button type="button" onClick={() => cancelBatch(batch.id)}>
                          {copy.uploadTasks.cancelBatch}
                        </button>
                      ) : null}
                      <Link href="/workspace">{copy.uploadTasks.openWorkspace}</Link>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </aside>
      ) : null}
    </UploadTaskContext.Provider>
  );
}
