import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { listPlatformMetadataInDatabase } from "../src/data/platform-admin-metadata.ts";
import { readPlatformAdminPage } from "../src/http/platform-admin-query.ts";
import { ApiError } from "../src/http/errors.ts";

test("metadata uses only explicit approved fields, bounded pagination and fresh admin permission", () => {
  const previous = process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID;
  const db = initializeDatabase(":memory:", false);
  try {
    const users = Array.from({ length: 27 }, (_, index) =>
      createUserInDatabase(db, {
        email: `user${index}@example.com`,
        displayName: `User ${index}`,
        passwordHash: "SECRET-HASH",
      }),
    );
    db.exec("UPDATE users SET email_verified=1");
    process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID = users[0].id;
    for (const [index, user] of users.entries())
      createMuseumInDatabase(db, {
        ownerId: user.id,
        name: `Museum ${index}`,
        slug: `museum-${index}`,
        description: "PRIVATE-DESCRIPTION",
      });
    const prepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      assert.doesNotMatch(
        sql,
        /\bmemories\b|\bstages\b|\bstory\b|\buploaded_photos\b|\bdescription\b|\bpassword_hash\b|\btoken_hash\b|SELECT\s+\*/i,
      );
      return prepare(sql);
    };
    const first = listPlatformMetadataInDatabase(db, users[0].id);
    const second = listPlatformMetadataInDatabase(db, users[0].id, 2, 2);
    assert.equal(first.usersTotal, 27);
    assert.equal(first.museumsTotal, 27);
    assert.equal(first.users.length, 25);
    assert.equal(first.museums.length, 25);
    assert.equal(second.users.length, 2);
    assert.equal(second.museums.length, 2);
    assert.equal(new Set([...first.users, ...second.users].map((u) => u.email)).size, 27);
    assert.equal(new Set([...first.museums, ...second.museums].map((m) => m.id)).size, 27);
    assert.deepEqual(Object.keys(first.users[0]).sort(), [
      "createdAt",
      "displayName",
      "email",
      "verified",
    ]);
    assert.deepEqual(Object.keys(first.museums[0]).sort(), [
      "createdAt",
      "id",
      "name",
      "owner",
      "slug",
      "status",
      "storageQuotaBytes",
      "storageUsedBytes",
    ]);
    assert.doesNotMatch(JSON.stringify(first), /SECRET-HASH|PRIVATE-DESCRIPTION/);
    for (const id of [null, users[1].id])
      assert.throws(() => listPlatformMetadataInDatabase(db, id), ApiError);
    for (const page of [0, -1, 1.5, NaN, Infinity, 1_000_000])
      assert.throws(() => listPlatformMetadataInDatabase(db, users[0].id, page), ApiError);
    db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(users[0].id);
    assert.throws(() => listPlatformMetadataInDatabase(db, users[0].id), ApiError);
  } finally {
    if (previous === undefined) delete process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID;
    else process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID = previous;
    db.close();
  }
});

test("admin query rejects repeated, fractional, negative and oversized pages", () => {
  assert.equal(readPlatformAdminPage(undefined), 1);
  assert.equal(readPlatformAdminPage("2"), 2);
  for (const value of ["", "0", "01", "-1", "1.1", "1000000", ["1", "2"]]) {
    assert.throws(() => readPlatformAdminPage(value), ApiError);
  }
});
