import {
  MIN_PHOTO_SCALE,
  clampPhotoScale,
  type PhotoTransform,
  type Point,
} from "./photo-viewer-geometry.ts";

export type ViewerOrientation = "portrait" | "landscape";
export type DragStart = Point & { originX: number; originY: number };
export type PinchStart = {
  distance: number;
  scale: number;
  contentX: number;
  contentY: number;
};

export function dragPhotoTransform(
  current: PhotoTransform,
  start: DragStart,
  point: Point,
): PhotoTransform {
  return {
    ...current,
    x: start.originX + point.x - start.x,
    y: start.originY + point.y - start.y,
  };
}

export function pinchPhotoTransform(
  start: PinchStart,
  midpoint: Point,
  distance: number,
): PhotoTransform {
  const scale = clampPhotoScale(start.scale * (distance / Math.max(1, start.distance)));
  return {
    scale,
    x: midpoint.x - start.contentX * scale,
    y: midpoint.y - start.contentY * scale,
  };
}

export function nextQuickZoomScale(currentScale: number, quickScale = 2.5): number {
  return currentScale > MIN_PHOTO_SCALE ? MIN_PHOTO_SCALE : quickScale;
}

export function trackpadNavigationAllowed(
  now: number,
  lastNavigation: number,
  cooldown: number,
): boolean {
  return now - lastNavigation >= cooldown;
}

export function viewerOrientationChanged(
  previous: ViewerOrientation | null,
  current: ViewerOrientation,
): boolean {
  return previous !== null && previous !== current;
}
