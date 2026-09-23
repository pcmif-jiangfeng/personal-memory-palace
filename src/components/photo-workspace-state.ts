import type { PhotoBatchDeleteResult, WorkspacePhotoView } from "@/contracts/photo";

export function removeBatchDeletedPhotos(
  photos: readonly WorkspacePhotoView[],
  result: PhotoBatchDeleteResult,
): WorkspacePhotoView[] {
  const deletedPhotoIds = new Set(result.deletedIds);
  return photos.filter((photo) => !deletedPhotoIds.has(photo.id));
}
