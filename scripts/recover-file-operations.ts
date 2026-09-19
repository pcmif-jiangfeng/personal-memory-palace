import { getDatabase } from "../src/data/database.ts";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  recoverPendingPhotoDeletions,
  recoverPendingUploads,
} from "../src/data/photo-deletion-service.ts";
import { getDataDirectory } from "../src/config.ts";

const imageRoot = path.join(getDataDirectory(), "images");
const storage = {
  async remove(keys: Array<string | null>) {
    await Promise.all(
      keys
        .filter((key): key is string => Boolean(key))
        .map(async (key) => {
          const target = path.resolve(imageRoot, key);
          if (target !== imageRoot && !target.startsWith(`${imageRoot}${path.sep}`)) {
            throw new Error("Invalid image storage key");
          }
          await rm(target, { force: true });
        }),
    );
  },
};

const database = getDatabase();
const uploads = await recoverPendingUploads(database, storage);
const deletions = await recoverPendingPhotoDeletions(database, storage);
console.log(
  `File operation recovery: uploads=${uploads.recovered}/${uploads.failed}; deletions=${deletions.recovered}/${deletions.failed}`,
);
if (uploads.failed + deletions.failed > 0) process.exitCode = 1;
