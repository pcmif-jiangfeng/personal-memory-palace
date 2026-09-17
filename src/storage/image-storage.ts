export interface StoredImage {
  key: string;
  publicPath: string;
}

export interface SaveImageInput {
  data: Buffer;
  originalName: string;
  mimeType: string;
  preserveOriginal: boolean;
}

export interface SavedImage {
  optimizedStorageKey: string;
  originalStorageKey: string | null;
  width: number;
  height: number;
}

export interface SaveOptimizedImageInput {
  data: Buffer;
  width: number;
  height: number;
}

export interface ImageStorage {
  resolve(key: string): StoredImage;
  save(input: SaveImageInput): Promise<SavedImage>;
  saveOptimized(input: SaveOptimizedImageInput): Promise<SavedImage>;
  remove(keys: Array<string | null>): Promise<void>;
}
