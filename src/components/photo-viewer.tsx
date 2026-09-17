"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { copy } from "@/i18n/zh-CN";
import {
  MIN_PHOTO_SCALE,
  clampPhotoPosition,
  clampPhotoScale,
  zoomPhotoAroundPoint,
  type PhotoTransform,
  type PhotoViewerMetrics,
  type Point,
} from "@/components/photo-viewer-geometry";

const INITIAL_TRANSFORM: PhotoTransform = { scale: MIN_PHOTO_SCALE, x: 0, y: 0 };
const QUICK_ZOOM_SCALE = 2.5;

type TrackedPointer = Point & { pointerType: string };
type DragStart = Point & { originX: number; originY: number };
type PinchStart = {
  distance: number;
  scale: number;
  contentX: number;
  contentY: number;
};

function distanceBetween(first: Point, second: Point) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpointBetween(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

export function PhotoViewer({ src, alt = "", imageClassName }: { src: string; alt?: string; imageClassName?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [transform, setTransform] = useState<PhotoTransform>(INITIAL_TRANSFORM);
  const transformRef = useRef<PhotoTransform>(INITIAL_TRANSFORM);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pointersRef = useRef(new Map<number, TrackedPointer>());
  const dragStartRef = useRef<DragStart | null>(null);
  const pinchStartRef = useRef<PinchStart | null>(null);
  const pointerOriginRef = useRef<Point | null>(null);
  const gestureMovedRef = useRef(false);
  const lastTouchTapRef = useRef<{ time: number; point: Point } | null>(null);
  const lastInputWasTouchRef = useRef(false);
  const hintId = useId();

  const readMetrics = useCallback((): PhotoViewerMetrics | null => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image) return null;
    return {
      imageWidth: image.offsetWidth,
      imageHeight: image.offsetHeight,
      viewportWidth: stage.clientWidth,
      viewportHeight: stage.clientHeight,
    };
  }, []);

  const applyTransform = useCallback((candidate: PhotoTransform) => {
    const scale = clampPhotoScale(candidate.scale);
    const metrics = readMetrics();
    const position = metrics
      ? clampPhotoPosition({ x: candidate.x, y: candidate.y }, scale, metrics)
      : { x: candidate.x, y: candidate.y };
    const next = scale === MIN_PHOTO_SCALE ? INITIAL_TRANSFORM : { scale, ...position };
    transformRef.current = next;
    setTransform(next);
  }, [readMetrics]);

  const zoomAt = useCallback((clientPoint: Point, requestedScale: number) => {
    const stage = stageRef.current;
    const metrics = readMetrics();
    if (!stage || !metrics) return;
    const bounds = stage.getBoundingClientRect();
    const anchor = {
      x: clientPoint.x - bounds.left - bounds.width / 2,
      y: clientPoint.y - bounds.top - bounds.height / 2,
    };
    applyTransform(zoomPhotoAroundPoint(transformRef.current, requestedScale, anchor, metrics));
  }, [applyTransform, readMetrics]);

  const resetInteraction = useCallback(() => {
    pointersRef.current.clear();
    dragStartRef.current = null;
    pinchStartRef.current = null;
    pointerOriginRef.current = null;
    gestureMovedRef.current = false;
    setIsInteracting(false);
  }, []);

  const closeViewer = useCallback(() => {
    setIsOpen(false);
    transformRef.current = INITIAL_TRANSFORM;
    setTransform(INITIAL_TRANSFORM);
    resetInteraction();
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, [resetInteraction]);

  const openViewer = () => {
    transformRef.current = INITIAL_TRANSFORM;
    setTransform(INITIAL_TRANSFORM);
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeViewer();
    };
    const handleResize = () => applyTransform(transformRef.current);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [applyTransform, closeViewer, isOpen]);

  const beginPinch = useCallback(() => {
    const points = [...pointersRef.current.values()];
    const stage = stageRef.current;
    if (points.length < 2 || !stage) return;
    const midpoint = midpointBetween(points[0], points[1]);
    const bounds = stage.getBoundingClientRect();
    const relativeMidpoint = {
      x: midpoint.x - bounds.left - bounds.width / 2,
      y: midpoint.y - bounds.top - bounds.height / 2,
    };
    const current = transformRef.current;
    pinchStartRef.current = {
      distance: Math.max(1, distanceBetween(points[0], points[1])),
      scale: current.scale,
      contentX: (relativeMidpoint.x - current.x) / current.scale,
      contentY: (relativeMidpoint.y - current.y) / current.scale,
    };
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, { ...point, pointerType: event.pointerType });
    lastInputWasTouchRef.current = event.pointerType === "touch";

    if (pointersRef.current.size === 1) {
      pointerOriginRef.current = point;
      gestureMovedRef.current = false;
      if (transformRef.current.scale > MIN_PHOTO_SCALE) {
        dragStartRef.current = { ...point, originX: transformRef.current.x, originY: transformRef.current.y };
        setIsInteracting(true);
      }
    } else if (pointersRef.current.size === 2) {
      gestureMovedRef.current = true;
      dragStartRef.current = null;
      setIsInteracting(true);
      beginPinch();
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const tracked = pointersRef.current.get(event.pointerId);
    if (!tracked) return;
    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, { ...point, pointerType: tracked.pointerType });

    if (pointerOriginRef.current && distanceBetween(pointerOriginRef.current, point) > 5) {
      gestureMovedRef.current = true;
    }

    const points = [...pointersRef.current.values()];
    if (points.length >= 2) {
      const pinch = pinchStartRef.current;
      const stage = stageRef.current;
      if (!pinch || !stage) return;
      const midpoint = midpointBetween(points[0], points[1]);
      const bounds = stage.getBoundingClientRect();
      const relativeMidpoint = {
        x: midpoint.x - bounds.left - bounds.width / 2,
        y: midpoint.y - bounds.top - bounds.height / 2,
      };
      const scale = clampPhotoScale(pinch.scale * (distanceBetween(points[0], points[1]) / pinch.distance));
      applyTransform({
        scale,
        x: relativeMidpoint.x - pinch.contentX * scale,
        y: relativeMidpoint.y - pinch.contentY * scale,
      });
      return;
    }

    const drag = dragStartRef.current;
    if (drag && transformRef.current.scale > MIN_PHOTO_SCALE) {
      applyTransform({
        ...transformRef.current,
        x: drag.originX + point.x - drag.x,
        y: drag.originY + point.y - drag.y,
      });
    }
  };

  const handleTouchTap = (point: Point) => {
    const now = Date.now();
    const previous = lastTouchTapRef.current;
    if (previous && now - previous.time < 320 && distanceBetween(previous.point, point) < 28) {
      lastTouchTapRef.current = null;
      zoomAt(point, transformRef.current.scale > MIN_PHOTO_SCALE ? MIN_PHOTO_SCALE : QUICK_ZOOM_SCALE);
      return;
    }
    lastTouchTapRef.current = { time: now, point };
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>, allowTap: boolean) => {
    const tracked = pointersRef.current.get(event.pointerId);
    pointersRef.current.delete(event.pointerId);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }

    if (allowTap && tracked?.pointerType === "touch" && pointersRef.current.size === 0 && !gestureMovedRef.current) {
      handleTouchTap({ x: event.clientX, y: event.clientY });
    }

    pinchStartRef.current = null;
    const remaining = [...pointersRef.current.values()];
    if (remaining.length === 1 && transformRef.current.scale > MIN_PHOTO_SCALE) {
      dragStartRef.current = {
        x: remaining[0].x,
        y: remaining[0].y,
        originX: transformRef.current.x,
        originY: transformRef.current.y,
      };
    } else {
      dragStartRef.current = null;
      pointerOriginRef.current = null;
      setIsInteracting(false);
    }
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const scaleFactor = Math.exp(-event.deltaY * 0.002);
    zoomAt({ x: event.clientX, y: event.clientY }, transformRef.current.scale * scaleFactor);
  };

  const handleDoubleClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (lastInputWasTouchRef.current) return;
    zoomAt(
      { x: event.clientX, y: event.clientY },
      transformRef.current.scale > MIN_PHOTO_SCALE ? MIN_PHOTO_SCALE : QUICK_ZOOM_SCALE,
    );
  };

  return (
    <>
      <button ref={triggerRef} className="photo-viewer-trigger" type="button" onClick={openViewer} aria-label={copy.exhibition.openPhotoViewer}>
        <img className={imageClassName} src={src} alt={alt} />
      </button>
      {isOpen ? (
        <div className="photo-viewer" role="dialog" aria-modal="true" aria-describedby={hintId}>
          <button ref={closeButtonRef} className="photo-viewer-close" type="button" onClick={closeViewer} aria-label={copy.exhibition.closePhotoViewer}>
            <span aria-hidden="true">×</span>
          </button>
          <div
            ref={stageRef}
            className={`photo-viewer-stage${transform.scale > MIN_PHOTO_SCALE ? " is-draggable" : ""}${isInteracting ? " is-interacting" : ""}`}
            onWheel={handleWheel}
            onDoubleClick={handleDoubleClick}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(event) => finishPointer(event, true)}
            onPointerCancel={(event) => finishPointer(event, false)}
          >
            <img
              ref={imageRef}
              className="photo-viewer-image"
              src={src}
              alt={alt || copy.exhibition.viewerImageAlt}
              draggable={false}
              style={{ transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})` }}
            />
          </div>
          <p id={hintId} className="photo-viewer-hint">
            {copy.exhibition.photoViewerHint} · {Math.round(transform.scale * 100)}%
          </p>
        </div>
      ) : null}
    </>
  );
}
