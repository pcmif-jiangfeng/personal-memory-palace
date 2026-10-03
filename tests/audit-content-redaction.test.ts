import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { writeAuditLogInDatabase } from "../src/data/audit-log.ts";
import { manageScopedMemory } from "../src/data/scoped-memory.ts";
import { redactObjectAuditInDatabase } from "../src/data/audit-content-redaction.ts";
import { withTransaction } from "../src/data/transaction.ts";

test("redaction requires a transaction and rollback preserves original details", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const actor = createUserInDatabase(db, {
      email: "rollback@example.com",
      displayName: "Actor",
      passwordHash: "hash",
    });
    const museum = createMuseumInDatabase(db, {
      ownerId: actor.id,
      name: "Rollback",
      slug: "rollback",
    });
    for (const objectType of ["memory", "stage", "photo", "laterNote"] as const) {
      const input = {
        actorUserId: actor.id,
        museumId: museum.id,
        objectType,
        objectId: "same",
        action: `${objectType}.details`,
        diff: { title: "original" },
      };
      writeAuditLogInDatabase(db, input);
      const before = db.prepare("SELECT * FROM audit_logs").all();
      assert.throws(
        () => redactObjectAuditInDatabase(db, museum.id, objectType, "same"),
        /transaction/,
      );
      assert.throws(
        () =>
          withTransaction(db, () => {
            redactObjectAuditInDatabase(db, museum.id, objectType, "same");
            throw new Error("delete failed");
          }),
        /delete failed/,
      );
      assert.deepEqual(db.prepare("SELECT * FROM audit_logs").all(), before);
      withTransaction(db, () => redactObjectAuditInDatabase(db, museum.id, objectType, "same"));
      assert.equal(
        db.prepare("SELECT diff FROM audit_logs WHERE object_type=?").get(objectType)!.diff,
        null,
      );
    }
  } finally {
    db.close();
  }
});

test("permanent Memory deletion removes its and cascaded Note log details without touching other objects", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const user = createUserInDatabase(db, {
      email: "redact@example.com",
      displayName: "Actor",
      passwordHash: "hash",
    });
    db.prepare("UPDATE users SET email_verified=1").run();
    const museum = createMuseumInDatabase(db, {
      ownerId: user.id,
      name: "Redaction",
      slug: "redaction",
    });
    const scope = { userId: user.id, museumId: museum.id };
    db.prepare(
      "INSERT INTO memories(id,museum_id,title,story,created_at,updated_at,trashed_at) VALUES ('deleted',?,'Title','Original','now','now','now')",
    ).run(museum.id);
    db.prepare(
      "INSERT INTO later_notes(id,museum_id,memory_id,content,created_at) VALUES ('note',?,'deleted','Note','now')",
    ).run(museum.id);
    for (const [objectType, objectId] of [
      ["memory", "deleted"],
      ["laterNote", "note"],
      ["memory", "keep"],
    ])
      writeAuditLogInDatabase(db, {
        actorUserId: user.id,
        museumId: museum.id,
        action: `${objectType}.details`,
        objectType,
        objectId,
        diff: { title: "PRIVATE-CONTENT", story: "PRIVATE-BODY" },
      });
    manageScopedMemory(db, scope, "deleted", { action: "permanent", confirm: true });
    const deleted = db
      .prepare("SELECT * FROM audit_logs WHERE object_id IN ('deleted','note')")
      .all();
    assert.ok(deleted.length >= 3);
    assert.ok(deleted.every((row) => row.diff === null));
    assert.ok(!JSON.stringify(deleted).includes("PRIVATE-"));
    assert.ok(
      String(db.prepare("SELECT diff FROM audit_logs WHERE object_id='keep'").get()!.diff).includes(
        "PRIVATE-CONTENT",
      ),
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM later_notes WHERE id='note'").get()!.n, 0);
  } finally {
    db.close();
  }
});
