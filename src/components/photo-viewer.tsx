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
import { MIN_PHOTO_SCALE, clampPhotoScale, type Point } from "@/components/photo-viewer-geometry";
import { resolvePhotoSwipeDirection, hasExhibitMetadata } from "@/components/photo-viewer-state";
import { usePhotoNavigation } from "@/components/use-photo-navigation";
import { usePhotoTransform } from "@/components/use-photo-transform";
import { useViewerControls } from "@/components/use-viewer-controls";

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
type ViewerViewport = {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
};

function distanceBetween(first: Point, second: Point) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpointBetween(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function readViewerViewport(): ViewerViewport {
  const viewport = window.visualViewport;
  return viewport
    ? {
        width: viewport.width,
        height: viewport.height,
        offsetLeft: viewport.offsetLeft,
        offsetTop: viewport.offsetTop,
      }
    : { width: window.innerWidth, height: window.innerHeight, offsetLeft: 0, offsetTop: 0 };
}

export type PhotoViewerItem = {
  id: string;
  src: string;
  alt: string;
  exhibitTitle: string;
  exhibitDescription: string;
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
  const [isInteracting, setIsInteracting] = useState(false);
  const [viewport, setViewport] = useState<ViewerViewport | null>(null);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pointersRef = useRef(new Map<number, TrackedPointer>());
  const dragStartRef = useRef<DragStart | null>(null);
  const pinchStartRef = useRef<PinchStart | null>(null);
  const pointerOriginRef = useRef<Point | null>(null);
  const gestureMovedRef = useRef(false);
  const lastTouchTapRef = useRef<{ time: number; point: Point } | null>(null);
  const lastInputWasTouchRef = useRef(false);
  const lastTrackpadNavigationRef = useRef(0);
  const orientationRef = useRef<"portrait" | "landscape" | null>(null);
  const hintId = useId();
  const metadataId = useId();
  const {
    activeIndex,
    activePhoto: activeImage,
    navigationDirection,
    resetToInitialPhoto,
    showPhotoAt,
    triggerPhoto: triggerImage,
  } = usePhotoNavigation(images, initialImageId);
  const {
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
  } = usePhotoTransform({ activePhotoId: activeImage?.id, isOpen, viewport });
  const { controlsVisible, revealControls } = useViewerControls({
    isOpen,
    isInteracting,
    autoHidePaused: descriptionExpanded,
  });

  const hasActiveMetadata = activeImage ? hasExhibitMetadata(activeImage) : false;
  const activeTitle = activeImage?.exhibitTitle.trim() ?? "";
  const activeDescription = activeImage?.exhibitDescription.trim() ?? "";

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
    clearFittedSize();
    setDescriptionExpanded(false);
    resetTransform();
    resetInteraction();
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, [clearFittedSize, resetInteraction, resetTransform]);

  const openViewer = () => {
    if (!resetToInitialPhoto()) return;
    clearFittedSize();
    setDescriptionExpanded(false);
    resetTransform();
    setIsOpen(true);
    revealControls();
  };

  const showImageAt = useCallback(
    (index: number) => {
      if (!showPhotoAt(index)) return;
      resetTransform();
      clearFittedSize();
      setDescriptionExpanded(false);
      revealControls();
      resetInteraction();
    },
    [clearFittedSize, resetInteraction, resetTransform, revealControls, showPhotoAt],
  );

  useEffect(() => {
    if (!isOpen) return;

    const visualViewport = window.visualViewport;
    const syncViewport = () => {
      const nextViewport = readViewerViewport();
      const orientation = window.matchMedia("(orientation: portrait)").matches
        ? "portrait"
        : "landscape";
      const orientationChanged =
        orientationRef.current !== null && orientationRef.current !== orientation;
      orientationRef.current = orientation;
      setViewport((current) =>
        current &&
        current.width === nextViewport.width &&
        current.height === nextViewport.height &&
        current.offsetLeft === nextViewport.offsetLeft &&
        current.offsetTop === nextViewport.offsetTop
          ? current
          : nextViewport,
      );
      if (orientationChanged) {
        resetTransform();
        revealControls();
      }
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);
    visualViewport?.addEventListener("resize", syncViewport);
    visualViewport?.addEventListener("scroll", syncViewport);
    return () => {
      orientationRef.current = null;
      window.removeEventListener("resize", syncViewport);
      visualViewport?.removeEventListener("resize", syncViewport);
      visualViewport?.removeEventListener("scroll", syncViewport);
    };
  }, [isOpen, resetTransform, revealControls]);

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
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeViewer, isOpen]);

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
    if (points.length < 2) return;
    const midpoint = midpointBetween(points[0], points[1]);
    const relativeMidpoint = pointFromStageCenter(midpoint);
    if (!relativeMidpoint) return;
    const current = transformRef.current;
    pinchStartRef.current = {
      distance: Math.max(1, distanceBetween(points[0], points[1])),
      scale: current.scale,
      contentX: (relativeMidpoint.x - current.x) / current.scale,
      contentY: (relativeMidpoint.y - current.y) / current.scale,
    };
  }, [pointFromStageCenter, transformRef]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, { ...point, pointerType: event.pointerType });
    lastInputWasTouchRef.current = event.pointerType === "touch";
    revealControls();

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
      if (!pinch) return;
      const midpoint = midpointBetween(points[0], points[1]);
      const relativeMidpoint = pointFromStageCenter(midpoint);
      if (!relativeMidpoint) return;
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
        <div
          className={`photo-viewer${controlsVisible ? "" : " controls-hidden"}`}
          role="dialog"
          aria-modal="true"
          aria-label={activeTitle || copy.exhibition.viewerDialogLabel}
          aria-describedby={hasActiveMetadata ? `${metadataId} ${hintId}` : hintId}
          style={
            viewport
              ? {
                  left: viewport.offsetLeft,
                  top: viewport.offsetTop,
                  right: "auto",
                  width: viewport.width,
                  height: viewport.height,
                  bottom: "auto",
                }
              : undefined
          }
        >
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
            className={`photo-viewer-stage${hasActiveMetadata ? " has-identity" : ""}${transform.scale > MIN_PHOTO_SCALE ? " is-draggable" : ""}${isInteracting ? " is-interacting" : ""}`}
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
                onLoad={fitActiveImage}
                style={{
                  width: fittedSize?.width,
                  height: fittedSize?.height,
                  visibility: fittedSize ? "visible" : "hidden",
                  transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
                }}
              />
            ) : null}
          </div>
          {activeImage && hasActiveMetadata ? (
            <aside id={metadataId} key={activeImage.id} className="photo-viewer-identity">
              <div className="photo-viewer-identity-heading">
                {activeTitle ? <h2>{activeTitle}</h2> : null}
                {activeDescription ? (
                  <button
                    type="button"
                    aria-expanded={descriptionExpanded}
                    aria-controls={`${metadataId}-description`}
                    onClick={() => {
                      setDescriptionExpanded((expanded) => !expanded);
                      revealControls();
                    }}
                  >
                    {descriptionExpanded
                      ? copy.exhibition.hideExhibitDescription
                      : copy.exhibition.showExhibitDescription}
                  </button>
                ) : null}
              </div>
              {activeDescription ? (
                <p id={`${metadataId}-description`} hidden={!descriptionExpanded}>
                  {activeDescription}
                </p>
              ) : null}
            </aside>
          ) : null}
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
