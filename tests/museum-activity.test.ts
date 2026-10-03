import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { writeAuditLogInDatabase } from "../src/data/audit-log.ts";
import { activityPageSize, listMuseumActivityInDatabase } from "../src/data/museum-activity.ts";
import { museumActivityMessages } from "../src/domain/museum-activity.ts";
import { leaveMuseumInDatabase } from "../src/data/museum-leave.ts";
import { ApiError } from "../src/http/errors.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "member", "outsider", "unverified"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      passwordHash: "secret-hash",
      displayName: name,
    }),
  );
  for (const user of users.slice(0, 3))
    db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(user.id);
  const museums = [users[0], users[2]].map((user) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      slug: user.displayName,
      name: user.displayName,
    }),
  );
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museums[0].id, users[1].id);
  const event = (
    action = "memory.create",
    objectType = action.split(".")[0],
    museumId = museums[0].id,
  ) =>
    writeAuditLogInDatabase(db, {
      actorUserId: users[1].id,
      museumId,
      action,
      objectType,
      objectId: "private-object-id",
      diff: { privateText: "PRIVATE-DIFF-SENTINEL", token: "PRIVATE-TOKEN-SENTINEL" },
    });
  return { db, users, museums, event };
}

function denied(operation: () => unknown, status: number) {
  assert.throws(operation, (error) => error instanceof ApiError && error.status === status);
}

test("all reviewed content events produce only a name, simple summary, timestamp and event key", () => {
  const { db, users, museums, event } = fixture();
  try {
    for (const action of Object.keys(museumActivityMessages)) event(action);
    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      if (/\bSELECT\b/i.test(sql)) {
        assert.doesNotMatch(sql, /\bdiff\b|\bpassword_hash\b|\bemail\b|\bobject_id\b/i);
        assert.doesNotMatch(sql, /SELECT\s+(?:a\.)?\*/i);
      }
      return originalPrepare(sql);
    };
    const result = listMuseumActivityInDatabase(db, users[1].id, museums[0].id);
    assert.equal(result.total, Object.keys(museumActivityMessages).length);
    const entries = [
      ...result.entries,
      ...listMuseumActivityInDatabase(db, users[1].id, museums[0].id, 2).entries,
    ];
    assert.deepEqual(
      entries.map((entry) => entry.summary).sort(),
      Object.values(museumActivityMessages).sort(),
    );
    for (const entry of entries) {
      assert.deepEqual(Object.keys(entry).sort(), ["actorName", "id", "summary", "timestamp"]);
      assert.equal(entry.actorName, "member");
      assert.match(entry.timestamp, /^\d{4}-/);
    }
    assert.doesNotMatch(
      JSON.stringify(result),
      /PRIVATE-|private-object-id|@example.com|secret-hash|actorUserId|objectType/,
    );
  } finally {
    db.close();
  }
});

test("unknown, security, lifecycle, Admin and mismatched object events are excluded before counts", () => {
  const { db, users, museums, event } = fixture();
  try {
    event("memory.create");
    for (const action of [
      "invite.create",
      "invite.revoke",
      "membership.join",
      "membership.leave",
      "membership.remove",
      "owner.transfer",
      "museum.delete",
      "admin.controlledAccess",
      "memory.adminAccess",
      "photo.futureSecret",
      "stage.details.security",
      "__proto__",
      "toString",
    ])
      event(action);
    event("memory.create", "admin");
    event("memory.create", "memory", museums[1].id);
    const result = listMuseumActivityInDatabase(db, users[1].id, museums[0].id);
    assert.equal(result.total, 1);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].summary, "创建了一段记忆");
  } finally {
    db.close();
  }
});

test("anonymous, unknown, unverified, nonmember and cross-Museum requests cannot see activity", () => {
  const { db, users, museums, event } = fixture();
  try {
    event();
    for (const userId of [null, "", "missing"])
      denied(() => listMuseumActivityInDatabase(db, userId, museums[0].id), 401);
    denied(() => listMuseumActivityInDatabase(db, users[3].id, museums[0].id), 403);
    denied(() => listMuseumActivityInDatabase(db, users[2].id, museums[0].id), 404);
    for (const id of [museums[1].id, "missing", "' OR 1=1 --"])
      denied(() => listMuseumActivityInDatabase(db, users[1].id, id), 404);
    denied(() => listMuseumActivityInDatabase(db, users[2].id, museums[0].id, -1), 404);
  } finally {
    db.close();
  }
});

