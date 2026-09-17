"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ImageOptimizationError, optimizeImageForUpload } from "@/upload/client-image-optimizer";
import {
  isUploadTaskFinished,
  summarizeUploadStatuses,
  type UploadItemStatus,
} from "@/upload/upload-task-model";

interface UploadItem {
  id: string;
  name: string;
  status: UploadItemStatus;
  error?: string;
  cancelRequested?: boolean;
  photoId?: string;
}

interface UploadBatch {
  id: string;
  createdAt: string;
  expanded: boolean;
  items: UploadItem[];
}

interface QueueEntry {
  batchId: string;
  itemId: string;
  file: File;
}

interface ActiveEntry {
  controller: AbortController;
  phase: "compressing" | "uploading";
}

interface UploadTaskContextValue {
  startUpload: (files: File[]) => void;
}

const UploadTaskContext = createContext<UploadTaskContextValue | null>(null);
const maximumFilesPerBatch = 20;
const uploadConcurrency = 2;

function taskKey(batchId: string, itemId: string): string {
  return `${batchId}:${itemId}`;
}

function optimizationErrorMessage(error: unknown): string {
  if (error instanceof ImageOptimizationError) {
    if (error.code === "EMPTY_FILE") return "文件为空，无法处理。";
    if (error.code === "UNSUPPORTED_TYPE") return "不支持这种图片格式。";
    if (error.code === "OPTIMIZED_TOO_LARGE") return "优化后仍超过 20MB。";
    if (error.code === "WEBP_UNAVAILABLE") return "当前浏览器无法生成 WebP 图片。";
  }
  return "图片无法解码或压缩，请检查文件是否损坏。";
}

function responseErrorMessage(status: number, code?: string): string {
  if (status === 401) return "登录已失效，请重新登录后重试。";
  if (status === 413 || code === "OPTIMIZED_IMAGE_TOO_LARGE") return "优化图超过上传限制。";
  if (code === "INVALID_OPTIMIZED_IMAGE") return "服务器未能验证这张优化图片。";
  return "上传没有完成，请稍后重试。";
}

function statusText(item: UploadItem): string {
  if (item.status === "waiting") return "等待处理";
  if (item.status === "compressing") return "正在压缩";
  if (item.status === "uploading") {
    return item.cancelRequested ? "正在确认服务器结果" : "正在上传";
  }
  if (item.status === "success") return "已完成";
  if (item.status === "cancelled") return "已取消";
  return "失败";
}

export function useUploadTasks(): UploadTaskContextValue {
  const context = useContext(UploadTaskContext);
  if (!context) throw new Error("useUploadTasks must be used within UploadTaskProvider");
  return context;
}

export function UploadTaskProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const batchesRef = useRef<UploadBatch[]>([]);
  const queueRef = useRef<QueueEntry[]>([]);
  const activeRef = useRef(new Map<string, ActiveEntry>());
  const cancelledRef = useRef(new Set<string>());
  const pumpRef = useRef<() => void>(() => undefined);

  const commitBatches = useCallback((next: UploadBatch[]) => {
    batchesRef.current = next;
    setBatches(next);
  }, []);

  const patchItem = useCallback(
    (batchId: string, itemId: string, patch: Partial<UploadItem>) => {
      commitBatches(
        batchesRef.current.map((batch) =>
          batch.id === batchId
            ? {
                ...batch,
                items: batch.items.map((item) =>
                  item.id === itemId ? { ...item, ...patch } : item,
                ),
              }
            : batch,
        ),
      );
    },
    [commitBatches],
  );

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
          patchItem(entry.batchId, entry.itemId, {
            status: "success",
            photoId,
            cancelRequested: false,
          });
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
                ? "网络中断，服务器结果未知；请在照片整理台确认后再重试。"
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
    (files: File[]) => {
      if (files.length === 0) return;
      const batchId = crypto.randomUUID();
      const items = files.map<UploadItem>((file, index) => ({
        id: crypto.randomUUID(),
        name: file.name || `未命名照片 ${index + 1}`,
        status: index < maximumFilesPerBatch ? "waiting" : "failed",
        error: index < maximumFilesPerBatch ? undefined : "单批最多处理 20 张照片。",
      }));
      const batch: UploadBatch = {
        id: batchId,
        createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        expanded: false,
        items,
      };
      commitBatches([batch, ...batchesRef.current]);
      queueRef.current.push(
        ...items.slice(0, maximumFilesPerBatch).map((item, index) => ({
          batchId,
          itemId: item.id,
          file: files[index],
        })),
      );
      queueMicrotask(() => pumpRef.current());
    },
    [commitBatches],
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
      const batch = batchesRef.current.find((candidate) => candidate.id === batchId);
      batch?.items.forEach((item) => {
        if (["waiting", "compressing", "uploading"].includes(item.status)) {
          cancelItem(batchId, item.id);
        }
      });
    },
    [cancelItem],
  );

  const toggleBatch = useCallback(
    (batchId: string) => {
      commitBatches(
        batchesRef.current.map((batch) =>
          batch.id === batchId ? { ...batch, expanded: !batch.expanded } : batch,
        ),
      );
    },
    [commitBatches],
  );

  const dismissBatch = useCallback(
    (batchId: string) => {
      const batch = batchesRef.current.find((candidate) => candidate.id === batchId);
      if (!batch || !isUploadTaskFinished(batch.items.map((item) => item.status))) return;
      commitBatches(batchesRef.current.filter((candidate) => candidate.id !== batchId));
    },
    [commitBatches],
  );

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      const hasUnfinished = batchesRef.current.some(
        (batch) => !isUploadTaskFinished(batch.items.map((item) => item.status)),
      );
      if (!hasUnfinished) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, []);

  const context = useMemo(() => ({ startUpload }), [startUpload]);

  return (
    <UploadTaskContext.Provider value={context}>
      {children}
      {batches.length > 0 ? (
        <aside className="upload-task-stack" aria-label="图片上传任务" aria-live="polite">
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
                    aria-label={batch.expanded ? "收起上传任务详情" : "展开上传任务详情"}
                  >
                    <span>照片整理任务 · {batch.createdAt}</span>
                    <strong>
                      {summary.completed} / {summary.total}
                    </strong>
                    <small aria-hidden="true">{batch.expanded ? "收起" : "展开"}</small>
                  </button>
                  {finished ? (
                    <button
                      type="button"
                      className="upload-task-dismiss"
                      onClick={() => dismissBatch(batch.id)}
                      aria-label="关闭已完成的上传任务"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                <progress value={summary.completed} max={summary.total} />
                {batch.expanded ? (
                  <div className="upload-task-details">
                    <p className="upload-task-summary">
                      成功 {summary.success} · 失败 {summary.failed} · 取消 {summary.cancelled}
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
                                {item.cancelRequested ? "确认中" : "取消"}
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
                          取消整批
                        </button>
                      ) : null}
                      <Link href="/workspace">前往照片整理台</Link>
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
