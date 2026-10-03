import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { writeAuditLogInDatabase } from "../src/data/audit-log.ts";
import { auditPageSize, listMuseumAuditInDatabase } from "../src/data/audit-log-reader.ts";
import { readAuditLogQuery } from "../src/http/audit-log-query.ts";
import { ApiError } from "../src/http/errors.ts";

const all = { page: 1, objectType: "", objectId: "" };

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "member", "other", "unverified"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "secret-password-hash",
    }),
  );
  for (const user of users.slice(0, 3))
    db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(user.id);
  const museums = [users[0], users[2]].map((user) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      name: user.displayName,
      slug: user.displayName,
    }),
  );
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museums[0].id, users[1].id);
  function event(
    objectType = "memory",
    objectId = "deleted-object",
    museumId = museums[0].id,
    actorUserId = users[1].id,
  ) {
    return writeAuditLogInDatabase(db, {
      museumId,
      actorUserId,
      objectType,
      objectId,
      action: `${objectType}.details`,
      diff: { version: { before: 1, after: 2 }, isPublic: false },
    });
  }
  return { db, users, museums, event };
}

function denied(operation: () => unknown, status: number) {
  assert.throws(operation, (error) => error instanceof ApiError && error.status === status);
}

test("owner and member audit returns scoped summaries without raw details or account secrets", () => {
  const { db, users, museums, event } = fixture();
  try {
    const created = event();
    event("memory", "foreign", museums[1].id, users[2].id);
    const result = listMuseumAuditInDatabase(db, users[0].id, museums[0].id, all);
    assert.equal(result.total, 1);
    assert.equal(result.pageSize, auditPageSize);
    assert.deepEqual(result.entries, [
      {
        id: created.id,
        timestamp: created.timestamp,
        actorUserId: users[1].id,
        actorName: "member",
        action: "memory.details",
        objectType: "memory",
        objectId: "deleted-object",
        diff: null,
      },
    ]);
    assert.doesNotMatch(JSON.stringify(result), /password|secret|@example.com|foreign/);
    assert.deepEqual(listMuseumAuditInDatabase(db, users[1].id, museums[0].id, all), result);
  } finally {
    db.close();
  }
});

test("anonymous, unverified, nonmember and cross-Museum owners cannot read audit", () => {
  const { db, users, museums, event } = fixture();
  try {
    event();
    for (const userId of [null, "", "missing"])
      denied(() => listMuseumAuditInDatabase(db, userId, museums[0].id, all), 401);
    denied(() => listMuseumAuditInDatabase(db, users[3].id, museums[0].id, all), 403);
    denied(() => listMuseumAuditInDatabase(db, users[2].id, museums[0].id, all), 404);
    for (const museumId of ["missing", "' OR 1=1 --", museums[1].id])
      denied(() => listMuseumAuditInDatabase(db, users[0].id, museumId, all), 404);
    // Invalid filters do not bypass authorization or expose validation information first.
    denied(
      () => listMuseumAuditInDatabase(db, users[2].id, museums[0].id, { ...all, page: -1 }),
      404,
    );
  } finally {
    db.close();
  }
});

test("each read rechecks membership and ownership; pending deletion blocks all business audit access", () => {
  const { db, users, museums, event } = fixture();
  try {
    event();
    assert.equal(listMuseumAuditInDatabase(db, users[0].id, museums[0].id, all).total, 1);
    db.prepare("UPDATE museums SET owner_id=? WHERE id=?").run(users[1].id, museums[0].id);
    denied(() => listMuseumAuditInDatabase(db, users[0].id, museums[0].id, all), 404);
    assert.equal(listMuseumAuditInDatabase(db, users[1].id, museums[0].id, all).total, 1);
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museums[0].id);
    denied(() => listMuseumAuditInDatabase(db, users[1].id, museums[0].id, all), 404);
    db.prepare("UPDATE museums SET status='deleted' WHERE id=?").run(museums[0].id);
    denied(() => listMuseumAuditInDatabase(db, users[1].id, museums[0].id, all), 404);
  } finally {
    db.close();
  }
});

test("type and exact object ID filters are scoped, independently usable, and SQL-safe", () => {
  const { db, users, museums, event } = fixture();
  try {
    event("memory", "same");
    event("stage", "same");
    event("memory", "another");
    event("memory", "same", museums[1].id, users[2].id);
    for (const [objectType, objectId, total] of [
      ["memory", "same", 1],
      ["memory", "", 2],
      ["", "same", 2],
      ["future-object", "", 0],
      ["memory", "' OR 1=1 --", 0],
    ]) {
      const result = listMuseumAuditInDatabase(db, users[0].id, museums[0].id, {
        page: 1,
        objectType: String(objectType),
        objectId: String(objectId),
      });
      assert.equal(result.total, total);
      assert.equal(result.entries.length, total);
    }
  } finally {
    db.close();
  }
});

