import type { DatabaseSync } from "node:sqlite";
import {
  finishMuseumPermanentDeletion,
  planMuseumPermanentDeletion,
  stageMuseumPermanentDeletion,
} from "../data/museum-permanent-deletion.ts";
import { inspectMuseumStorage, removeMuseumStorage } from "../storage/museum-storage-cleanup.ts";

export interface VerifiedMuseumBackup {
  create: () => Promise<string>;
  verify: (directory: string) => Promise<string>;
}

/** Server maintenance only. Stop web, mail, recovery and every other file/DB writer first. */
export async function permanentlyDeleteMuseum(
  db: DatabaseSync,
  imageDirectory: string,
  museumId: string,
  options: { quiesced: boolean; backup: VerifiedMuseumBackup; now?: Date },
) {
  if (!options.quiesced) throw new Error("Stop all writers and confirm --quiesced first");
  if (db.isTransaction || db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1)
    throw new Error("Deletion requires its own transaction and enabled foreign keys");
  const now = options.now ?? new Date();
  const before = planMuseumPermanentDeletion(db, museumId, now);
  await inspectMuseumStorage(imageDirectory, museumId);
  const directory = before.backupDirectory ?? (await options.backup.create());
  const fingerprint = await options.backup.verify(directory);
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error("Invalid verified backup fingerprint");
  if (before.backupFingerprint && fingerprint !== before.backupFingerprint)
    throw new Error("Original verified backup changed; cleanup refused");
  const current = planMuseumPermanentDeletion(db, museumId, now);
  if (JSON.stringify(current) !== JSON.stringify(before))
    throw new Error("Museum changed during backup; stop all writers before retrying");
  stageMuseumPermanentDeletion(db, museumId, { directory, fingerprint }, now);
  // Keep the journal and original backup on any filesystem or final transaction failure.
  planMuseumPermanentDeletion(db, museumId, now);
  await removeMuseumStorage(imageDirectory, museumId);
  finishMuseumPermanentDeletion(db, museumId, now);
  return { museumId, deleted: true, backupDirectory: directory, backupFingerprint: fingerprint };
}
