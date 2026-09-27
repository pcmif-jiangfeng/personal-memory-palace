import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { findMuseumByOwnerIdInDatabase } from "../src/data/museum-repository.ts";
import { createOwnMuseumInDatabase } from "../src/data/museum-onboarding.ts";
import { parseCreateMuseum } from "../src/http/museum-onboarding.ts";

function request(body: unknown) {
  return new Request("http://localhost/api/museums", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

test("onboarding requires name and a valid slug, with optional description and cover", async () => {
  assert.deepEqual(await parseCreateMuseum(request({ name: " 我的馆 ", slug: "my-museum" })), {
    name: "我的馆",
    slug: "my-museum",
    description: "",
  });
  for (const input of [
    { name: "", slug: "my-museum" },
    { name: "馆", slug: "" },
    { name: "馆", slug: "../other" },
    { name: "馆", slug: "my-museum", description: "a".repeat(501) },
    { name: 1, slug: "my-museum" },
  ])
    await assert.rejects(parseCreateMuseum(request(input)));
});

test("onboarding creates one own Museum and rejects occupied slugs without altering another user's Museum", () => {
  const database = initializeDatabase(":memory:", false);
  try {
    const first = createUserInDatabase(database, {
      email: "first@example.com",
      passwordHash: "hash",
      displayName: "一",
    });
    const second = createUserInDatabase(database, {
      email: "second@example.com",
      passwordHash: "hash",
      displayName: "二",
    });
    assert.equal(findMuseumByOwnerIdInDatabase(database, first.id), null);
    const museum = createOwnMuseumInDatabase(database, first.id, {
      name: "我的馆",
      slug: "my-museum",
      description: "",
    });
    assert.equal(museum.coverPhotoId, null);
    assert.deepEqual(findMuseumByOwnerIdInDatabase(database, first.id), museum);
    assert.throws(
      () =>
        createOwnMuseumInDatabase(database, first.id, {
          name: "第二座",
          slug: "another",
          description: "",
        }),
      /MUSEUM_ALREADY_EXISTS/,
    );
    assert.throws(
      () =>
        createOwnMuseumInDatabase(database, second.id, {
          name: "冲突",
          slug: "my-museum",
          description: "",
        }),
      /SLUG_TAKEN/,
    );
    assert.equal(findMuseumByOwnerIdInDatabase(database, second.id), null);
    assert.deepEqual(findMuseumByOwnerIdInDatabase(database, first.id), museum);
  } finally {
    database.close();
  }
});
