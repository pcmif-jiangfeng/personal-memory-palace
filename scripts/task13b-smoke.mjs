import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { initializeDatabase } from "../src/data/database.ts";
import { registerUserInDatabase } from "../src/data/user-registration.ts";
import { issueEmailCode } from "../src/data/email-code.ts";
import { createOwnMuseumInDatabase } from "../src/data/museum-onboarding.ts";
import { configureShareInDatabase } from "../src/data/share-repository.ts";

// Synthetic users and a disposable database only; the email callback never sends mail.
const directory = mkdtempSync(path.join(tmpdir(), "palace-task13b-smoke-"));
const secret = "isolated-task13b-smoke-session-secret-not-production";
process.env.MEMORY_PALACE_SESSION_SECRET = secret;
const db = initializeDatabase(path.join(directory, "palace.sqlite"), false);
const user = registerUserInDatabase(db, {
  email: "smoke@example.com",
  displayName: "测试昵称",
  password: "abcdefgh",
});
let code;
await issueEmailCode(db, user.id, "REGISTER", async (_address, value) => {
  code = value;
});
const other = registerUserInDatabase(db, {
  email: "other@example.com",
  displayName: "另一位用户",
  password: "abcdefgh",
});
db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(other.id);
const museum = createOwnMuseumInDatabase(db, other.id, {
  name: "他人的宫殿",
  slug: "smoke-other",
  description: "",
});
db.prepare(
  "INSERT INTO museum_memberships(museum_id,user_id,role,status,created_at,updated_at) VALUES (?,?,'collaborator','active','now','now')",
).run(museum.id, user.id);
db.prepare(
  "INSERT INTO memories(id,museum_id,title,story,is_public,created_at,updated_at) VALUES ('smoke-memory',?,'分享的记忆','仅这段故事',0,'now','now')",
).run(museum.id);
const token = configureShareInDatabase(db, "smoke-memory", "link");
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3013"], {
  cwd: process.cwd(),
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NODE_ENV: "production",
    MEMORY_PALACE_DATA_DIR: directory,
    MEMORY_PALACE_DATASET: "owner",
    MEMORY_PALACE_SESSION_SECRET: secret,
    MEMORY_PALACE_SECURE_COOKIES: "false",
    RESEND_API_KEY: "",
    MEMORY_PALACE_EMAIL_FROM: "",
  },
});
let browser;
const origin = "http://localhost:3013";
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      ready = (await fetch(`${origin}/account/login`)).ok;
    } catch {
      /* server boot */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "isolated server must start");
  const { chromium } =
    await import("file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs");
  browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/workspace`, { waitUntil: "networkidle" });
  assert.equal(new URL(page.url()).pathname, "/account/login");
  const login = await context.request.post(`${origin}/api/user-auth`, {
    headers: { Origin: origin },
    data: { email: user.email, password: "abcdefgh" },
  });
  assert.equal(login.status(), 200);
  assert.equal((await login.json()).emailVerified, false);
  await page.goto(`${origin}/workspace`, { waitUntil: "networkidle" });
  assert.equal(new URL(page.url()).pathname, "/verify-email");
  await page.getByLabel("六位邮箱验证码").fill(code);
  await page.getByRole("button", { name: "验证验证码", exact: true }).click();
  await page.waitForURL(`${origin}/`, { waitUntil: "networkidle" });
  const own = db.prepare("SELECT id FROM museums WHERE owner_id=?").get(user.id);
  assert.ok(own);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memories WHERE museum_id=?").get(own.id).n, 0);
  await page.goto(`${origin}/account/settings`, { waitUntil: "networkidle" });
  assert.ok((await page.locator("body").innerText()).includes("测试昵称"));
  const foreign = await context.request.get(`${origin}/api/photos?museumId=${museum.id}`);
  assert.ok([403, 404].includes(foreign.status()));
  for (const route of [
    `/account/museums/${museum.id}`,
    `/account/museums/${museum.id}/activity`,
    `/account/museums/${museum.id}/audit`,
    "/account/invites",
    "/invite",
    `/account/museums/${own.id}/transfer`,
    `/account/museums/${own.id}/collaborators`,
  ]) {
    const response = await page.goto(`${origin}${route}`, { waitUntil: "networkidle" });
    assert.equal(response.status(), 404, `retired or foreign page ${route}`);
  }
  const retired = [
    ["GET", "/api/invites"],
    ["POST", "/api/invites"],
    ["DELETE", "/api/invites/old"],
    ["POST", "/api/invites/accept"],
    ["POST", `/api/museums/${museum.id}/transfer`],
    ["DELETE", `/api/museums/${museum.id}/collaborators/${user.id}`],
    ["POST", `/api/museums/${museum.id}/leave`],
    ["POST", "/api/photos/old/copy"],
    ["POST", "/api/memories/smoke-memory/copy"],
  ];
  for (const [method, route] of retired) {
    const response = await context.request.fetch(`${origin}${route}`, {
      method,
      headers: { Origin: origin },
      data: {},
    });
    assert.equal(response.status(), 410, `retired endpoint ${route}`);
    assert.equal((await response.json()).error, "COLLABORATION_RETIRED");
  }
  const bypass = await context.request.post(`${origin}/api/museums/${museum.id}/memories`, {
    headers: { Origin: origin },
    data: {},
  });
  assert.ok(
    [403, 404].includes(bypass.status()),
    "historical collaboration cannot create foreign Memory",
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM museum_memberships").get().n, 1);
  assert.equal(
    db.prepare("SELECT owner_id FROM museums WHERE id=?").get(museum.id).owner_id,
    other.id,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memories").get().n, 1);
  await page.goto(`${origin}/share/${token}`, { waitUntil: "networkidle" });
  assert.ok((await page.locator("body").innerText()).includes("来自「另一位用户」的分享"));
  assert.equal((await page.locator("body").innerText()).includes(other.email), false);
  const anonymous = await browser.newContext();
  const visitor = await anonymous.newPage();
  visitor.on("pageerror", (error) => errors.push(error.message));
  await visitor.goto(`${origin}/share/${token}`, { waitUntil: "networkidle" });
  assert.ok((await visitor.locator("body").innerText()).includes("分享的记忆"));
  await visitor.goto(`${origin}/memories/smoke-memory`, { waitUntil: "networkidle" });
  assert.equal(new URL(visitor.url()).pathname, "/account/login");
  // Mock only external delivery. VERIFY/CONFIRM and session authorization use the real HTTP routes.
  async function passwordFlow(target, purpose, nextPassword) {
    let passwordCode;
    const delivery = async (route) => {
      const input = route.request().postDataJSON();
      if (input.action !== "SEND") return route.continue();
      assert.equal(input.purpose, purpose);
      await issueEmailCode(db, user.id, purpose, async (_email, value) => {
        passwordCode = value;
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    };
    await target.route("**/api/email-code", delivery);
    await target.goto(
      `${origin}${purpose === "CHANGE_PASSWORD" ? "/account/settings" : "/forgot-password"}`,
      { waitUntil: "networkidle" },
    );
    if (purpose === "CHANGE_PASSWORD")
      await target.locator("details.account-password summary").click();
    if (purpose === "RESET_PASSWORD")
      await target.getByLabel("邮箱", { exact: true }).fill(user.email);
    await target.getByRole("button", { name: "发送验证码", exact: true }).click();
    await target.getByLabel("六位邮箱验证码").waitFor();
    await target.getByLabel("六位邮箱验证码").fill(passwordCode);
    await target.getByRole("button", { name: "验证验证码", exact: true }).click();
    await target.getByLabel("新密码", { exact: true }).fill(nextPassword);
    await target.getByLabel("确认新密码", { exact: true }).fill(nextPassword);
    await target.getByRole("button", { name: "更新密码", exact: true }).click();
    await target.getByText("密码已更新。", { exact: false }).waitFor();
    await target.unroute("**/api/email-code", delivery);
  }
  await passwordFlow(page, "CHANGE_PASSWORD", "changed8");
  await page.goto(`${origin}/workspace`, { waitUntil: "networkidle" });
  assert.equal(
    new URL(page.url()).pathname,
    "/workspace",
    "password change must retain the current device session",
  );
  const oldLogin = await anonymous.request.post(`${origin}/api/user-auth`, {
    headers: { Origin: origin },
    data: { email: user.email, password: "abcdefgh" },
  });
  assert.equal(oldLogin.status(), 401);
  await passwordFlow(visitor, "RESET_PASSWORD", "reset888");
  await page.goto(`${origin}/workspace`, { waitUntil: "networkidle" });
  assert.equal(
    new URL(page.url()).pathname,
    "/account/login",
    "password reset must revoke prior sessions",
  );
  const changedLogin = await context.request.post(`${origin}/api/user-auth`, {
    headers: { Origin: origin },
    data: { email: user.email, password: "changed8" },
  });
  assert.equal(changedLogin.status(), 401);
  const resetLogin = await context.request.post(`${origin}/api/user-auth`, {
    headers: { Origin: origin },
    data: { email: user.email, password: "reset888" },
  });
  assert.equal(resetLogin.status(), 200);
  const legacy = await context.request.post(`${origin}/api/auth`, {
    headers: { Origin: origin },
    data: { password: "anything" },
  });
  assert.equal(legacy.status(), 410);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: private isolation, registration/change/reset code UI, current session retained after change and revoked after reset, old passwords and legacy auth denied, anonymous/logged-in read-only share, no browser errors",
  );
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => {
    server.once("exit", resolve);
    if (!server.kill()) resolve();
  });
  db.close();
  rmSync(directory, { recursive: true, force: true });
}