test("pagination is bounded and deterministic for events with equal timestamps", () => {
  const { db, users, museums, event } = fixture();
  try {
    for (let i = 0; i < auditPageSize + 3; i++) event("memory", "same");
    db.exec("UPDATE audit_logs SET timestamp='2026-09-28T00:00:00.000Z'");
    const expected = db
      .prepare("SELECT id FROM audit_logs ORDER BY timestamp DESC,id DESC")
      .all()
      .map((row) => row.id);
    const first = listMuseumAuditInDatabase(db, users[0].id, museums[0].id, all);
    const second = listMuseumAuditInDatabase(db, users[0].id, museums[0].id, { ...all, page: 2 });
    assert.equal(first.entries.length, auditPageSize);
    assert.equal(second.entries.length, 3);
    assert.equal(first.total, auditPageSize + 3);
    assert.equal(second.total, first.total);
    assert.deepEqual(
      [...first.entries, ...second.entries].map((row) => row.id),
      expected,
    );
    assert.deepEqual(
      listMuseumAuditInDatabase(db, users[0].id, museums[0].id, { ...all, page: 3 }).entries,
      [],
    );
  } finally {
    db.close();
  }
});

test("audit preserves deleted actors and objects but excludes unknown actions", () => {
  const { db, users, museums, event } = fixture();
  try {
    const created = event();
    db.prepare("DELETE FROM users WHERE id=?").run(users[1].id);
    const result = listMuseumAuditInDatabase(db, users[0].id, museums[0].id, all);
    assert.equal(result.total, 1);
    assert.equal(result.entries[0].actorUserId, null);
    assert.equal(result.entries[0].actorName, "member");
    assert.equal(result.entries[0].objectId, "deleted-object");
    assert.equal(result.entries[0].action, "memory.details");
    assert.equal(result.entries[0].diff, null);
    db.prepare("UPDATE audit_logs SET action='future.action' WHERE id=?").run(created.id);
    assert.equal(listMuseumAuditInDatabase(db, users[0].id, museums[0].id, all).total, 0);
  } finally {
    db.close();
  }
});

test("refreshing audit reads new events without mutating logs", () => {
  const { db, users, museums, event } = fixture();
  try {
    assert.equal(listMuseumAuditInDatabase(db, users[0].id, museums[0].id, all).total, 0);
    event();
    const before = db.prepare("SELECT * FROM audit_logs").all();
    assert.equal(listMuseumAuditInDatabase(db, users[0].id, museums[0].id, all).total, 1);
    assert.deepEqual(db.prepare("SELECT * FROM audit_logs").all(), before);
  } finally {
    db.close();
  }
});

test("member audit never selects raw diff and revocation immediately blocks later pages", () => {
  const { db, users, museums, event } = fixture();
  try {
    const content = event();
    db.prepare("UPDATE audit_logs SET diff=? WHERE id=?").run(
      '{"email":"private@example.com","token":"SECRET"}',
      content.id,
    );
    writeAuditLogInDatabase(db, {
      actorUserId: users[0].id,
      museumId: museums[0].id,
      objectType: "support",
      objectId: "secret",
      action: "support.privateRead",
      diff: { token: "SECRET" },
    });
    const prepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      if (/\bSELECT\b/i.test(sql)) assert.doesNotMatch(sql, /\bdiff\b|SELECT\s+(?:a\.)?\*/i);
      return prepare(sql);
    };
    const result = listMuseumAuditInDatabase(db, users[1].id, museums[0].id, all);
    assert.equal(result.total, 1);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|private@example.com|support/);
    db.prepare(
      "UPDATE museum_memberships SET status='revoked' WHERE museum_id=? AND user_id=?",
    ).run(museums[0].id, users[1].id);
    denied(
      () => listMuseumAuditInDatabase(db, users[1].id, museums[0].id, { ...all, page: 2 }),
      404,
    );
  } finally {
    db.close();
  }
});

test("audit query accepts defaults and trimmed filters but rejects ambiguous or unbounded inputs", () => {
  assert.deepEqual(readAuditLogQuery({}), all);
  assert.deepEqual(readAuditLogQuery({ page: "2", objectType: " memory ", objectId: " same " }), {
    page: 2,
    objectType: "memory",
    objectId: "same",
  });
  for (const query of [
    { page: "0" },
    { page: "-1" },
    { page: "1.5" },
    { page: "1e2" },
    { page: "01" },
    { page: "1000000" },
    { page: ["1", "2"] },
    { objectId: ["a", "b"] },
    { objectType: ["memory", "stage"] },
    { objectType: "m".repeat(81) },
    { objectId: "i".repeat(161) },
  ])
    denied(() => readAuditLogQuery(query), 400);
  const { db, users, museums } = fixture();
  try {
    for (const page of [0, -1, 1.5, NaN, Infinity, 1000000])
      denied(
        () => listMuseumAuditInDatabase(db, users[0].id, museums[0].id, { ...all, page }),
        400,
      );
  } finally {
    db.close();
  }
});
