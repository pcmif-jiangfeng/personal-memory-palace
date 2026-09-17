import { getDatabase } from "./database";
import { deleteUploadedPhotoInDatabase } from "./photo-deletion-service";
import { imageStorage } from "@/storage/local-image-storage";

export function deleteUploadedPhoto(photoId: string) {
  return deleteUploadedPhotoInDatabase(getDatabase(), imageStorage, photoId);
}
