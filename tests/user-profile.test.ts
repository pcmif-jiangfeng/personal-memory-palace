import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase, findUserByIdInDatabase } from "../src/data/user-repository.ts";
import { updateOwnNicknameInDatabase } from "../src/data/user-profile.ts";
import { parseNicknameUpdate } from "../src/http/user-profile.ts";
import { accountDisplayLabel } from "../src/domain/user-profile.ts";

test("nickname update changes only the verified current User and permits duplicate names", (t) => {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  const users = ["one", "two"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "private-hash",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const before = findUserByIdInDatabase(db, users[1].id);
  assert.deepEqual(updateOwnNicknameInDatabase(db, users[0].id, "  小明 ABC123  "), {
    nickname: "小明 ABC123",
  });
  assert.deepEqual(findUserByIdInDatabase(db, users[1].id), before);
  updateOwnNicknameInDatabase(db, users[1].id, "小明 ABC123");
  assert.equal(findUserByIdInDatabase(db, users[0].id)!.displayName, "小明 ABC123");
  assert.equal(findUserByIdInDatabase(db, users[0].id)!.passwordHash, users[0].passwordHash);
  assert.equal(findUserByIdInDatabase(db, users[0].id)!.email, users[0].email);
  for (const id of [null, "missing"])
    assert.throws(() => updateOwnNicknameInDatabase(db, id, "昵称"), /USER_REQUIRED/);
  db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(users[0].id);
  assert.throws(() => updateOwnNicknameInDatabase(db, users[0].id, "昵称"), /USER_REQUIRED/);
});

test("nickname HTTP boundary trims and rejects empty, long, forged and unrelated fields", async () => {
  const request = (input: unknown) =>
    new Request("http://localhost/api/account/profile", {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  assert.deepEqual(await parseNicknameUpdate(request({ nickname: "  中文 Name123  " })), {
    nickname: "中文 Name123",
  });
  assert.deepEqual(await parseNicknameUpdate(request({ nickname: "中".repeat(50) })), {
    nickname: "中".repeat(50),
  });
  for (const input of [
    {},
    { nickname: " " },
    { nickname: 123 },
    { nickname: "中".repeat(51) },
    { nickname: "名字", userId: "another" },
    { nickname: "名字", email: "another@example.com" },
  ]) {
    await assert.rejects(parseNicknameUpdate(request(input)));
  }
});

test("account menu uses nickname and only falls back to email when missing", () => {
  assert.equal(accountDisplayLabel({ displayName: "  馆长  ", email: "one@example.com" }), "馆长");
  assert.equal(
    accountDisplayLabel({ displayName: " ", email: "one@example.com" }),
    "one@example.com",
  );
});
