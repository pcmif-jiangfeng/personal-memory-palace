import assert from "node:assert/strict";
import path from "node:path";

export async function verifyOwnerTransfer({
  browser,
  origin,
  db,
  ownerUser,
  targetUser,
  errors,
  screenshotDirectory,
}) {
  const owner = await browser.newContext();
  const target = await browser.newContext();
  try {
    for (const [actor, user, password] of [
      [owner, ownerUser, "reset888"],
      [target, targetUser, "abcdefgh"],
    ]) {
      const login = await actor.request.post(`${origin}/api/user-auth`, {
        headers: { Origin: origin },
        data: { email: user.email, password },
      });
      assert.equal(login.status(), 200);
    }
    const created = await owner.request.post(`${origin}/api/museums`, {
      headers: { Origin: origin },
      data: { museumType: "shared", name: "转让验证宫殿", slug: "transfer-smoke", description: "" },
    });
    assert.equal(created.status(), 201);
    const { id } = await created.json();
    const invite = await owner.request.post(`${origin}/api/invites?museumId=${id}`, {
      headers: { Origin: origin },
      data: { targetEmail: targetUser.email },
    });
    assert.equal(invite.status(), 201);
    const { invite: invitation } = await invite.json();
    assert.equal(
      (
        await target.request.post(`${origin}/api/invites/accept`, {
          headers: { Origin: origin },
          data: { inviteId: invitation.id },
        })
      ).status(),
      200,
    );
    const url = `${origin}/account/museums/${id}/transfer`;
    const endpoint = `${origin}/api/museums/${id}/transfer`;
    const ownerPage = await owner.newPage(),
      targetPage = await target.newPage();
    for (const page of [ownerPage, targetPage])
      page.on("pageerror", (error) => errors.push(error.message));
    const pending = () =>
      db
        .prepare("SELECT * FROM owner_transfer_requests WHERE museum_id=? AND status='pending'")
        .get(id);
    const currentOwner = () =>
      db.prepare("SELECT owner_id FROM museums WHERE id=?").get(id).owner_id;
    async function act(page, label, status = 200) {
      await page.getByLabel("我已了解转让规则，确认本次操作", { exact: true }).check();
      const response = page.waitForResponse(
        (response) => response.url() === endpoint && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: label, exact: true }).click();
      assert.equal((await response).status(), status);
    }
    async function request() {
      await ownerPage.goto(url, { waitUntil: "networkidle" });
      await ownerPage.getByLabel("接任协作者", { exact: true }).selectOption(targetUser.id);
      await act(ownerPage, "发起转让申请", 201);
      await ownerPage.getByRole("button", { name: "撤回转让申请", exact: true }).waitFor();
      assert.equal(currentOwner(), ownerUser.id);
    }
    await request();
    const first = pending();
    assert.equal(
      (
        await owner.request.post(endpoint, {
          headers: { Origin: origin },
          data: { action: "accept", requestId: first.id, confirm: true },
        })
      ).status(),
      404,
    );
    assert.equal(
      (
        await target.request.post(endpoint, {
          headers: { Origin: "https://attacker.example" },
          data: { action: "accept", requestId: first.id, confirm: true },
        })
      ).status(),
      403,
    );
    await targetPage.goto(url, { waitUntil: "networkidle" });
    await act(targetPage, "拒绝转让申请");
    await targetPage.getByText("当前没有需要你处理的转让申请。", { exact: true }).waitFor();
    assert.equal(currentOwner(), ownerUser.id);
    await request();
    await act(ownerPage, "撤回转让申请");
    await ownerPage.getByRole("button", { name: "发起转让申请", exact: true }).waitFor();
    await request();
    const active = pending();
    const quota = db
      .prepare("SELECT storage_quota_bytes FROM users WHERE id=?")
      .get(targetUser.id).storage_quota_bytes;
    db.prepare("UPDATE museums SET storage_used_bytes=1 WHERE id=?").run(id);
    db.prepare("UPDATE users SET storage_quota_bytes=0 WHERE id=?").run(targetUser.id);
    await targetPage.goto(url, { waitUntil: "networkidle" });
    await act(targetPage, "接受馆长转让", 507);
    await targetPage.getByRole("alert").filter({ hasText: "剩余额度不足" }).waitFor();
    assert.equal(currentOwner(), ownerUser.id);
    assert.equal(pending().id, active.id);
    assert.equal(
      await targetPage.getByLabel("我已了解转让规则，确认本次操作", { exact: true }).isChecked(),
      true,
    );
    for (const [page, role] of [
      [ownerPage, "owner"],
      [targetPage, "recipient"],
    ])
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        );
        if (screenshotDirectory)
          await page.screenshot({
            path: path.join(screenshotDirectory, `transfer-${role}-${width}.png`),
            fullPage: true,
          });
        assert.equal(
          await page.getByRole("combobox", { name: "转移后我的身份", exact: true }).count(),
          0,
        );
      }
    db.prepare("UPDATE users SET storage_quota_bytes=? WHERE id=?").run(quota, targetUser.id);
    await act(targetPage, "接受馆长转让");
    await targetPage.getByLabel("接任协作者", { exact: true }).waitFor();
    assert.equal(currentOwner(), targetUser.id);
    assert.equal(
      db
        .prepare("SELECT role FROM museum_memberships WHERE museum_id=? AND user_id=?")
        .get(id, ownerUser.id).role,
      "collaborator",
    );
    await ownerPage.goto(`${origin}/account?museumId=${id}`, { waitUntil: "networkidle" });
    assert.ok((await ownerPage.locator("main").innerText()).includes("你的身份：协作者"));
    assert.equal(await ownerPage.getByLabel("宫殿名称", { exact: true }).count(), 0);
    assert.equal(
      (
        await owner.request.post(endpoint, {
          headers: { Origin: origin },
          data: { action: "request", targetUserId: targetUser.id, version: 2, confirm: true },
        })
      ).status(),
      403,
    );
    return id;
  } finally {
    await owner.close();
    await target.close();
  }
}
