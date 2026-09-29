import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { photoUuidPattern } from "./photo-storage-key.ts";

const museumIdPattern = new RegExp(`^${photoUuidPattern}$`);
const assetPattern = new RegExp(
  `^uploads/((?:demo|owner)|museums/${photoUuidPattern})/(optimized|original)/${photoUuidPattern}\\.(webp|jpg|jpeg|png)$`,
);

export function validateMuseumAssetKey(key: string, museumId: string) {
  const match = assetPattern.exec(key);
  if (
    !museumIdPattern.test(museumId) ||
    !match ||
    (match[1].startsWith("museums/") && match[1] !== `museums/${museumId}`) ||
    (match[2] === "optimized" && match[3] !== "webp")
  )
    throw new Error("Invalid Museum photo asset binding");
}

function readAssetStat(root: string, key: string) {
  let target = path.resolve(root);
  // Reject links at every level, not just lexical traversal: a junction can escape the image root.
  const parts = ["", ...key.split("/")];
  for (const [index, part] of parts.entries()) {
    target = path.join(target, part);
    let info;
    try {
      info = lstatSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error("Linked photo assets cannot be measured");
    if (index < parts.length - 1 && !info.isDirectory())
      throw new Error("Invalid photo asset directory");
    if (index === parts.length - 1) return info;
  }
  return null;
}

// Maintenance-only: the caller must quiesce file writers before measuring physical assets.
export function measureMuseumPhotoAssets(root: string, museumId: string, registeredKeys: string[]) {
  if (!museumIdPattern.test(museumId)) throw new Error("Invalid Museum id");
  const keys = new Set(registeredKeys);
  for (const key of keys) validateMuseumAssetKey(key, museumId);
  // Include unregistered final files left by an interrupted operation in this Museum's namespace.
  for (const variant of ["optimized", "original"]) {
    const directoryKey = `uploads/museums/${museumId}/${variant}`;
    const directory = readAssetStat(root, directoryKey);
    if (!directory) continue;
    if (!directory.isDirectory()) throw new Error("Invalid photo asset directory");
    for (const name of readdirSync(path.join(root, directoryKey))) {
      const key = `${directoryKey}/${name}`;
      if (!assetPattern.test(key)) continue;
      validateMuseumAssetKey(key, museumId);
      keys.add(key);
    }
  }
  let storageUsedBytes = 0;
  let fileCount = 0;
  const assets: Array<{ storageKey: string; bytes: number }> = [];
  const missingKeys: string[] = [];
  for (const key of [...keys].sort()) {
    const info = readAssetStat(root, key);
    if (!info) {
      missingKeys.push(key);
      continue;
    }
    if (!info.isFile()) throw new Error("Photo asset must be a regular file");
    storageUsedBytes += info.size;
    if (!Number.isSafeInteger(storageUsedBytes))
      throw new Error("Photo usage exceeds safe integer");
    fileCount += 1;
    assets.push({ storageKey: key, bytes: info.size });
  }
  return { storageUsedBytes, fileCount, missingKeys, assets };
}
