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
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import sharp from "sharp";
import { verifyCollaborativeEditing } from "./collaboration-edit-smoke.mjs";
import { verifyCollaborativeNotes } from "./collaboration-note-smoke.mjs";
import { verifyPhotoTrash } from "./collaboration-photo-trash-smoke.mjs";
import { verifyOwnerTransfer } from "./collaboration-transfer-smoke.mjs";
import { verifySharedDeletion } from "./collaboration-deletion-smoke.mjs";

// Synthetic users and a disposable database only; the email callback never sends mail.
const directory = mkdtempSync(path.join(tmpdir(), "palace-task13b-smoke-"));
const screenshotDirectory = process.argv.includes("--screenshots")
  ? mkdtempSync(path.join(tmpdir(), "palace-collaboration-ui-"))
  : null;
const secret = "isolated-task13b-smoke-session-secret-not-production";
process.env.MEMORY_PALACE_SESSION_SECRET = secret;
const db = initializeDatabase(path.join(directory, "palace.sqlite"), false);
// Fixture-only time travel uses a second process's DB; let its short transactions finish.
db.exec("PRAGMA busy_timeout=5000");
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
// Model a pre-collaboration grant through the actual one-time migration, not a new active grant.
db.prepare("DELETE FROM schema_migrations WHERE version=29").run();
runDatabaseMigrations(db);
assert.equal(db.prepare("SELECT status FROM museum_memberships").get().status, "revoked");
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
    MEMORY_PALACE_PLATFORM_ADMIN_USER_ID: other.id,
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
    "/invite",
    `/account/museums/${own.id}/transfer`,
  ]) {
    const response = await page.goto(`${origin}${route}`, { waitUntil: "networkidle" });
    assert.equal(response.status(), 404, `retired or foreign page ${route}`);
  }
  await page.goto(`${origin}/account/museums/${own.id}/collaborators`, {
    waitUntil: "networkidle",
  });
  await page.getByRole("heading", { name: "管理本馆成员", exact: true }).waitFor();
  await page.getByText("这座宫殿还没有协作者。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "退出宫殿", exact: true }).count(), 0);
  const retired = [
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
  const foreignTransfer = await context.request.post(
    `${origin}/api/museums/${museum.id}/transfer`,
    {
      headers: { Origin: origin },
      data: { action: "request", targetUserId: user.id, version: 1, confirm: true },
    },
  );
  assert.equal(foreignTransfer.status(), 404);
  const privateTransfer = await context.request.post(`${origin}/api/museums/${own.id}/transfer`, {
    headers: { Origin: origin },
    data: { action: "request", targetUserId: other.id, version: 1, confirm: true },
  });
  assert.equal(privateTransfer.status(), 410);
  const oldInvite = await context.request.post(`${origin}/api/invites/accept`, {
    headers: { Origin: origin },
    data: { token: "a".repeat(43) },
  });
  assert.equal(
    oldInvite.status(),
    400,
    "legacy bearer input must still fail after email invites reopen",
  );
  const memberRemovalBypass = await context.request.delete(
    `${origin}/api/museums/${museum.id}/collaborators/${user.id}`,
    { headers: { Origin: origin }, data: { confirm: true } },
  );
  assert.equal(
    memberRemovalBypass.status(),
    404,
    "revoked historical members cannot reach owner management",
  );
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
  const accountDeletion = await context.request.get(`${origin}/api/account/deletion-preconditions`);
  assert.equal(accountDeletion.status(), 410);
  assert.equal((await accountDeletion.json()).error, "ACCOUNT_DELETION_DISABLED");
  await page.goto(`${origin}/account/deletion`, { waitUntil: "networkidle" });
  await page.getByText("当前不提供账号注销或私人宫殿整馆删除。", { exact: true }).waitFor();
  assert.equal(await page.locator(".audit-panel form").count(), 0);
  await page.goto(`${origin}/account/museums/${own.id}/deletion`, { waitUntil: "networkidle" });
  await page.getByText("私人宫殿不提供整馆删除。", { exact: true }).waitFor();
  assert.equal(await page.locator(".audit-panel form").count(), 0);
  for (const method of ["POST", "DELETE"]) {
    const response = await context.request.fetch(`${origin}/api/museums/${own.id}/deletion`, {
      method,
      headers: { Origin: origin },
      data: { confirm: true, version: 1 },
    });
    assert.equal(response.status(), 410);
    assert.equal((await response.json()).error, "PRIVATE_PALACE_DELETION_DISABLED");
  }
  const foreignOrigin = await context.request.post(`${origin}/api/museums/${own.id}/deletion`, {
    headers: { Origin: "https://attacker.example" },
    data: {},
  });
  assert.equal(foreignOrigin.status(), 403);
  assert.equal(db.prepare("SELECT status FROM museums WHERE id=?").get(own.id).status, "active");
  await page.goto(`${origin}/account/invites?museumId=${own.id}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "管理本馆邀请", exact: true }).waitFor();
  await page.getByLabel("受邀邮箱", { exact: true }).fill(other.email);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const inputBounds = await page.getByLabel("受邀邮箱", { exact: true }).boundingBox();
    assert.ok(inputBounds && inputBounds.x >= 0 && inputBounds.x + inputBounds.width <= width);
    if (screenshotDirectory && (width === 320 || width === 1440)) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(screenshotDirectory, `invite-owner-${width}.png`),
        fullPage: true,
      });
    }
  }
  const inviteResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/invites?") && response.request().method() === "POST",
  );
  await page.getByLabel("受邀邮箱", { exact: true }).focus();
  await page.getByLabel("受邀邮箱", { exact: true }).press("Tab");
  assert.equal(
    await page
      .getByRole("button", { name: "发送邀请", exact: true })
      .evaluate((button) => button === document.activeElement),
    true,
  );
  await page.getByRole("button", { name: "发送邀请", exact: true }).press("Enter");
  const invitation = await inviteResponse;
  assert.equal(invitation.status(), 201);
  const invitationPayload = await invitation.json();
  await page.getByRole("status").filter({ hasText: "邮件发送失败" }).waitFor();
  assert.equal(
    invitationPayload.delivery,
    "failed",
    "missing mail configuration must not be reported as sent",
  );
  const invitationRetry = await context.request.post(`${origin}/api/invites?museumId=${own.id}`, {
    headers: { Origin: origin },
    data: { targetEmail: other.email },
  });
  assert.equal(invitationRetry.status(), 200);
  assert.deepEqual((await invitationRetry.json()).invite, invitationPayload.invite);
  const wrongRecipient = await context.request.post(`${origin}/api/invites/accept`, {
    headers: { Origin: origin },
    data: { inviteId: invitationPayload.invite.id },
  });
  assert.equal(wrongRecipient.status(), 404);
  const wrongInvitePage = await context.request.get(
    `${origin}/account/invites?inviteId=${invitationPayload.invite.id}`,
  );
  assert.equal(
    wrongInvitePage.status(),
    404,
    "forwarded locator must not disclose a recipient page",
  );
  const invitedContext = await browser.newContext();
  const invitedLogin = await invitedContext.request.post(`${origin}/api/user-auth`, {
    headers: { Origin: origin },
    data: { email: other.email, password: "abcdefgh" },
  });
  assert.equal(invitedLogin.status(), 200);
  const crossOriginAccept = await invitedContext.request.post(`${origin}/api/invites/accept`, {
    headers: { Origin: "https://attacker.example" },
    data: { inviteId: invitationPayload.invite.id },
  });
  assert.equal(crossOriginAccept.status(), 403);
  const invitedPage = await invitedContext.newPage();
  invitedPage.on("pageerror", (error) => errors.push(error.message));
  await invitedPage.goto(`${origin}/account/invites?inviteId=${invitationPayload.invite.id}`, {
    waitUntil: "networkidle",
  });
  await invitedPage.getByRole("heading", { name: "收到的邀请", exact: true }).waitFor();
  assert.equal(await invitedPage.locator(".invitation-list").count(), 1);
  assert.equal((await invitedPage.locator(".invitation-list").innerText()).includes("@"), false);
  for (const width of [320, 768, 1024, 1440]) {
    await invitedPage.setViewportSize({ width, height: 900 });
    const bounds = await invitedPage
      .getByRole("button", { name: "接受邀请", exact: true })
      .boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
    if (screenshotDirectory && (width === 320 || width === 1440)) {
      await invitedPage.evaluate(() => window.scrollTo(0, 0));
      await invitedPage.screenshot({
        path: path.join(screenshotDirectory, `invite-recipient-${width}.png`),
        fullPage: true,
      });
    }
  }
  const acceptedResponse = invitedPage.waitForResponse((response) =>
    response.url().endsWith("/api/invites/accept"),
  );
  await invitedPage.getByRole("button", { name: "接受邀请", exact: true }).focus();
  await invitedPage.getByRole("button", { name: "接受邀请", exact: true }).press("Enter");
  const acceptedInvitation = await acceptedResponse;
  assert.equal(acceptedInvitation.status(), 200);
  assert.equal((await acceptedInvitation.json()).museum.id, own.id);
  await invitedPage
    .getByText(/已接受/)
    .first()
    .waitFor();
  const memberInvites = await invitedContext.request.get(
    `${origin}/api/invites?museumId=${own.id}`,
  );
  assert.equal(memberInvites.status(), 403, "collaborators cannot read owner invitation addresses");
  await invitedPage.goto(`${origin}/account?museumId=${own.id}`, { waitUntil: "networkidle" });
  assert.ok((await invitedPage.locator("main").innerText()).includes("你的身份：协作者"));
  assert.equal(await invitedPage.getByLabel("宫殿名称", { exact: true }).count(), 0);
  assert.equal(
    await invitedPage.getByRole("link", { name: "管理本馆邀请", exact: true }).count(),
    0,
  );
  assert.equal((await invitedPage.locator("main").innerText()).includes(user.email), false);
  const choices = await invitedPage
    .getByLabel("切换宫殿", { exact: true })
    .locator("option")
    .evaluateAll((options) => options.map((option) => option.value));
  assert.ok(choices.includes(own.id) && choices.includes(museum.id));
  await invitedPage.getByLabel("切换宫殿", { exact: true }).selectOption(museum.id);
  await invitedPage.waitForURL(`${origin}/account?museumId=${museum.id}`, {
    waitUntil: "load",
  });
  await invitedPage.getByRole("heading", { level: 1, name: museum.name, exact: true }).waitFor();
  const independentTab = await invitedContext.newPage();
  independentTab.on("pageerror", (error) => errors.push(error.message));
  await independentTab.goto(`${origin}/workspace?museumId=${own.id}`, { waitUntil: "networkidle" });
  assert.equal(await independentTab.getByLabel("切换宫殿", { exact: true }).inputValue(), own.id);
  assert.equal(await invitedPage.getByLabel("切换宫殿", { exact: true }).inputValue(), museum.id);
  await independentTab.close();
  await invitedPage.goto(`${origin}/account/museums/${own.id}/collaborators`, {
    waitUntil: "networkidle",
  });
  await invitedPage.getByRole("heading", { name: "成员与退出", exact: true }).waitFor();
  assert.equal(
    await invitedPage.getByRole("button", { name: "移除协作者", exact: true }).count(),
    0,
  );
  await page.goto(`${origin}/account/museums/${own.id}/collaborators`, {
    waitUntil: "networkidle",
  });
  assert.equal(
    await page.getByRole("heading", { name: other.displayName, exact: true }).count(),
    1,
  );
  assert.equal((await page.locator("main").innerText()).includes(other.email), false);
  for (const width of [320, 768, 1024, 1440]) {
    for (const [target, label] of [
      [page, "members-owner"],
      [invitedPage, "members-collaborator"],
    ]) {
      await target.setViewportSize({ width, height: 900 });
      assert.equal(
        await target.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
      if (screenshotDirectory && (width === 320 || width === 1440)) {
        await target.evaluate(() => window.scrollTo(0, 0));
        await target.screenshot({
          path: path.join(screenshotDirectory, `${label}-${width}.png`),
          fullPage: true,
        });
      }
    }
  }
  // Freshly accepted membership, rather than any historical or forwarded grant, opens this target.
  for (const route of ["/", "/workspace", "/stages", "/trash"]) {
    const response = await invitedPage.goto(`${origin}${route}?museumId=${own.id}`, {
      waitUntil: "networkidle",
    });
    assert.equal(response.status(), 200, `active member page ${route}`);
  }
  for (const route of ["/api/memories", "/api/photos", "/api/stages"]) {
    const response = await invitedContext.request.get(`${origin}${route}?museumId=${own.id}`);
    assert.equal(response.status(), 200, `active member request ${route}`);
    assert.equal(response.headers()["cache-control"], "no-store");
  }
  const duplicateTarget = await invitedContext.request.get(
    `${origin}/api/memories?museumId=${own.id}&museumId=${museum.id}`,
  );
  assert.equal(duplicateTarget.status(), 400);
  const conflictingTarget = await invitedContext.request.post(
    `${origin}/api/museums/${own.id}/memories?museumId=${museum.id}`,
    { headers: { Origin: origin }, data: {} },
  );
  assert.equal(conflictingTarget.status(), 400);
  const scopedCreation = await invitedContext.request.post(
    `${origin}/api/museums/${own.id}/memories`,
    { headers: { Origin: origin }, data: {} },
  );
  assert.equal(scopedCreation.status(), 400, "authorized member reaches input validation");
  db.prepare("UPDATE users SET storage_quota_bytes=1048576 WHERE id=?").run(user.id);
  const webp = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#597c86" } })
    .webp()
    .toBuffer();
  const upload = await invitedContext.request.post(`${origin}/api/photos?museumId=${own.id}`, {
    headers: { Origin: origin },
    multipart: { photos: { name: "collaborator.webp", mimeType: "image/webp", buffer: webp } },
  });
  assert.equal(upload.status(), 201, await upload.text());
  const uploaded = (await upload.json()).photos[0];
  const photoRow = db.prepare("SELECT * FROM uploaded_photos WHERE id=?").get(uploaded.id);
  const mediaUrl = `${origin}/media/${photoRow.optimized_storage_key}`;
  for (const actor of [context, invitedContext]) {
    const media = await actor.request.get(mediaUrl);
    assert.equal(media.status(), 200);
    assert.equal(media.headers()["cache-control"], "private, no-store");
    assert.equal((await media.body()).length, webp.length);
  }
  assert.equal((await anonymous.request.get(mediaUrl)).status(), 404);
  const createdMemory = await invitedContext.request.post(
    `${origin}/api/museums/${own.id}/memories`,
    {
      headers: { Origin: origin },
      data: {
        title: "成员创建的记忆",
        story: "完整贡献保留",
        photoIds: [uploaded.id],
        coverPhotoId: uploaded.id,
      },
    },
  );
  assert.equal(createdMemory.status(), 201, await createdMemory.text());
  const collaborativeMemory = (await createdMemory.json()).memory;
  const memoryUrl = `${origin}/api/memories/${collaborativeMemory.id}?museumId=${own.id}`;
  assert.equal((await invitedContext.request.get(memoryUrl)).status(), 200);
  for (const isPublic of [true, false]) {
    const publication = await invitedContext.request.post(memoryUrl, {
      headers: { Origin: origin },
      data: { action: "publication", isPublic },
    });
    assert.equal(publication.status(), 403);
  }
  const shareBypass = await invitedContext.request.post(`${origin}/api/shares?museumId=${own.id}`, {
    headers: { Origin: origin },
    data: { memoryId: collaborativeMemory.id, enabled: true, mode: "link" },
  });
  assert.equal(shareBypass.status(), 403);
  const deletePhoto = await invitedContext.request.delete(
    `${origin}/api/photos?museumId=${own.id}`,
    {
      headers: { Origin: origin },
      data: { ids: [uploaded.id], confirm: true },
    },
  );
  assert.equal(deletePhoto.status(), 200);
  assert.deepEqual((await deletePhoto.json()).deletedIds, [uploaded.id]);
  assert.equal((await invitedContext.request.get(mediaUrl)).status(), 404);
  assert.equal((await context.request.get(mediaUrl)).status(), 404);
  const memberPermanentPhoto = await invitedContext.request.post(
    `${origin}/api/trash?museumId=${own.id}`,
    {
      headers: { Origin: origin },
      data: { type: "photo", action: "permanent", ids: [uploaded.id], confirm: true },
    },
  );
  assert.equal(memberPermanentPhoto.status(), 200);
  assert.equal((await memberPermanentPhoto.json()).failures[0].error, "MUSEUM_OWNER_REQUIRED");
  const photoRestore = await invitedContext.request.post(`${origin}/api/trash?museumId=${own.id}`, {
    headers: { Origin: origin },
    data: { type: "photo", action: "restore", ids: [uploaded.id] },
  });
  assert.deepEqual((await photoRestore.json()).succeededIds, [uploaded.id]);
  assert.equal((await invitedContext.request.get(mediaUrl)).status(), 200);
  const trashMemory = await invitedContext.request.post(memoryUrl, {
    headers: { Origin: origin },
    data: { action: "trash" },
  });
  assert.equal(trashMemory.status(), 200);
  assert.equal(
    (
      await invitedContext.request.post(memoryUrl, {
        headers: { Origin: origin },
        data: { action: "permanent", confirm: true },
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await invitedContext.request.post(memoryUrl, {
        headers: { Origin: origin },
        data: { action: "restore" },
      })
    ).status(),
    200,
  );
  await verifyCollaborativeEditing({
    owner: context,
    member: invitedContext,
    visitor: anonymous,
    origin,
    museumId: own.id,
    memoryId: collaborativeMemory.id,
  });
  await verifyCollaborativeNotes({
    owner: context,
    member: invitedContext,
    visitor: anonymous,
    origin,
    museumId: own.id,
    memoryId: collaborativeMemory.id,
    screenshotDirectory,
  });
  await verifyPhotoTrash({
    owner: context,
    member: invitedContext,
    visitor: anonymous,
    origin,
    museumId: own.id,
    memoryId: collaborativeMemory.id,
    photoId: uploaded.id,
    photoName: String(photoRow.original_name),
    mediaUrl,
    screenshotDirectory,
  });
  for (const suffix of ["audit", "activity"]) {
    const url = `${origin}/account/museums/${own.id}/${suffix}`;
    for (const actor of [context, invitedContext])
      assert.equal((await actor.request.get(url)).status(), 200);
    const anonymousAudit = await anonymous.request.get(url);
    assert.equal(new URL(anonymousAudit.url()).pathname, "/account/login");
    await invitedPage.goto(url, { waitUntil: "networkidle" });
    await invitedPage
      .getByRole("heading", {
        level: 1,
        name: suffix === "audit" ? "操作审计" : "协作动态",
        exact: true,
      })
      .waitFor();
    assert.doesNotMatch(
      await invitedPage.locator("main").innerText(),
      /@|PRIVATE-|SECRET|password_hash/,
    );
    for (const width of [320, 1440]) {
      await invitedPage.setViewportSize({ width, height: 900 });
      assert.ok(
        await invitedPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
      if (screenshotDirectory)
        await invitedPage.screenshot({
          path: path.join(screenshotDirectory, `member-${suffix}-${width}.png`),
          fullPage: true,
        });
    }
  }
  const ownerLeave = await context.request.post(`${origin}/api/museums/${own.id}/leave`, {
    headers: { Origin: origin },
    data: { confirm: true },
  });
  assert.equal(ownerLeave.status(), 403);
  assert.equal((await ownerLeave.json()).error, "OWNER_CANNOT_LEAVE");
  const palaceBeforeDeparture = db.prepare("SELECT * FROM museums WHERE id=?").get(own.id);
  const contentBeforeDeparture = db.prepare("SELECT * FROM memories WHERE museum_id=?").all(own.id);
  db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(own.id);
  for (const actor of [context, invitedContext])
    for (const suffix of ["audit", "activity"])
      assert.equal(
        (await actor.request.get(`${origin}/account/museums/${own.id}/${suffix}`)).status(),
        404,
      );
  for (const actor of [context, invitedContext]) {
    const frozenRead = await actor.request.get(`${origin}/api/memories?museumId=${own.id}`);
    assert.equal(frozenRead.status(), 404);
    const frozenWrite = await actor.request.post(`${origin}/api/stages?museumId=${own.id}`, {
      headers: { Origin: origin },
      data: { title: "Must stay frozen" },
    });
    assert.equal(frozenWrite.status(), 404);
  }
  const frozenLeave = await invitedContext.request.post(`${origin}/api/museums/${own.id}/leave`, {
    headers: { Origin: origin },
    data: { confirm: true },
  });
  assert.equal(frozenLeave.status(), 404);
  const frozenRemoval = await context.request.delete(
    `${origin}/api/museums/${own.id}/collaborators/${other.id}`,
    { headers: { Origin: origin }, data: { confirm: true } },
  );
  assert.equal(frozenRemoval.status(), 404);
  for (const actor of [context, invitedContext])
    assert.equal((await actor.request.get(mediaUrl)).status(), 404);
  assert.equal(
    db
      .prepare("SELECT status FROM museum_memberships WHERE museum_id=? AND user_id=?")
      .get(own.id, other.id).status,
    "active",
  );
  db.prepare("UPDATE museums SET status='active' WHERE id=?").run(own.id);
  const forgedLeave = await invitedContext.request.post(`${origin}/api/museums/${own.id}/leave`, {
    headers: { Origin: origin },
    data: { confirm: true, userId: user.id },
  });
  assert.equal(forgedLeave.status(), 400);
  const crossOriginLeave = await invitedContext.request.post(
    `${origin}/api/museums/${own.id}/leave`,
    { headers: { Origin: "https://attacker.example" }, data: {} },
  );
  assert.equal(crossOriginLeave.status(), 403);
  await invitedPage.goto(`${origin}/account/museums/${own.id}/collaborators`, {
    waitUntil: "networkidle",
  });
  await invitedPage.getByLabel("我已了解后果，确认退出", { exact: true }).check();
  await invitedPage.getByLabel("我已了解后果，确认退出", { exact: true }).focus();
  await invitedPage.keyboard.press("Tab");
  assert.equal(
    await invitedPage
      .getByRole("button", { name: "退出宫殿", exact: true })
      .evaluate((button) => document.activeElement === button),
    true,
  );
  await invitedPage.getByRole("button", { name: "退出宫殿", exact: true }).press("Enter");
  await invitedPage.waitForURL(`${origin}/account`, { waitUntil: "load" });
  await invitedPage.getByRole("heading", { level: 1, name: museum.name, exact: true }).waitFor();
  assert.equal(await invitedPage.getByLabel("切换宫殿", { exact: true }).count(), 0);
  for (const suffix of ["audit", "activity"])
    assert.equal(
      (await invitedContext.request.get(`${origin}/account/museums/${own.id}/${suffix}`)).status(),
      404,
    );
  for (let retry = 0; retry < 1; retry++) {
    const left = await invitedContext.request.post(`${origin}/api/museums/${own.id}/leave`, {
      headers: { Origin: origin },
      data: { confirm: true },
    });
    assert.equal(left.status(), 200);
  }
  const consumedAfterLeave = await invitedContext.request.post(`${origin}/api/invites/accept`, {
    headers: { Origin: origin },
    data: { inviteId: invitationPayload.invite.id },
  });
  assert.equal(consumedAfterLeave.status(), 410);
  assert.equal(
    (await invitedContext.request.get(`${origin}/api/memories?museumId=${own.id}`)).status(),
    404,
    "the next request must reject a departed member",
  );
  assert.equal((await invitedContext.request.get(mediaUrl)).status(), 404);
  const freshInvitationResponse = await context.request.post(
    `${origin}/api/invites?museumId=${own.id}`,
    { headers: { Origin: origin }, data: { targetEmail: other.email } },
  );
  assert.equal(freshInvitationResponse.status(), 201);
  const freshInvitation = await freshInvitationResponse.json();
  const rejoined = await invitedContext.request.post(`${origin}/api/invites/accept`, {
    headers: { Origin: origin },
    data: { inviteId: freshInvitation.invite.id },
  });
  assert.equal(rejoined.status(), 200);
  assert.equal((await invitedContext.request.get(mediaUrl)).status(), 200);
  await page.goto(`${origin}/account/museums/${own.id}/collaborators`, {
    waitUntil: "networkidle",
  });
  await page.getByLabel("我确认移除该协作者", { exact: true }).check();
  await page.getByLabel("我确认移除该协作者", { exact: true }).focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .getByRole("button", { name: "移除协作者", exact: true })
      .evaluate((button) => document.activeElement === button),
    true,
  );
  await page.getByRole("button", { name: "移除协作者", exact: true }).press("Enter");
  await page.getByText("这座宫殿还没有协作者。", { exact: true }).waitFor();
  for (let retry = 0; retry < 1; retry++) {
    const removed = await context.request.delete(
      `${origin}/api/museums/${own.id}/collaborators/${other.id}`,
      { headers: { Origin: origin }, data: { confirm: true } },
    );
    assert.equal(removed.status(), 200);
  }
  const consumedAfterRemoval = await invitedContext.request.post(`${origin}/api/invites/accept`, {
    headers: { Origin: origin },
    data: { inviteId: freshInvitation.invite.id },
  });
  assert.equal(consumedAfterRemoval.status(), 410);
  assert.equal(
    (await invitedContext.request.get(`${origin}/api/memories?museumId=${own.id}`)).status(),
    404,
    "the next request must reject a removed member",
  );
  assert.equal((await invitedContext.request.get(mediaUrl)).status(), 404);
  assert.deepEqual(
    db.prepare("SELECT * FROM museums WHERE id=?").get(own.id),
    palaceBeforeDeparture,
  );
  assert.deepEqual(
    db.prepare("SELECT * FROM memories WHERE museum_id=?").all(own.id),
    contentBeforeDeparture,
  );
  await invitedContext.close();
  await page.goto(`${origin}/account/invites?museumId=${own.id}`, { waitUntil: "networkidle" });
  await page.getByLabel("受邀邮箱", { exact: true }).fill("future@example.com");
  const revokeTargetResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/invites?") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "发送邀请", exact: true }).click();
  const revokeTarget = await (await revokeTargetResponse).json();
  await page.getByRole("button", { name: "撤销邀请", exact: true }).waitFor();
  const revokedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" && response.url().includes("/api/invites/"),
  );
  await page.getByRole("button", { name: "撤销邀请", exact: true }).click();
  assert.equal((await revokedResponse).status(), 200);
  await page.getByText("邀请已撤销。", { exact: true }).waitFor();
  assert.equal(
    db.prepare("SELECT status FROM collaboration_invites WHERE id=?").get(revokeTarget.invite.id)
      .status,
    "revoked",
  );
  const newInviteResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().includes("/api/invites?"),
  );
  const reinviteTrace = [];
  const traceReinvite = (request) => {
    if (request.url().includes("/api/invites")) reinviteTrace.push(request.method());
  };
  page.on("request", traceReinvite);
  let newInvite;
  try {
    await page.getByRole("button", { name: "重新邀请", exact: true }).click();
    newInvite = await (await newInviteResponse).json();
  } catch (error) {
    console.error("Reinvite diagnostic (no automatic retry):", {
      requests: reinviteTrace,
      buttonCount: await page.getByRole("button", { name: "重新邀请", exact: true }).count(),
      alerts: await page.getByRole("alert").count(),
    });
    throw error;
  } finally {
    page.off("request", traceReinvite);
  }
  assert.notEqual(newInvite.invite.id, revokeTarget.invite.id);
  db.prepare(
    "UPDATE collaboration_invites SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
  ).run(newInvite.invite.id);
  await page.reload({ waitUntil: "networkidle" });
  const expiredRow = page.locator(".invitation-list li").filter({ hasText: "已过期" });
  await expiredRow.waitFor();
  const afterExpiryResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().includes("/api/invites?"),
  );
  await expiredRow.getByRole("button", { name: "重新邀请", exact: true }).click();
  assert.notEqual((await (await afterExpiryResponse).json()).invite.id, newInvite.invite.id);
  const quotaBeforeCreation = db
    .prepare("SELECT storage_quota_bytes FROM users WHERE id=?")
    .get(user.id).storage_quota_bytes;
  await page.goto(`${origin}/account/onboarding`, { waitUntil: "networkidle" });
  assert.equal(
    new URL(page.url()).pathname,
    "/account/onboarding",
    "creation page must remain accessible",
  );
  assert.equal(await page.getByLabel("宫殿类型", { exact: true }).inputValue(), "shared");
  await page.getByLabel("博物馆名称", { exact: true }).fill("一起记录的宫殿");
  await page.getByLabel("馆址", { exact: true }).fill("smoke-together");
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await page.getByLabel("宫殿类型", { exact: true }).boundingBox();
    assert.ok(
      bounds && bounds.x >= 0 && bounds.x + bounds.width <= width,
      "type selector fits the viewport",
    );
    if (screenshotDirectory && (width === 320 || width === 1440))
      await page.screenshot({
        path: path.join(screenshotDirectory, `creation-${width}.png`),
        fullPage: true,
      });
  }
  await page.getByRole("button", { name: "创建共同宫殿", exact: true }).click();
  await page.waitForURL(
    (url) => url.pathname === "/account" && Boolean(url.searchParams.get("museumId")),
    { waitUntil: "networkidle" },
  );
  const createdId = new URL(page.url()).searchParams.get("museumId");
  assert.ok(createdId && createdId !== own.id);
  assert.equal(
    db.prepare("SELECT museum_type FROM museums WHERE id=?").get(createdId).museum_type,
    "shared",
  );
  assert.equal(
    db.prepare("SELECT storage_quota_bytes FROM users WHERE id=?").get(user.id).storage_quota_bytes,
    quotaBeforeCreation,
  );
  await page.getByRole("heading", { name: "一起记录的宫殿", exact: true }).waitFor();
  const storageText = await page.getByRole("definition").allTextContents();
  assert.ok(storageText.some((text) => text.includes("0 字节")));
  await page.getByRole("link", { name: "进入这座宫殿", exact: true }).click();
  await page.waitForURL(
    (url) => url.pathname === "/" && url.searchParams.get("museumId") === createdId,
  );
  await page.locator('header nav a[href^="/workspace"]').click();
  await page.waitForURL(
    (url) => url.pathname === "/workspace" && url.searchParams.get("museumId") === createdId,
  );
  await page.goto(`${origin}/account`, { waitUntil: "networkidle" });
  assert.equal(await page.getByLabel("切换宫殿", { exact: true }).inputValue(), own.id);
  await page.goto(`${origin}/account/onboarding`, { waitUntil: "networkidle" });
  await page.getByLabel("博物馆名称", { exact: true }).fill("重复馆址");
  await page.getByLabel("馆址", { exact: true }).fill("smoke-together");
  await page.getByRole("button", { name: "创建共同宫殿", exact: true }).click();
  await page.getByText("这个馆址已有人使用，请换一个。", { exact: true }).waitFor();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM museums WHERE owner_id=?").get(user.id).n, 2);
  db.prepare("UPDATE museums SET museum_type='shared' WHERE id=?").run(museum.id);
  const ownerLogin = await context.request.post(`${origin}/api/user-auth`, {
    headers: { Origin: origin },
    data: { email: other.email, password: "abcdefgh" },
  });
  assert.equal(ownerLogin.status(), 200);
  await page.goto(`${origin}/account/museums/${museum.id}/deletion`, { waitUntil: "networkidle" });
  await page
    .getByText(
      "共同宫殿可进入30×24小时待删除期，存在协作者不影响排期。截止前可撤销，截止后不能恢复访问。",
      { exact: true },
    )
    .waitFor();
  assert.equal(await page.locator(".audit-panel form").count(), 0);
  for (const method of ["POST", "DELETE"]) {
    const response = await context.request.fetch(`${origin}/api/museums/${museum.id}/deletion`, {
      method,
      headers: { Origin: origin },
      data: { confirm: true, version: method === "POST" ? 1 : 2 },
    });
    assert.equal(response.status(), 200);
  }
  assert.equal(db.prepare("SELECT status FROM museums WHERE id=?").get(museum.id).status, "active");
  await page.goto(`${origin}/admin`, { waitUntil: "networkidle" });
  const quotaInput = page.locator(`#quota-${museum.id}`);
  await quotaInput.fill("1024");
  const quotaSaved = page.waitForResponse(
    (response) =>
      response.url() === `${origin}/api/admin/museums/${museum.id}/quota` &&
      response.request().method() === "PATCH",
  );
  await page
    .locator(".admin-quota-form")
    .filter({ has: quotaInput })
    .getByRole("button", { name: "保存配额", exact: true })
    .click();
  assert.equal((await quotaSaved).status(), 200);
  assert.equal(
    db.prepare("SELECT storage_quota_bytes FROM users WHERE id=?").get(other.id)
      .storage_quota_bytes,
    1024,
  );
  assert.equal(
    db.prepare("SELECT storage_quota_bytes FROM museums WHERE id=?").get(museum.id)
      .storage_quota_bytes,
    0,
  );
  const staleOwner = await context.request.patch(`${origin}/api/admin/museums/${museum.id}/quota`, {
    headers: { Origin: origin },
    data: { storageQuotaBytes: 2048, expectedQuotaBytes: 1024, expectedOwnerId: user.id },
  });
  assert.equal(staleOwner.status(), 409);
  assert.equal((await staleOwner.json()).error, "STORAGE_QUOTA_OWNER_CONFLICT");
  assert.equal(
    db.prepare("SELECT storage_quota_bytes FROM users WHERE id=?").get(other.id)
      .storage_quota_bytes,
    1024,
  );
  const legacy = await context.request.post(`${origin}/api/auth`, {
    headers: { Origin: origin },
    data: { password: "anything" },
  });
  assert.equal(legacy.status(), 410);
  const transferredId = await verifyOwnerTransfer({
    browser,
    origin,
    db,
    ownerUser: user,
    targetUser: other,
    errors,
    screenshotDirectory,
  });
  await verifySharedDeletion({
    browser,
    origin,
    db,
    museumId: transferredId,
    ownerUser: other,
    memberUser: user,
    errors,
    screenshotDirectory,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: private isolation, registration/change/reset code UI, sessions, read-only shares, private/account deletion disabled, shared creation/invitation/member/content/Note/photo trash/audit, quota and transfer acceptance, shared deletion freeze/cancel/deadline/failure status, responsive checks, no browser errors",
  );
  if (screenshotDirectory)
    console.log(`UI screenshots retained for review: ${screenshotDirectory}`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => {
    server.once("exit", resolve);
    if (!server.kill()) resolve();
  });
  db.close();
  rmSync(directory, { recursive: true, force: true });
}
