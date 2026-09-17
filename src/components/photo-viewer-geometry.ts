export const MIN_PHOTO_SCALE = 1;
export const MAX_PHOTO_SCALE = 5;

export type PhotoTransform = {
  scale: number;
  x: number;
  y: number;
};

export type PhotoViewerMetrics = {
  imageWidth: number;
  imageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
};

export type Point = {
  x: number;
  y: number;
};

export function clampPhotoScale(scale: number) {
  return Math.min(MAX_PHOTO_SCALE, Math.max(MIN_PHOTO_SCALE, scale));
}

export function clampPhotoPosition(
  position: Point,
  scale: number,
  metrics: PhotoViewerMetrics,
): Point {
  if (scale <= MIN_PHOTO_SCALE) return { x: 0, y: 0 };

  const maxX = Math.max(0, (metrics.imageWidth * scale - metrics.viewportWidth) / 2);
  const maxY = Math.max(0, (metrics.imageHeight * scale - metrics.viewportHeight) / 2);

  return {
    x: Math.min(maxX, Math.max(-maxX, position.x)),
    y: Math.min(maxY, Math.max(-maxY, position.y)),
  };
}

export function zoomPhotoAroundPoint(
  transform: PhotoTransform,
  requestedScale: number,
  anchor: Point,
  metrics: PhotoViewerMetrics,
): PhotoTransform {
  const scale = clampPhotoScale(requestedScale);
  if (scale === MIN_PHOTO_SCALE) return { scale, x: 0, y: 0 };

  const contentX = (anchor.x - transform.x) / transform.scale;
  const contentY = (anchor.y - transform.y) / transform.scale;
  const position = clampPhotoPosition(
    {
      x: anchor.x - contentX * scale,
      y: anchor.y - contentY * scale,
    },
    scale,
    metrics,
  );

  return { scale, ...position };
}
