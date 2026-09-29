import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase, findMuseumByIdInDatabase } from "../src/data/museum-repository.ts";
import { updateOwnMuseumSlugInDatabase } from "../src/data/museum-slug.ts";
import { parseUpdateMuseumSlug } from "../src/http/museum-slug.ts";

test("slug update accepts readable slugs and rejects invalid or missing values", async () => {
  const request = (body: unknown) =>
    new Request("http://localhost/api/museums", { method: "PATCH", body: JSON.stringify(body) });
  assert.deepEqual(await parseUpdateMuseumSlug(request({ slug: " new-museum " })), {
    slug: "new-museum",
  });
  for (const slug of [undefined, null, 1, "", "../museum", "UPPER", "a--b", "a".repeat(65)]) {
    await assert.rejects(parseUpdateMuseumSlug(request({ slug })), /INVALID_SLUG/);
  }
});

test("changing slug keeps museum ID, content and all museum-id foreign keys intact", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const owner = createUserInDatabase(db, {
      email: "slug@example.com",
      passwordHash: "hash",
      displayName: "馆长",
    });
    db.exec("UPDATE users SET email_verified=1");
    const museum = createMuseumInDatabase(db, {
      ownerId: owner.id,
      name: "人生馆",
      slug: "old-museum",
      description: "故事",
    });
    db.prepare(
      "INSERT INTO stages (id,museum_id,title,created_at,updated_at) VALUES ('stage',?,'阶段','now','now')",
    ).run(museum.id);
    db.prepare(
      "INSERT INTO memories (id,museum_id,stage_id,title,story,created_at,updated_at) VALUES ('memory',?,'stage','回忆','原始故事','now','now')",
    ).run(museum.id);
    db.prepare(
      "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES ('photo',?,'photo.jpg','image/jpeg','optimized/photo.webp',100,100,'now')",
    ).run(museum.id);
    db.prepare(
      "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES ('related',?,'关联回忆','故事','now','now')",
    ).run(museum.id);
    db.prepare(
      "INSERT INTO stage_covers (stage_id,storage_key,museum_id) VALUES ('stage','cover.webp',?)",
    ).run(museum.id);
    db.prepare(
      "INSERT INTO memory_images (id,memory_id,storage_key,created_at,museum_id) VALUES ('image','memory','image.webp','now',?)",
    ).run(museum.id);
    db.prepare(
      "INSERT INTO memory_relations (memory_id,related_memory_id,created_at,museum_id) VALUES ('memory','related','now',?)",
    ).run(museum.id);
    db.prepare(
      "INSERT INTO later_notes (id,memory_id,content,created_at,museum_id) VALUES ('note','memory','后来','now',?)",
    ).run(museum.id);
    db.prepare(
      "INSERT INTO share_configs (id,memory_id,created_at,updated_at,museum_id) VALUES ('share','memory','now','now',?)",
    ).run(museum.id);
    db.prepare(
      "INSERT INTO photo_deletion_jobs (photo_id,optimized_storage_key,created_at,museum_id) VALUES ('photo','optimized/photo.webp','now',?)",
    ).run(museum.id);
    db.prepare(
      "INSERT INTO pending_uploads (id,storage_key,created_at,museum_id) VALUES ('pending','pending/photo.webp','now',?)",
    ).run(museum.id);
    const tables = [
      "stages",
      "memories",
      "uploaded_photos",
      "stage_covers",
      "memory_images",
      "memory_relations",
      "later_notes",
      "share_configs",
      "photo_deletion_jobs",
      "pending_uploads",
    ];
    const before = tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    const result = updateOwnMuseumSlugInDatabase(db, owner.id, "new-museum");
    assert.equal(result.id, museum.id);
    assert.equal(result.slug, "new-museum");
    assert.equal(result.version, museum.version + 1);
    assert.equal(result.name, museum.name);
    assert.equal(result.description, museum.description);
    assert.deepEqual(
      tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all()),
      before,
    );
    assert.equal(db.prepare("SELECT id FROM museums WHERE slug = 'old-museum'").get(), undefined);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.deepEqual(updateOwnMuseumSlugInDatabase(db, owner.id, "new-museum"), result);
  } finally {
    db.close();
  }
});

test("slug conflicts preserve both Museums and users without a Museum cannot edit another owner's Museum", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const owners = ["one", "two", "none"].map((name) =>
      createUserInDatabase(db, {
        email: `${name}@example.com`,
        passwordHash: "hash",
        displayName: name,
      }),
    );
    db.exec("UPDATE users SET email_verified=1");
    const one = createMuseumInDatabase(db, { ownerId: owners[0].id, name: "一", slug: "one" });
    const two = createMuseumInDatabase(db, { ownerId: owners[1].id, name: "二", slug: "TWO" });
    assert.throws(() => updateOwnMuseumSlugInDatabase(db, owners[0].id, "two"), /SLUG_TAKEN/);
    assert.throws(
      () => updateOwnMuseumSlugInDatabase(db, owners[2].id, "hijack"),
      /MUSEUM_NOT_FOUND/,
    );
    assert.deepEqual(findMuseumByIdInDatabase(db, one.id), one);
    assert.deepEqual(findMuseumByIdInDatabase(db, two.id), two);
  } finally {
    db.close();
  }
});
