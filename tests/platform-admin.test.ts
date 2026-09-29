import assert from "node:assert/strict";
import test from "node:test";
import { getPlatformAdminUserId, ConfigurationError } from "../src/config.ts";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import {
  isPlatformAdminInDatabase,
  requirePlatformAdminInDatabase,
} from "../src/data/platform-admin.ts";
import { requireMuseumAccessInDatabase } from "../src/data/museum-access.ts";
import { ApiError } from "../src/http/errors.ts";

test("single server-configured verified administrator; disabled and malformed config fail closed", () => {
  const previous = process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID;
  const db = initializeDatabase(":memory:", false);
  const users = ["admin", "owner"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      passwordHash: "hash",
      displayName: name,
    }),
  );
  try {
    db.prepare("UPDATE users SET email_verified=1").run();
    delete process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID;
    assert.equal(getPlatformAdminUserId(), null);
    assert.equal(isPlatformAdminInDatabase(db, users[0].id), false);
    for (const value of ["admin@example.com", `${users[0].id},${users[1].id}`, "*"]) {
      process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID = value;
      assert.throws(() => getPlatformAdminUserId(), ConfigurationError);
    }
    process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID = users[0].id;
    assert.equal(requirePlatformAdminInDatabase(db, users[0].id), users[0].id);
    assert.throws(
      () => requirePlatformAdminInDatabase(db, null),
      (e) => e instanceof ApiError && e.status === 401,
    );
    assert.throws(
      () => requirePlatformAdminInDatabase(db, users[1].id),
      (e) => e instanceof ApiError && e.status === 403,
    );
    const museum = createMuseumInDatabase(db, {
      ownerId: users[1].id,
      name: "Private",
      slug: "private",
    });
    assert.throws(
      () => requireMuseumAccessInDatabase(db, users[0].id, museum.id),
      (e) => e instanceof ApiError && e.status === 404,
    );
    db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(users[0].id);
    assert.equal(isPlatformAdminInDatabase(db, users[0].id), false);
    db.prepare("DELETE FROM users WHERE id=?").run(users[0].id);
    assert.equal(isPlatformAdminInDatabase(db, users[0].id), false);
  } finally {
    if (previous === undefined) delete process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID;
    else process.env.MEMORY_PALACE_PLATFORM_ADMIN_USER_ID = previous;
    db.close();
  }
});
