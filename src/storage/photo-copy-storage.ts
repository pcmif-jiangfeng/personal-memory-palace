import { constants } from "node:fs";
import { copyFile, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  getImageDataDirectory,
  imageStorage,
  resolveStoredImagePath,
} from "./local-image-storage.ts";

async function containedPath(candidate: string) {
  const root = await realpath(getImageDataDirectory());
  const resolved = await realpath(candidate);
  const relative = path.relative(root, resolved);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("Invalid copy storage path");
  return resolved;
}

export const photoCopyStorage = {
  async size(key: string) {
    const file = await stat(await containedPath(resolveStoredImagePath(key)));
    if (!file.isFile() || !Number.isSafeInteger(file.size) || file.size <= 0)
      throw new Error("Invalid source photo asset");
    return file.size;
  },
  async copy(sourceKey: string, targetKey: string) {
    const source = await containedPath(resolveStoredImagePath(sourceKey));
    const target = resolveStoredImagePath(targetKey);
    await mkdir(path.dirname(target), { recursive: true });
    await containedPath(path.dirname(target));
    // A real copy, never a hard link. Generated target keys must not overwrite existing assets.
    await copyFile(source, target, constants.COPYFILE_EXCL);
  },
  remove: (keys: Array<string | null>) => imageStorage.remove(keys),
};
