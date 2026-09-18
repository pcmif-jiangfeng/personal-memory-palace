export interface CarouselBoundaryState {
  canScroll: boolean;
  atStart: boolean;
  atEnd: boolean;
}

export function normalizeStageOffsets(offsets: number[]): number[] {
  const origin = offsets[0] ?? 0;
  return offsets.map((offset) => offset - origin);
}

export function closestStageIndex(offsets: number[], scrollLeft: number): number {
  if (offsets.length === 0) return -1;
  let closestIndex = 0;
  let closestDistance = Math.abs(offsets[0] - scrollLeft);
  for (let index = 1; index < offsets.length; index += 1) {
    const distance = Math.abs(offsets[index] - scrollLeft);
    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  }
  return closestIndex;
}

export function adjacentStageIndex(
  offsets: number[],
  scrollLeft: number,
  direction: -1 | 1,
  pendingIndex: number | null = null,
): number {
  if (offsets.length === 0) return -1;
  const currentIndex = pendingIndex ?? closestStageIndex(offsets, scrollLeft);
  return Math.min(offsets.length - 1, Math.max(0, currentIndex + direction));
}

export function carouselBoundaryState(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
  tolerance = 2,
): CarouselBoundaryState {
  const maximumScroll = Math.max(0, scrollWidth - clientWidth);
  return {
    canScroll: maximumScroll > tolerance,
    atStart: scrollLeft <= tolerance,
    atEnd: scrollLeft >= maximumScroll - tolerance,
  };
}
