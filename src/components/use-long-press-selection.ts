"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  movedPastLongPressThreshold,
  resolvePhotoClickIntent,
} from "./photo-selection-interaction.ts";

type TouchGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  longPressed: boolean;
};

export function useLongPressSelection({
  clearSelection,
  queryKey,
  selectPhoto,
  togglePhoto,
}: {
  clearSelection: () => void;
  queryKey: string;
  selectPhoto: (photoId: string) => void;
  togglePhoto: (photoId: string) => void;
}) {
  const initialQuery = useRef(true);
  const selectionModeRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchGestureRef = useRef<TouchGesture | null>(null);
  const suppressClickRef = useRef(false);
  const lastPointerWasTouchRef = useRef(false);
  const [mobileSelectionMode, setMobileSelectionMode] = useState(false);

  const clearLongPress = useCallback(() => {
    if (!longPressTimerRef.current) return;
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }, []);

  const exitMobileSelectionMode = useCallback(() => {
    clearLongPress();
    touchGestureRef.current = null;
    selectionModeRef.current = false;
    setMobileSelectionMode(false);
    clearSelection();
  }, [clearLongPress, clearSelection]);

  useEffect(() => {
    if (initialQuery.current) {
      initialQuery.current = false;
      return;
    }
    exitMobileSelectionMode();
  }, [exitMobileSelectionMode, queryKey]);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

  const handlePhotoPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, photoId: string) => {
      lastPointerWasTouchRef.current = event.pointerType === "touch";
      if (event.pointerType !== "touch") return;
      const tile = event.currentTarget;
      const gesture: TouchGesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        longPressed: selectionModeRef.current,
      };
      touchGestureRef.current = gesture;
      if (selectionModeRef.current) {
        selectPhoto(photoId);
        tile.setPointerCapture(event.pointerId);
        return;
      }
      clearLongPress();
      longPressTimerRef.current = setTimeout(() => {
        if (touchGestureRef.current !== gesture) return;
        gesture.longPressed = true;
        suppressClickRef.current = true;
        selectionModeRef.current = true;
        setMobileSelectionMode(true);
        selectPhoto(photoId);
        tile.setPointerCapture(event.pointerId);
      }, 450);
    },
    [clearLongPress, selectPhoto],
  );

  const handlePhotoPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const gesture = touchGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      if (!gesture.longPressed && !selectionModeRef.current) {
        if (
          movedPastLongPressThreshold(
            { x: gesture.startX, y: gesture.startY },
            { x: event.clientX, y: event.clientY },
          )
        ) {
          clearLongPress();
        }
        return;
      }
      event.preventDefault();
      const photoId = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-photo-id]")?.dataset.photoId;
      if (photoId) selectPhoto(photoId);
    },
    [clearLongPress, selectPhoto],
  );

  const finishPhotoPointer = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      clearLongPress();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      touchGestureRef.current = null;
    },
    [clearLongPress],
  );

  const handlePhotoClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, photoId: string) => {
      const intent = resolvePhotoClickIntent({
        suppressed: suppressClickRef.current,
        detail: event.detail,
        touch: lastPointerWasTouchRef.current,
        selectionMode: selectionModeRef.current,
      });
      if (intent === "ignore") {
        suppressClickRef.current = false;
        event.preventDefault();
      } else if (intent === "toggle") {
        togglePhoto(photoId);
      } else if (intent === "select") {
        selectPhoto(photoId);
      }
    },
    [selectPhoto, togglePhoto],
  );

  return {
    exitMobileSelectionMode,
    finishPhotoPointer,
    handlePhotoClick,
    handlePhotoPointerDown,
    handlePhotoPointerMove,
    isLastPointerTouch: () => lastPointerWasTouchRef.current,
    mobileSelectionMode,
  };
}
