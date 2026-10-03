import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { findMuseumByOwnerIdInDatabase } from "../src/data/museum-repository.ts";
import { createOwnMuseumInDatabase } from "../src/data/museum-onboarding.ts";
import { parseCreateMuseum } from "../src/http/museum-onboarding.ts";
import { ApiError } from "../src/http/errors.ts";

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
    museumType: "private",
  });
  for (const input of [
    { name: "", slug: "my-museum" },
    { name: "馆", slug: "" },
    { name: "馆", slug: "../other" },
    { name: "馆", slug: "my-museum", description: "a".repeat(501) },
    { name: 1, slug: "my-museum" },
    { name: "馆", slug: "my-museum", museumType: "other" },
    { name: "馆", slug: "my-museum", museumType: null },
    { name: "馆", slug: "my-museum", ownerId: "forged" },
    { name: "馆", slug: "my-museum", storageQuotaBytes: 100000000 },
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
    database.exec("UPDATE users SET email_verified=1");
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

test("shared creation is available repeatedly without extra allowance, and default lookup selects only private", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const user = createUserInDatabase(db, {
      email: "shared@example.com",
      displayName: "Owner",
      passwordHash: "hash",
    });
    db.prepare("UPDATE users SET email_verified=1,storage_quota_bytes=512 WHERE id=?").run(user.id);
    const shared = createOwnMuseumInDatabase(db, user.id, {
      name: "Shared",
      slug: "shared",
      description: "",
      museumType: "shared",
    });
    assert.equal(shared.museumType, "shared");
    assert.equal(findMuseumByOwnerIdInDatabase(db, user.id), null);
    const personal = createOwnMuseumInDatabase(db, user.id, {
      name: "Private",
      slug: "private",
      description: "",
    });
    assert.equal(personal.museumType, "private");
    for (let index = 0; index < 8; index++)
      createOwnMuseumInDatabase(db, user.id, {
        name: "Together",
        slug: `together-${index}`,
        description: "",
        museumType: "shared",
      });
    assert.equal(findMuseumByOwnerIdInDatabase(db, user.id)!.id, personal.id);
    assert.equal(
      db.prepare("SELECT storage_quota_bytes FROM users WHERE id=?").get(user.id)!
        .storage_quota_bytes,
      512,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM museums WHERE owner_id=?").get(user.id)!.n, 10);
    assert.throws(
      () =>
        createOwnMuseumInDatabase(db, user.id, {
          name: "Another",
          slug: "another",
          description: "",
        }),
      /MUSEUM_ALREADY_EXISTS/,
    );
    assert.throws(
      () =>
        createOwnMuseumInDatabase(db, user.id, {
          name: "Duplicate",
          slug: "shared",
          description: "",
          museumType: "shared",
        }),
      /SLUG_TAKEN/,
    );
  } finally {
    db.close();
  }
});

test("shared and private creation require a current verified user and never accept a caller quota", async () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const user = createUserInDatabase(db, {
      email: "unverified@example.com",
      displayName: "Owner",
      passwordHash: "hash",
    });
    for (const museumType of ["private", "shared"] as const) {
      assert.throws(
        () =>
          createOwnMuseumInDatabase(db, user.id, {
            name: "New",
            slug: "new",
            description: "",
            museumType,
          }),
        (error) => error instanceof ApiError && error.code === "EMAIL_VERIFICATION_REQUIRED",
      );
      assert.throws(
        () =>
          createOwnMuseumInDatabase(db, "missing", {
            name: "New",
            slug: "new",
            description: "",
            museumType,
          }),
        (error) => error instanceof ApiError && error.code === "USER_REQUIRED",
      );
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM museums").get()!.n, 0);
    assert.equal(
      db.prepare("SELECT storage_quota_bytes FROM users WHERE id=?").get(user.id)!
        .storage_quota_bytes,
      null,
    );
    assert.equal(
      (await parseCreateMuseum(request({ name: "Shared", slug: "shared", museumType: "shared" })))
        .museumType,
      "shared",
    );
  } finally {
    db.close();
  }
});
