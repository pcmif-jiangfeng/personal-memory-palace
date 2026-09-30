import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { readScopedMemory, type MemoryScope } from "../data/scoped-memory.ts";
import { withTransaction } from "../data/transaction.ts";
import { writeAuditLogInDatabase } from "../data/audit-log.ts";
import { MAX_MEMORY_PHOTOS } from "../domain/rules.ts";
import { ApiError } from "../http/errors.ts";
import { photoCopyStorage } from "../storage/photo-copy-storage.ts";
import { copyPhotosToMuseum } from "./cross-museum-photo-copy.ts";

export async function copyMemoryToMuseum(
  db: DatabaseSync,
  source: MemoryScope,
  memoryId: string,
  targetMuseumId: string,
  storage = photoCopyStorage,
) {
  const memory = withTransaction(db, () => {
    const snapshot = readScopedMemory(db, source, memoryId);
    if (snapshot.images.length > MAX_MEMORY_PHOTOS)
      throw new ApiError("INVALID_MEMORY_BINDING", 400);
    const imageCount = db
      .prepare("SELECT COUNT(*) n FROM memory_images WHERE memory_id=?")
      .get(memoryId)!.n;
    const noteCount = db
      .prepare("SELECT COUNT(*) n FROM later_notes WHERE memory_id=?")
      .get(memoryId)!.n;
    if (imageCount !== snapshot.images.length || noteCount !== snapshot.laterNotes.length)
      throw new ApiError("INVALID_MEMORY_BINDING", 400);
    return snapshot;
  });
  return copyPhotosToMuseum(
    db,
    source,
    memory.images.map((image) => image.photoId),
    targetMuseumId,
    (photos) => {
      const current = readScopedMemory(db, source, memoryId);
      if (current.version !== memory.version) throw new ApiError("MEMORY_VERSION_CONFLICT", 409);
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO memories (id,museum_id,title,story,visibility,is_public,
      created_at,updated_at,created_by_user_id,last_edited_by_user_id)
      VALUES (?,?,?,?,'private',0,?,?,?,?)`,
      ).run(id, targetMuseumId, memory.title, memory.story, now, now, source.userId, source.userId);
      const insertImage = db.prepare(`INSERT INTO memory_images (id,museum_id,memory_id,storage_key,
      alt_text,exhibit_title,exhibit_description,sort_order,is_cover,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const [index, image] of memory.images.entries()) {
        insertImage.run(
          randomUUID(),
          targetMuseumId,
          id,
          photos[index].optimizedStorageKey,
          image.altText,
          image.exhibitTitle,
          image.exhibitDescription,
          image.sortOrder,
          image.isCover ? 1 : 0,
          now,
        );
        db.prepare("UPDATE uploaded_photos SET used_at=? WHERE id=? AND museum_id=?").run(
          now,
          photos[index].id,
          targetMuseumId,
        );
      }
      for (const note of memory.laterNotes)
        db.prepare(
          "INSERT INTO later_notes (id,museum_id,memory_id,content,created_at) VALUES (?,?,?,?,?)",
        ).run(randomUUID(), targetMuseumId, id, note.content, note.createdAt);
      writeAuditLogInDatabase(db, {
        actorUserId: source.userId,
        museumId: targetMuseumId,
        action: "memory.copy",
        objectType: "memory",
        objectId: id,
        diff: {
          sourceMuseumId: source.museumId,
          sourceMemoryId: memoryId,
          photoCount: photos.length,
        },
      });
      return { memoryId: id, museumId: targetMuseumId };
    },
    storage,
  );
}
