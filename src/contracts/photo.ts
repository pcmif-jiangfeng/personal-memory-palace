export type PhotoSource = "recent" | "library";
export type PhotoUsageFilter = "all" | "used" | "unused";

export interface WorkspacePhotoView {
  id: string;
  name: string;
  src: string;
  hasOriginal: boolean;
  libraryMember: boolean;
  activeMemoryCount: number;
  memoryTitles: string[];
  stageIds: string[];
}

export interface PhotoMemoryReference {
  id: string;
  title: string;
  isCover: boolean;
}

export interface PhotoStageReference {
  id: string;
  title: string;
}

export interface PhotoReferences {
  memories: PhotoMemoryReference[];
  stages: PhotoStageReference[];
}

export interface PhotoDeleteIssue {
  photoId: string;
  name?: string;
  error?: string;
  references?: PhotoReferences;
}

export interface PhotoBatchDeleteResult {
  deletedIds: string[];
  failures: Array<PhotoDeleteIssue & { error: string }>;
}

export interface PhotoCatalogPage {
  items: WorkspacePhotoView[];
  nextCursor: string | null;
}

export interface PhotoCatalogQuery {
  source: PhotoSource;
  usage?: PhotoUsageFilter;
  query?: string;
  stageId?: string;
  cursor?: string | null;
  limit: number;
}
