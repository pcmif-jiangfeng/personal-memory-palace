import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase, findMuseumByIdInDatabase } from "../src/data/museum-repository.ts";
import { updateOwnMuseumProfileInDatabase } from "../src/data/museum-profile.ts";
import { museumCoverChoicesInDatabase } from "../src/data/museum-profile.ts";
import { parseUpdateMuseumProfile } from "../src/http/museum-profile.ts";

test("profile validates required name, bounded description and nullable cover", async () => {
  const request = (body: unknown) =>
    new Request("http://localhost/api/museums", { method: "PATCH", body: JSON.stringify(body) });
  assert.deepEqual(
    await parseUpdateMuseumProfile(
      request({ name: " 馆 ", description: " 故事 ", coverPhotoId: null, version: 1 }),
    ),
    { name: "馆", description: "故事", coverPhotoId: null, version: 1 },
  );
  for (const body of [
    {},
    { name: "" },
    { name: "x".repeat(81) },
    { name: "馆", description: "x".repeat(501) },
    { name: "馆", description: "", coverPhotoId: 1 },
  ]) {
    await assert.rejects(parseUpdateMuseumProfile(request(body)));
  }
});

test("profile changes only own museum and rejects foreign, missing and deleting covers", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const users = ["one", "two", "none"].map((name) =>
      createUserInDatabase(db, {
        email: `${name}@example.com`,
        passwordHash: "hash",
        displayName: name,
      }),
    );
    const one = createMuseumInDatabase(db, { ownerId: users[0].id, name: "一", slug: "one" });
    const two = createMuseumInDatabase(db, { ownerId: users[1].id, name: "二", slug: "two" });
    for (const [id, museumId] of [
      ["own", one.id],
      ["foreign", two.id],
      ["deleting", one.id],
    ]) {
      db.prepare(
        "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES (?,?,'photo.jpg','image/jpeg',?,100,100,'now')",
      ).run(id, museumId, `${id}.webp`);
    }
    db.prepare(
      "INSERT INTO photo_deletion_jobs (photo_id,optimized_storage_key,created_at,museum_id) VALUES ('deleting','deleting.webp','now',?)",
    ).run(one.id);
    const input = {
      name: "新馆",
      description: "新故事",
      coverPhotoId: "own",
      version: one.version,
    };
    const choices = museumCoverChoicesInDatabase(db, one.id, null);
    assert.deepEqual(choices, [{ id: "own", name: "photo.jpg" }]);
    assert.equal(Object.getPrototypeOf(choices[0]), Object.prototype);
    const result = updateOwnMuseumProfileInDatabase(db, users[0].id, input);
    assert.equal(result.coverPhotoId, "own");
    assert.equal(result.name, "新馆");
    assert.equal(result.description, "新故事");
    assert.equal(result.slug, one.slug);
    assert.equal(result.version, one.version + 1);
    assert.deepEqual(
      updateOwnMuseumProfileInDatabase(db, users[0].id, { ...input, version: result.version }),
      result,
    );
    for (const coverPhotoId of ["foreign", "missing", "deleting"]) {
      assert.throws(
        () =>
          updateOwnMuseumProfileInDatabase(db, users[0].id, {
            ...input,
            version: result.version,
            name: "不保存",
            coverPhotoId,
          }),
        /INVALID_COVER_PHOTO/,
      );
      assert.deepEqual(findMuseumByIdInDatabase(db, one.id), result);
    }
    assert.throws(
      () => updateOwnMuseumProfileInDatabase(db, users[2].id, input),
      /MUSEUM_NOT_FOUND/,
    );
    assert.deepEqual(findMuseumByIdInDatabase(db, two.id), two);
    assert.equal(
      updateOwnMuseumProfileInDatabase(db, users[0].id, {
        ...input,
        version: result.version,
        coverPhotoId: null,
      }).coverPhotoId,
      null,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});