test("leaving, direct revocation and pending deletion invalidate subsequent activity requests", () => {
  const { db, users, museums, event } = fixture();
  try {
    event();
    assert.equal(listMuseumActivityInDatabase(db, users[1].id, museums[0].id).total, 1);
    leaveMuseumInDatabase(db, users[1].id, museums[0].id);
    denied(() => listMuseumActivityInDatabase(db, users[1].id, museums[0].id), 404);
    db.prepare("UPDATE museum_memberships SET status='active' WHERE museum_id=? AND user_id=?").run(
      museums[0].id,
      users[1].id,
    );
    assert.equal(listMuseumActivityInDatabase(db, users[1].id, museums[0].id).total, 1);
    db.prepare(
      "UPDATE museum_memberships SET status='revoked' WHERE museum_id=? AND user_id=?",
    ).run(museums[0].id, users[1].id);
    denied(() => listMuseumActivityInDatabase(db, users[1].id, museums[0].id, 2), 404);
    db.prepare("UPDATE museum_memberships SET status='active' WHERE museum_id=? AND user_id=?").run(
      museums[0].id,
      users[1].id,
    );
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museums[0].id);
    for (const userId of [users[0].id, users[1].id])
      denied(() => listMuseumActivityInDatabase(db, userId, museums[0].id), 404);
  } finally {
    db.close();
  }
});

test("filtered pagination stays full and stable when hidden events interleave at the same timestamp", () => {
  const { db, users, museums, event } = fixture();
  try {
    for (let i = 0; i < activityPageSize + 3; i++) {
      event();
      event("invite.create");
    }
    db.exec("UPDATE audit_logs SET timestamp='2026-09-28T00:00:00.000Z'");
    const expected = db
      .prepare(
        "SELECT id FROM audit_logs WHERE action='memory.create' ORDER BY timestamp DESC,id DESC",
      )
      .all()
      .map((row) => row.id);
    const first = listMuseumActivityInDatabase(db, users[1].id, museums[0].id);
    const second = listMuseumActivityInDatabase(db, users[1].id, museums[0].id, 2);
    assert.equal(first.total, activityPageSize + 3);
    assert.equal(second.total, first.total);
    assert.equal(first.entries.length, activityPageSize);
    assert.equal(second.entries.length, 3);
    assert.deepEqual(
      [...first.entries, ...second.entries].map((row) => row.id),
      expected,
    );
    assert.deepEqual(listMuseumActivityInDatabase(db, users[1].id, museums[0].id, 3).entries, []);
  } finally {
    db.close();
  }
});

test("deleted actors and deleted objects do not drop safe content activity", () => {
  const { db, users, museums, event } = fixture();
  try {
    const created = event("memory.restore");
    db.prepare("DELETE FROM users WHERE id=?").run(users[1].id);
    const result = listMuseumActivityInDatabase(db, users[0].id, museums[0].id);
    assert.equal(result.total, 1);
    assert.deepEqual(result.entries, [
      {
        id: created.id,
        actorName: "member",
        timestamp: created.timestamp,
        summary: "恢复了一段记忆",
      },
    ]);
  } finally {
    db.close();
  }
});

test("refresh finds new content while reads leave audit data unchanged", () => {
  const { db, users, museums, event } = fixture();
  try {
    assert.equal(listMuseumActivityInDatabase(db, users[1].id, museums[0].id).total, 0);
    event("photo.upload");
    const before = db.prepare("SELECT * FROM audit_logs").all();
    assert.equal(
      listMuseumActivityInDatabase(db, users[1].id, museums[0].id).entries[0].summary,
      "上传了一张照片",
    );
    assert.deepEqual(db.prepare("SELECT * FROM audit_logs").all(), before);
  } finally {
    db.close();
  }
});

test("invalid pages are rejected only after current Museum access is checked", () => {
  const { db, users, museums } = fixture();
  try {
    for (const page of [0, -1, 1.5, NaN, Infinity, 1000000])
      denied(() => listMuseumActivityInDatabase(db, users[1].id, museums[0].id, page), 400);
    denied(() => listMuseumActivityInDatabase(db, users[2].id, museums[0].id, NaN), 404);
  } finally {
    db.close();
  }
});
