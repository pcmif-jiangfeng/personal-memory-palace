"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { copy } from "@/i18n/zh-CN";
import { viewerOrientationChanged, type ViewerOrientation } from "@/components/photo-gesture-state";
import { hasExhibitMetadata } from "@/components/photo-viewer-state";
import { usePhotoGestures } from "@/components/use-photo-gestures";
import { usePhotoNavigation } from "@/components/use-photo-navigation";
import { usePhotoTransform } from "@/components/use-photo-transform";
import { useViewerControls } from "@/components/use-viewer-controls";
import { MIN_PHOTO_SCALE } from "@/components/photo-viewer-geometry";

type ViewerViewport = {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
};

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
  const orientationRef = useRef<ViewerOrientation | null>(null);
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

  const resetPhotoView = useCallback(() => {
    resetTransform();
    clearFittedSize();
    setDescriptionExpanded(false);
  }, [clearFittedSize, resetTransform]);
  const preparePhotoChange = useCallback(() => {
    resetPhotoView();
    revealControls();
  }, [resetPhotoView, revealControls]);
  const {
    finishPointer,
    handleDoubleClick,
    handlePointerDown,
    handlePointerMove,
    handleWheel,
    resetInteraction,
  } = usePhotoGestures({
    activeIndex,
    applyTransform,
    onPhotoChange: preparePhotoChange,
    pointFromStageCenter,
    revealControls,
    setIsInteracting,
    showPhotoAt,
    transformRef,
    zoomAt,
  });

  const closeViewer = useCallback(() => {
    setIsOpen(false);
    resetPhotoView();
    resetInteraction();
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, [resetInteraction, resetPhotoView]);

  const openViewer = () => {
    if (!resetToInitialPhoto()) return;
    preparePhotoChange();
    setIsOpen(true);
  };

  const showImageAt = useCallback(
    (index: number) => {
      if (!showPhotoAt(index)) return;
      preparePhotoChange();
      resetInteraction();
    },
    [preparePhotoChange, resetInteraction, showPhotoAt],
  );
  useEffect(() => {
    if (!isOpen) return;

    const visualViewport = window.visualViewport;
    const syncViewport = () => {
      const nextViewport = readViewerViewport();
      const orientation = window.matchMedia("(orientation: portrait)").matches
        ? "portrait"
        : "landscape";
      const orientationChanged = viewerOrientationChanged(orientationRef.current, orientation);
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
