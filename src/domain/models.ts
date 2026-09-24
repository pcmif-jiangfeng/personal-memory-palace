export type Visibility = "private" | "shared";

export interface Stage {
  id: string;
  title: string;
  description: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  coverKey: string | null;
}

export interface UploadedPhoto {
  id: string;
  originalName: string;
  mimeType: string;
  optimizedStorageKey: string;
  originalStorageKey: string | null;
  width: number;
  height: number;
  createdAt: string;
  usedAt: string | null;
  libraryArchivedAt: string | null;
}

export interface Memory {
  id: string;
  stageId: string | null;
  title: string;
  story: string;
  visibility: Visibility;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
}

export interface MemoryImage {
  id: string;
  memoryId: string;
  photoId: string;
  storageKey: string;
  altText: string;
  exhibitTitle: string;
  exhibitDescription: string;
  sortOrder: number;
  isCover: boolean;
  createdAt: string;
}

export interface MemoryRelation {
  memoryId: string;
  relatedMemoryId: string;
  createdAt: string;
}

export interface LaterNote {
  id: string;
  memoryId: string;
  content: string;
  createdAt: string;
}

export interface ShareConfig {
  id: string;
  memoryId: string;
  enabled: boolean;
  accessMode: "link" | "password";
  passwordHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemorySummary extends Memory {
  stageTitle: string | null;
  coverKey: string | null;
  imageCount: number;
}

export interface MemoryDetails extends MemorySummary {
  images: MemoryImage[];
  relatedMemories: MemorySummary[];
  laterNotes: LaterNote[];
}

export interface StageShelfItem extends Stage {
  previewImageKeys: string[];
  memoryCount: number;
}
