import type { MemoryImage } from "./models";

export function findCoverImage(images: MemoryImage[]): MemoryImage | null {
  return images.find((image) => image.isCover) ?? images[0] ?? null;
}

export function orderGalleryImages(images: MemoryImage[]): MemoryImage[] {
  return [...images].sort((left, right) => left.sortOrder - right.sortOrder);
}
