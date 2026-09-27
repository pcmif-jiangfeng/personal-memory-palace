import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { listSwitcherMuseumsInDatabase } from "../src/data/museum-switcher.ts";
import { currentSwitcherMuseum } from "../src/domain/museum-switcher.ts";

test("switcher lists Own first and only active joined museums without sensitive fields", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const users = ["self", "joined", "pending", "revoked", "other"].map((name) =>
      createUserInDatabase(db, {
        email: `${name}@example.com`,
        displayName: name,
        passwordHash: "hash",
      }),
    );
    const museums = users.map((user) =>
      createMuseumInDatabase(db, {
        ownerId: user.id,
        name: user.displayName,
        slug: user.displayName,
      }),
    );
    for (const museum of museums.slice(0, 4))
      db.prepare(
        "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
      ).run(museum.id, users[0].id);
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museums[2].id);
    db.prepare("UPDATE museum_memberships SET status='revoked' WHERE museum_id=?").run(
      museums[3].id,
    );
    const choices = listSwitcherMuseumsInDatabase(db, users[0].id);
    assert.deepEqual(
      choices.map((m) => m.id),
      [museums[0].id, museums[1].id],
    );
    assert.equal(choices[0].role, "owner");
    assert.equal(choices[1].role, "collaborator");
    assert.deepEqual(Object.keys(choices[0]).sort(), ["id", "name", "role"]);
    assert.equal(currentSwitcherMuseum(choices, "/account")?.id, museums[0].id);
    assert.equal(
      currentSwitcherMuseum(choices, `/account/museums/${museums[1].id}`)?.id,
      museums[1].id,
    );
    assert.equal(currentSwitcherMuseum(choices, `/account/museums/${museums[2].id}`), null);
    assert.equal(currentSwitcherMuseum(choices, "/account/museums/unknown"), null);
    assert.deepEqual(listSwitcherMuseumsInDatabase(db, "missing"), []);
    assert.equal(currentSwitcherMuseum([], "/account"), null);
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museums[0].id);
    assert.equal(listSwitcherMuseumsInDatabase(db, users[0].id)[0].role, "owner");
  } finally {
    db.close();
  }
});
