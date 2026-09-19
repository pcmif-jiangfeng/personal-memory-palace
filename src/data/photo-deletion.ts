import { getDatabase } from "./database";
import {
  deleteUploadedPhotoInDatabase,
  deleteUploadedPhotosInDatabase,
} from "./photo-deletion-service";
import { imageStorage } from "@/storage/local-image-storage";

export function deleteUploadedPhoto(photoId: string) {
  return deleteUploadedPhotoInDatabase(getDatabase(), imageStorage, photoId);
}

export function deleteUploadedPhotos(photoIds: string[]) {
  return deleteUploadedPhotosInDatabase(getDatabase(), imageStorage, photoIds);
}
