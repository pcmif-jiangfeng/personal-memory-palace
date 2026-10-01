import { lstat, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { photoUuidPattern } from "./photo-storage-key.ts";

async function information(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function inspectMuseumStorage(imageDirectory: string, museumId: string) {
  if (!new RegExp(`^${photoUuidPattern}$`).test(museumId))
    throw new Error("Invalid Museum storage ID");
  const imageInfo = await information(imageDirectory);
  if (!imageInfo) return { exists: false, files: 0, bytes: 0, directory: null };
  if (imageInfo.isSymbolicLink() || !imageInfo.isDirectory())
    throw new Error("Unsafe Museum storage root");
  const root = await realpath(imageDirectory);
  let current = root;
  for (const part of ["uploads", "museums", museumId]) {
    current = path.join(current, part);
    const info = await information(current);
    if (!info) return { exists: false, files: 0, bytes: 0, directory: null };
    if (info.isSymbolicLink() || !info.isDirectory() || (await realpath(current)) !== current)
      throw new Error("Unsafe Museum storage ancestor");
  }
  const directory = current;
  const relative = path.relative(root, directory);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("Unsafe Museum storage boundary");
  let files = 0;
  let bytes = 0;
  async function inspectTree(target: string) {
    for (const name of await readdir(target)) {
      const child = path.join(target, name);
      const info = await information(child);
      if (!info || info.isSymbolicLink()) throw new Error("Unsafe Museum storage entry");
      if (info.isDirectory()) await inspectTree(child);
      else if (info.isFile()) {
        files++;
        bytes += info.size;
      } else throw new Error("Unsafe Museum storage entry");
    }
  }
  await inspectTree(directory);
  return { exists: true, files, bytes, directory };
}

/** Internal storage operation: caller has a durable Museum cleanup job and has stopped all writers. */
export async function removeMuseumStorage(imageDirectory: string, museumId: string) {
  // Re-resolve immediately before removal; no untrusted process may mutate this hierarchy while quiesced.
  const storage = await inspectMuseumStorage(imageDirectory, museumId);
  if (storage.directory) await rm(storage.directory, { recursive: true, force: true });
  if ((await inspectMuseumStorage(imageDirectory, museumId)).exists)
    throw new Error("Museum photo cleanup is incomplete");
}
