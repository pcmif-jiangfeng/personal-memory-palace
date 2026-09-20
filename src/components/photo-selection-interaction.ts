export type PhotoClickIntent = "ignore" | "none" | "select" | "toggle";

export function resolvePhotoClickIntent({
  suppressed,
  detail,
  touch,
  selectionMode,
}: {
  suppressed: boolean;
  detail: number;
  touch: boolean;
  selectionMode: boolean;
}): PhotoClickIntent {
  if (suppressed) return "ignore";
  if (detail === 0 || !touch) return "toggle";
  return selectionMode ? "select" : "none";
}

export function movedPastLongPressThreshold(
  start: { x: number; y: number },
  current: { x: number; y: number },
  threshold = 12,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > threshold;
}
