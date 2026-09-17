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
import {
  resolvePhotoSwipeDirection,
  resolvePhotoViewerIndex,
  type PhotoNavigationDirection,
} from "@/components/photo-viewer-state";

const INITIAL_TRANSFORM: PhotoTransform = { scale: MIN_PHOTO_SCALE, x: 0, y: 0 };
const QUICK_ZOOM_SCALE = 2.5;
const TOUCH_SWIPE_DISTANCE = 56;
const TRACKPAD_SWIPE_DISTANCE = 12;
const TRACKPAD_NAVIGATION_COOLDOWN = 420;

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

export type PhotoViewerItem = {
  id: string;
  src: string;
  alt: string;
};

export function PhotoViewer({
  images,
  initialImageId,
  imageClassName,
  loading,
}: {
  images: readonly PhotoViewerItem[];
  initialImageId: string;
  imageClassName?: string;
  loading?: "eager" | "lazy";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeImageId, setActiveImageId] = useState(initialImageId);
  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [navigationDirection, setNavigationDirection] = useState<PhotoNavigationDirection>(0);
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
  const lastTrackpadNavigationRef = useRef(0);
  const hintId = useId();
  const initialIndex = resolvePhotoViewerIndex(images, initialImageId);
  const activeIndex = resolvePhotoViewerIndex(images, activeImageId, fallbackIndex);
  const triggerImage = initialIndex >= 0 ? images[initialIndex] : null;
  const activeImage = activeIndex >= 0 ? images[activeIndex] : null;

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

  const applyTransform = useCallback(
    (candidate: PhotoTransform) => {
      const scale = clampPhotoScale(candidate.scale);
      const metrics = readMetrics();
      const position = metrics
        ? clampPhotoPosition({ x: candidate.x, y: candidate.y }, scale, metrics)
        : { x: candidate.x, y: candidate.y };
      const next = scale === MIN_PHOTO_SCALE ? INITIAL_TRANSFORM : { scale, ...position };
      transformRef.current = next;
      setTransform(next);
    },
    [readMetrics],
  );

  const zoomAt = useCallback(
    (clientPoint: Point, requestedScale: number) => {
      const stage = stageRef.current;
      const metrics = readMetrics();
      if (!stage || !metrics) return;
      const bounds = stage.getBoundingClientRect();
      const anchor = {
        x: clientPoint.x - bounds.left - bounds.width / 2,
        y: clientPoint.y - bounds.top - bounds.height / 2,
      };
      applyTransform(zoomPhotoAroundPoint(transformRef.current, requestedScale, anchor, metrics));
    },
    [applyTransform, readMetrics],
  );

  const resetInteraction = useCallback(() => {
    pointersRef.current.clear();
    dragStartRef.current = null;
    pinchStartRef.current = null;
    pointerOriginRef.current = null;
    gestureMovedRef.current = false;
    setIsInteracting(false);
  }, []);

  const resetTransform = useCallback(() => {
    transformRef.current = INITIAL_TRANSFORM;
    setTransform(INITIAL_TRANSFORM);
  }, []);

  const closeViewer = useCallback(() => {
    setIsOpen(false);
    resetTransform();
    resetInteraction();
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, [resetInteraction, resetTransform]);

  const openViewer = () => {
    if (!triggerImage) return;
    setFallbackIndex(initialIndex);
    setActiveImageId(triggerImage.id);
    setNavigationDirection(0);
    resetTransform();
    setIsOpen(true);
  };

  const showImageAt = useCallback(
    (index: number) => {
      const nextImage = images[index];
      if (!nextImage) return;
      setNavigationDirection(index > activeIndex ? 1 : index < activeIndex ? -1 : 0);
      setFallbackIndex(index);
      setActiveImageId(nextImage.id);
      resetTransform();
      resetInteraction();
    },
    [activeIndex, images, resetInteraction, resetTransform],
  );

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

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && activeIndex > 0) {
        event.preventDefault();
        showImageAt(activeIndex - 1);
      } else if (event.key === "ArrowRight" && activeIndex < images.length - 1) {
        event.preventDefault();
        showImageAt(activeIndex + 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, images.length, isOpen, showImageAt]);

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
        dragStartRef.current = {
          ...point,
          originX: transformRef.current.x,
          originY: transformRef.current.y,
        };
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
      const scale = clampPhotoScale(
        pinch.scale * (distanceBetween(points[0], points[1]) / pinch.distance),
      );
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
      zoomAt(
        point,
        transformRef.current.scale > MIN_PHOTO_SCALE ? MIN_PHOTO_SCALE : QUICK_ZOOM_SCALE,
      );
      return;
    }
    lastTouchTapRef.current = { time: now, point };
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>, allowTap: boolean) => {
    const tracked = pointersRef.current.get(event.pointerId);
    const pointerOrigin = pointerOriginRef.current;
    pointersRef.current.delete(event.pointerId);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }

    const completedTouchGesture =
      allowTap && tracked?.pointerType === "touch" && pointersRef.current.size === 0;
    const swipeDirection =
      completedTouchGesture && pointerOrigin && transformRef.current.scale === MIN_PHOTO_SCALE
        ? resolvePhotoSwipeDirection(
            event.clientX - pointerOrigin.x,
            event.clientY - pointerOrigin.y,
            TOUCH_SWIPE_DISTANCE,
          )
        : 0;

    if (swipeDirection !== 0) {
      lastTouchTapRef.current = null;
      showImageAt(activeIndex + swipeDirection);
    } else if (completedTouchGesture && !gestureMovedRef.current) {
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
    const swipeDirection =
      !event.ctrlKey && transformRef.current.scale === MIN_PHOTO_SCALE
        ? resolvePhotoSwipeDirection(-event.deltaX, event.deltaY, TRACKPAD_SWIPE_DISTANCE)
        : 0;
    if (swipeDirection !== 0) {
      const now = Date.now();
      if (now - lastTrackpadNavigationRef.current >= TRACKPAD_NAVIGATION_COOLDOWN) {
        lastTrackpadNavigationRef.current = now;
        showImageAt(activeIndex + swipeDirection);
      }
      return;
    }
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

  if (!triggerImage) return null;

  return (
    <>
      <button
        ref={triggerRef}
        className="photo-viewer-trigger"
        type="button"
        onClick={openViewer}
        aria-label={copy.exhibition.openPhotoViewer}
      >
        <img
          className={imageClassName}
          src={triggerImage.src}
          alt={triggerImage.alt}
          loading={loading}
        />
      </button>
      {isOpen ? (
        <div className="photo-viewer" role="dialog" aria-modal="true" aria-describedby={hintId}>
          <button
            ref={closeButtonRef}
            className="photo-viewer-close"
            type="button"
            onClick={closeViewer}
            aria-label={copy.exhibition.closePhotoViewer}
          >
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
            {activeImage ? (
              <img
                key={activeImage.id}
                ref={imageRef}
                className={`photo-viewer-image${navigationDirection === 1 ? " is-entering-from-right" : navigationDirection === -1 ? " is-entering-from-left" : ""}`}
                src={activeImage.src}
                alt={activeImage.alt || copy.exhibition.viewerImageAlt}
                draggable={false}
                style={{
                  transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
                }}
              />
            ) : null}
          </div>
          {images.length > 1 ? (
            <>
              <button
                className="photo-viewer-navigation photo-viewer-previous"
                type="button"
                onClick={() => showImageAt(activeIndex - 1)}
                disabled={activeIndex <= 0}
                aria-label={copy.exhibition.previousPhoto}
              >
                <span aria-hidden="true">‹</span>
              </button>
              <button
                className="photo-viewer-navigation photo-viewer-next"
                type="button"
                onClick={() => showImageAt(activeIndex + 1)}
                disabled={activeIndex >= images.length - 1}
                aria-label={copy.exhibition.nextPhoto}
              >
                <span aria-hidden="true">›</span>
              </button>
              <p className="photo-viewer-position">
                {copy.exhibition.photoPosition(activeIndex + 1, images.length)}
              </p>
            </>
          ) : null}
          <p id={hintId} className="photo-viewer-hint">
            {copy.exhibition.photoViewerHint} · {Math.round(transform.scale * 100)}%
          </p>
        </div>
      ) : null}
    </>
  );
}
