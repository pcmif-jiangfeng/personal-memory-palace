"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  MIN_PHOTO_SCALE,
  clampPhotoPosition,
  clampPhotoScale,
  fitPhotoWithinViewport,
  zoomPhotoAroundPoint,
  type PhotoSize,
  type PhotoTransform,
  type PhotoViewerMetrics,
  type Point,
} from "./photo-viewer-geometry.ts";

const INITIAL_TRANSFORM: PhotoTransform = { scale: MIN_PHOTO_SCALE, x: 0, y: 0 };

export function normalizePhotoTransform(
  candidate: PhotoTransform,
  metrics: PhotoViewerMetrics | null,
): PhotoTransform {
  const scale = clampPhotoScale(candidate.scale);
  const position = metrics
    ? clampPhotoPosition({ x: candidate.x, y: candidate.y }, scale, metrics)
    : { x: candidate.x, y: candidate.y };
  return scale === MIN_PHOTO_SCALE ? INITIAL_TRANSFORM : { scale, ...position };
}

function readStageContentSize(stage: HTMLDivElement): PhotoSize {
  const style = window.getComputedStyle(stage);
  const horizontalPadding =
    Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const verticalPadding =
    Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  return {
    width: Math.max(0, stage.clientWidth - horizontalPadding),
    height: Math.max(0, stage.clientHeight - verticalPadding),
  };
}

export function usePhotoTransform({
  activePhotoId,
  isOpen,
  viewport,
}: {
  activePhotoId: string | undefined;
  isOpen: boolean;
  viewport: unknown;
}) {
  const [transform, setTransform] = useState<PhotoTransform>(INITIAL_TRANSFORM);
  const [fittedSize, setFittedSize] = useState<PhotoSize | null>(null);
  const transformRef = useRef<PhotoTransform>(INITIAL_TRANSFORM);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const readMetrics = useCallback((): PhotoViewerMetrics | null => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image) return null;
    const available = readStageContentSize(stage);
    return {
      imageWidth: image.offsetWidth,
      imageHeight: image.offsetHeight,
      viewportWidth: available.width,
      viewportHeight: available.height,
    };
  }, []);

  const pointFromStageCenter = useCallback((point: Point): Point | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const bounds = stage.getBoundingClientRect();
    const style = window.getComputedStyle(stage);
    const content = readStageContentSize(stage);
    const centerX = bounds.left + Number.parseFloat(style.paddingLeft) + content.width / 2;
    const centerY = bounds.top + Number.parseFloat(style.paddingTop) + content.height / 2;
    return { x: point.x - centerX, y: point.y - centerY };
  }, []);

  const applyTransform = useCallback(
    (candidate: PhotoTransform) => {
      const next = normalizePhotoTransform(candidate, readMetrics());
      transformRef.current = next;
      setTransform(next);
    },
    [readMetrics],
  );

  const zoomAt = useCallback(
    (clientPoint: Point, requestedScale: number) => {
      const metrics = readMetrics();
      const anchor = pointFromStageCenter(clientPoint);
      if (!metrics || !anchor) return;
      applyTransform(zoomPhotoAroundPoint(transformRef.current, requestedScale, anchor, metrics));
    },
    [applyTransform, pointFromStageCenter, readMetrics],
  );

  const resetTransform = useCallback(() => {
    transformRef.current = INITIAL_TRANSFORM;
    setTransform(INITIAL_TRANSFORM);
  }, []);

  const clearFittedSize = useCallback(() => setFittedSize(null), []);

  const fitActiveImage = useCallback(() => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image || !image.complete || !image.naturalWidth || !image.naturalHeight) return;
    const available = readStageContentSize(stage);
    const nextSize = fitPhotoWithinViewport(
      image.naturalWidth,
      image.naturalHeight,
      available.width,
      available.height,
    );
    if (nextSize.width && nextSize.height) setFittedSize(nextSize);
  }, []);

  useLayoutEffect(() => {
    if (isOpen) fitActiveImage();
  }, [activePhotoId, fitActiveImage, isOpen, viewport]);

  useLayoutEffect(() => {
    if (isOpen && fittedSize) applyTransform(transformRef.current);
  }, [applyTransform, fittedSize, isOpen]);

  return {
    applyTransform,
    clearFittedSize,
    fitActiveImage,
    fittedSize,
    imageRef,
    pointFromStageCenter,
    resetTransform,
    stageRef,
    transform,
    transformRef,
    zoomAt,
  };
}
