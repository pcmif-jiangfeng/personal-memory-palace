import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { registerUserInDatabase } from "../src/data/user-registration.ts";
import { issueEmailCode, verifyEmailCode, finishPasswordCode } from "../src/data/email-code.ts";
import { loginUserInDatabase } from "../src/data/user-auth.ts";

test("email codes are hashed, purpose-bound, limited, replaceable and single-use", async (t) => {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  const user = registerUserInDatabase(db, {
    email: "code@example.com",
    displayName: "昵称",
    password: "password1",
  });
  const now = new Date("2026-10-02T00:00:00Z");
  let code = "";
  const send = async (_email: string, value: string) => {
    code = value;
  };
  await issueEmailCode(db, user.id, "REGISTER", send, now);
  assert.match(code, /^\d{6}$/);
  assert.notEqual(db.prepare("SELECT code_hash FROM email_codes").get()?.code_hash, code);
  await assert.rejects(issueEmailCode(db, user.id, "REGISTER", send, now), /CODE_COOLDOWN/);
  assert.equal(verifyEmailCode(db, user.id, "CHANGE_PASSWORD", code, now), null);
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++)
    assert.equal(verifyEmailCode(db, user.id, "REGISTER", wrong, now), null);
  assert.equal(verifyEmailCode(db, user.id, "REGISTER", code, now), null);
  const later = new Date(now.getTime() + 60_000);
  const oldCode = code;
  await issueEmailCode(db, user.id, "REGISTER", send, later);
  assert.notEqual(code, oldCode);
  assert.equal(verifyEmailCode(db, user.id, "REGISTER", oldCode, later), null);
  assert.equal(
    verifyEmailCode(db, user.id, "REGISTER", code, new Date(later.getTime() + 600_000)),
    null,
  );
  await issueEmailCode(db, user.id, "REGISTER", send, new Date(later.getTime() + 600_001));
  const fresh = new Date(later.getTime() + 600_001);
  assert.ok(verifyEmailCode(db, user.id, "REGISTER", code, fresh));
  assert.equal(verifyEmailCode(db, user.id, "REGISTER", code, fresh), null);
});

test("password grants are purpose/user-bound, consumed once and change password preserves sessions", async (t) => {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  const user = registerUserInDatabase(db, {
    email: "password@example.com",
    displayName: "昵称",
    password: "password1",
  });
  db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(user.id);
  const login = loginUserInDatabase(db, user.email, "password1");
  assert.equal(login.status, "authenticated");
  let code = "";
  await issueEmailCode(db, user.id, "CHANGE_PASSWORD", async (_email, c) => {
    code = c;
  });
  const grant = verifyEmailCode(db, user.id, "CHANGE_PASSWORD", code);
  assert.ok(grant);
  assert.equal(finishPasswordCode(db, "RESET_PASSWORD", grant, "password2", user.id), false);
  assert.equal(finishPasswordCode(db, "CHANGE_PASSWORD", grant, "password2", "other-user"), false);
  assert.equal(finishPasswordCode(db, "CHANGE_PASSWORD", grant, "password2", user.id), true);
  assert.equal(finishPasswordCode(db, "CHANGE_PASSWORD", grant, "password3", user.id), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_sessions").get()?.n, 1);
  assert.equal(loginUserInDatabase(db, user.email, "password1").status, "invalid");
  assert.equal(loginUserInDatabase(db, user.email, "password2").status, "authenticated");
});
