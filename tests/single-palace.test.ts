import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";

test("Task13B database prevents a second palace and ownership changes into a second palace", (t) => {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  const users = ["one", "two"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "fixture",
    }),
  );
  const museums = users.map((user) =>
    createMuseumInDatabase(db, { ownerId: user.id, name: "Palace", slug: user.id }),
  );
  assert.throws(
    () => createMuseumInDatabase(db, { ownerId: users[0].id, name: "Second", slug: "second" }),
    /UNIQUE/,
  );
  assert.throws(
    () => db.prepare("UPDATE museums SET owner_id=? WHERE id=?").run(users[0].id, museums[1].id),
    /UNIQUE/,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM museums").get()?.n, 2);
});

test("Task13B migration stops on historical duplicate ownership without merging or deleting records", (t) => {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  // Represent a v27 database: v22 permitted multiple owned palaces.
  db.exec(
    "DROP INDEX IF EXISTS museums_owner_unique; DELETE FROM schema_migrations WHERE version=28",
  );
  const user = createUserInDatabase(db, {
    email: "history@example.com",
    displayName: "History",
    passwordHash: "fixture",
  });
  for (const slug of ["first", "second"])
    createMuseumInDatabase(db, { ownerId: user.id, name: slug, slug });
  const before = db.prepare("SELECT * FROM museums ORDER BY id").all();
  assert.throws(() => runDatabaseMigrations(db), /multiple owned palaces/);
  assert.deepEqual(db.prepare("SELECT * FROM museums ORDER BY id").all(), before);
  assert.equal(db.prepare("SELECT 1 FROM schema_migrations WHERE version=28").get(), undefined);
});

test("one-palace index rollback and reapplication preserve every palace row", (t) => {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  const user = createUserInDatabase(db, {
    email: "rollback@example.com",
    displayName: "Rollback",
    passwordHash: "fixture",
  });
  createMuseumInDatabase(db, { ownerId: user.id, name: "Palace", slug: "rollback" });
  const before = db.prepare("SELECT * FROM museums").all();
  db.exec(
    "BEGIN; DROP INDEX museums_owner_unique; DELETE FROM schema_migrations WHERE version=28; COMMIT",
  );
  assert.deepEqual(db.prepare("SELECT * FROM museums").all(), before);
  runDatabaseMigrations(db);
  assert.deepEqual(db.prepare("SELECT * FROM museums").all(), before);
  assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE version=28").get());
});
