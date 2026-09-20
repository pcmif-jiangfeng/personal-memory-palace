"use client";

import {
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  dragPhotoTransform,
  nextQuickZoomScale,
  pinchPhotoTransform,
  trackpadNavigationAllowed,
  type DragStart,
  type PinchStart,
} from "./photo-gesture-state.ts";
import { MIN_PHOTO_SCALE, type PhotoTransform, type Point } from "./photo-viewer-geometry.ts";
import { resolvePhotoSwipeDirection } from "./photo-viewer-state.ts";

const TOUCH_SWIPE_DISTANCE = 56;
const TRACKPAD_SWIPE_DISTANCE = 12;
const TRACKPAD_NAVIGATION_COOLDOWN = 420;

type TrackedPointer = Point & { pointerType: string };

function distanceBetween(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpointBetween(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

export function usePhotoGestures({
  activeIndex,
  applyTransform,
  pointFromStageCenter,
  revealControls,
  setIsInteracting,
  onPhotoChange,
  showPhotoAt,
  transformRef,
  zoomAt,
}: {
  activeIndex: number;
  applyTransform: (transform: PhotoTransform) => void;
  pointFromStageCenter: (point: Point) => Point | null;
  revealControls: () => void;
  setIsInteracting: (interacting: boolean) => void;
  onPhotoChange: () => void;
  showPhotoAt: (index: number) => boolean;
  transformRef: React.RefObject<PhotoTransform>;
  zoomAt: (point: Point, scale: number) => void;
}) {
  const pointersRef = useRef(new Map<number, TrackedPointer>());
  const dragStartRef = useRef<DragStart | null>(null);
  const pinchStartRef = useRef<PinchStart | null>(null);
  const pointerOriginRef = useRef<Point | null>(null);
  const gestureMovedRef = useRef(false);
  const lastTouchTapRef = useRef<{ time: number; point: Point } | null>(null);
  const lastInputWasTouchRef = useRef(false);
  const lastTrackpadNavigationRef = useRef(0);

  const resetInteraction = useCallback(() => {
    pointersRef.current.clear();
    dragStartRef.current = null;
    pinchStartRef.current = null;
    pointerOriginRef.current = null;
    gestureMovedRef.current = false;
    setIsInteracting(false);
  }, [setIsInteracting]);

  const beginPinch = useCallback(() => {
    const points = [...pointersRef.current.values()];
    if (points.length < 2) return;
    const midpoint = pointFromStageCenter(midpointBetween(points[0], points[1]));
    if (!midpoint) return;
    const current = transformRef.current;
    pinchStartRef.current = {
      distance: Math.max(1, distanceBetween(points[0], points[1])),
      scale: current.scale,
      contentX: (midpoint.x - current.x) / current.scale,
      contentY: (midpoint.y - current.y) / current.scale,
    };
  }, [pointFromStageCenter, transformRef]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
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
    },
    [beginPinch, revealControls, setIsInteracting, transformRef],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
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
        const midpoint = pointFromStageCenter(midpointBetween(points[0], points[1]));
        if (!midpoint) return;
        applyTransform(pinchPhotoTransform(pinch, midpoint, distanceBetween(points[0], points[1])));
        return;
      }

      const drag = dragStartRef.current;
      if (drag && transformRef.current.scale > MIN_PHOTO_SCALE) {
        applyTransform(dragPhotoTransform(transformRef.current, drag, point));
      }
    },
    [applyTransform, pointFromStageCenter, transformRef],
  );

  const handleTouchTap = useCallback(
    (point: Point) => {
      const now = Date.now();
      const previous = lastTouchTapRef.current;
      if (previous && now - previous.time < 320 && distanceBetween(previous.point, point) < 28) {
        lastTouchTapRef.current = null;
        zoomAt(point, nextQuickZoomScale(transformRef.current.scale));
        return;
      }
      lastTouchTapRef.current = { time: now, point };
    },
    [transformRef, zoomAt],
  );

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, allowTap: boolean) => {
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
        if (showPhotoAt(activeIndex + swipeDirection)) onPhotoChange();
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
    },
    [activeIndex, handleTouchTap, onPhotoChange, setIsInteracting, showPhotoAt, transformRef],
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const swipeDirection =
        !event.ctrlKey && transformRef.current.scale === MIN_PHOTO_SCALE
          ? resolvePhotoSwipeDirection(-event.deltaX, event.deltaY, TRACKPAD_SWIPE_DISTANCE)
          : 0;
      if (swipeDirection !== 0) {
        const now = Date.now();
        if (
          trackpadNavigationAllowed(
            now,
            lastTrackpadNavigationRef.current,
            TRACKPAD_NAVIGATION_COOLDOWN,
          )
        ) {
          lastTrackpadNavigationRef.current = now;
          if (showPhotoAt(activeIndex + swipeDirection)) onPhotoChange();
        }
        return;
      }
      const scaleFactor = Math.exp(-event.deltaY * 0.002);
      zoomAt({ x: event.clientX, y: event.clientY }, transformRef.current.scale * scaleFactor);
    },
    [activeIndex, onPhotoChange, showPhotoAt, transformRef, zoomAt],
  );

  const handleDoubleClick = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (lastInputWasTouchRef.current) return;
      zoomAt(
        { x: event.clientX, y: event.clientY },
        nextQuickZoomScale(transformRef.current.scale),
      );
    },
    [transformRef, zoomAt],
  );

  return {
    finishPointer,
    handleDoubleClick,
    handlePointerDown,
    handlePointerMove,
    handleWheel,
    resetInteraction,
  };
}
