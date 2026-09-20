"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listPhotos } from "../client/photo-api.ts";
import type {
  PhotoCatalogQuery,
  PhotoSource,
  PhotoUsageFilter,
  WorkspacePhotoView,
} from "../contracts/photo.ts";

export interface PhotoCatalogFilters {
  source: PhotoSource;
  usageFilter: PhotoUsageFilter;
  memoryQuery: string;
  stageId: string;
}

export function createPhotoCatalogQuery(
  filters: PhotoCatalogFilters,
  cursor: string | null,
  limit: number,
): PhotoCatalogQuery {
  return {
    source: filters.source,
    usage: filters.usageFilter,
    query: filters.memoryQuery,
    stageId: filters.stageId,
    cursor,
    limit,
  };
}

export function photoCatalogKey(filters: PhotoCatalogFilters): string {
  return JSON.stringify([
    filters.source,
    filters.usageFilter,
    filters.memoryQuery,
    filters.stageId,
  ]);
}

export function usePhotoCatalog({
  initialPhotos,
  initialSource,
  initialNextCursor,
  pageSize = 24,
}: {
  initialPhotos: WorkspacePhotoView[];
  initialSource: PhotoSource;
  initialNextCursor: string | null;
  pageSize?: number;
}) {
  const initialRequest = useRef(true);
  const [photos, setPhotos] = useState(initialPhotos);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [source, setSource] = useState<PhotoSource>(initialSource);
  const [usageFilter, setUsageFilter] = useState<PhotoUsageFilter>("all");
  const [memoryQuery, setMemoryQuery] = useState("");
  const [stageId, setStageId] = useState("");
  const filters = useMemo(
    () => ({ source, usageFilter, memoryQuery, stageId }),
    [memoryQuery, source, stageId, usageFilter],
  );
  const queryKey = photoCatalogKey(filters);
  const catalogQuery = useMemo(
    () => createPhotoCatalogQuery(filters, null, pageSize),
    [filters, pageSize],
  );

  const loadPhotos = useCallback(
    async (cursor: string | null, append: boolean, signal?: AbortSignal) => {
      setLoading(true);
      setLoadFailed(false);
      try {
        const page = await listPhotos(createPhotoCatalogQuery(filters, cursor, pageSize), signal);
        setPhotos((current) => (append ? [...current, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadFailed(true);
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [filters, pageSize],
  );

  useEffect(() => {
    if (initialRequest.current) {
      initialRequest.current = false;
      return;
    }
    const controller = new AbortController();
    setPhotos([]);
    setNextCursor(null);
    void loadPhotos(null, false, controller.signal);
    return () => controller.abort();
  }, [loadPhotos]);

  const reportLoadFailure = useCallback(() => setLoadFailed(true), []);

  const loadMore = useCallback(() => {
    if (!nextCursor || loading) return;
    void loadPhotos(nextCursor, true);
  }, [loadPhotos, loading, nextCursor]);

  return {
    catalogQuery,
    filters,
    loadFailed,
    loading,
    loadMore,
    memoryQuery,
    nextCursor,
    photos,
    queryKey,
    reportLoadFailure,
    setMemoryQuery,
    setPhotos,
    setSource,
    setStageId,
    setUsageFilter,
    source,
    stageId,
    usageFilter,
  };
}
