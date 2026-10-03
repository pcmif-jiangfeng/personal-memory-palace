import assert from "node:assert/strict";
import path from "node:path";

export async function verifySharedDeletion({
  browser,
  origin,
  db,
  museumId,
  ownerUser,
  memberUser,
  errors,
  screenshotDirectory,
}) {
  const owner = await browser.newContext(),
    member = await browser.newContext(),
    visitor = await browser.newContext();
  try {
    for (const [actor, user, password] of [
      [owner, ownerUser, "abcdefgh"],
      [member, memberUser, "reset888"],
    ])
      assert.equal(
        (
          await actor.request.post(`${origin}/api/user-auth`, {
            headers: { Origin: origin },
            data: { email: user.email, password },
          })
        ).status(),
        200,
      );
    const memoryId = "deletion-smoke-memory";
    db.prepare(
      "INSERT INTO memories(id,museum_id,title,story,created_at,updated_at,created_by_user_id) VALUES (?,?,'Deletion title','Private story','now','now',?)",
    ).run(memoryId, museumId, memberUser.id);
    const share = await owner.request.post(`${origin}/api/shares?museumId=${museumId}`, {
      headers: { Origin: origin },
      data: { memoryId, enabled: true, mode: "link" },
    });
    assert.equal(share.status(), 200);
    const shareUrl = `${origin}${new URL((await share.json()).url, origin).pathname}`;
    assert.equal((await visitor.request.get(shareUrl)).status(), 200);
    const endpoint = `${origin}/api/museums/${museumId}/deletion`,
      url = `${origin}/account/museums/${museumId}/deletion`;
    const page = await owner.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle" });
    await page
      .getByLabel("我理解本馆所有成员和分享将暂停访问，30×24小时截止前可取消，截止后不可撤销。", {
        exact: true,
      })
      .check();
    const scheduled = page.waitForResponse(
      (response) => response.url() === endpoint && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "确认进入 30 天待删除", exact: true }).click();
    assert.equal((await scheduled).status(), 200);
    await page.getByRole("button", { name: "确认取消删除", exact: true }).waitFor();
    const row = db.prepare("SELECT * FROM museums WHERE id=?").get(museumId);
    assert.equal(
      Date.parse(row.deletion_scheduled_at) - Date.parse(row.updated_at),
      30 * 24 * 60 * 60 * 1000,
    );
    assert.equal((await member.request.get(url)).status(), 404);
    assert.equal((await visitor.request.get(shareUrl)).status(), 404);
    for (const actor of [owner, member]) {
      for (const route of [
        `/api/memories?museumId=${museumId}`,
        `/api/photos?museumId=${museumId}`,
        `/account/museums/${museumId}/audit`,
      ])
        assert.equal((await actor.request.get(`${origin}${route}`)).status(), 404);
      assert.equal(
        (
          await actor.request.post(`${origin}/api/memories/${memoryId}?museumId=${museumId}`, {
            headers: { Origin: origin },
            data: { action: "trash" },
          })
        ).status(),
        404,
      );
      assert.equal(
        (
          await actor.request.post(`${origin}/api/museums/${museumId}/transfer`, {
            headers: { Origin: origin },
            data: {
              action: "request",
              targetUserId: memberUser.id,
              version: row.version,
              confirm: true,
            },
          })
        ).status(),
        404,
      );
      assert.equal(
        (
          await actor.request.post(`${origin}/api/invites?museumId=${museumId}`, {
            headers: { Origin: origin },
            data: { targetEmail: "frozen@example.com" },
          })
        ).status(),
        404,
      );
    }
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
      if (screenshotDirectory)
        await page.screenshot({
          path: path.join(screenshotDirectory, `deletion-pending-${width}.png`),
          fullPage: true,
        });
    }
    await page.getByLabel("确认取消待删除，恢复博物馆访问。", { exact: true }).check();
    const cancelled = page.waitForResponse(
      (response) => response.url() === endpoint && response.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: "确认取消删除", exact: true }).click();
    assert.equal((await cancelled).status(), 200);
    await page.getByRole("button", { name: "确认进入 30 天待删除", exact: true }).waitFor();
    assert.equal(
      (await member.request.get(`${origin}/memories/${memoryId}?museumId=${museumId}`)).status(),
      200,
    );
    assert.equal((await visitor.request.get(shareUrl)).status(), 200);
    const current = db.prepare("SELECT version FROM museums WHERE id=?").get(museumId);
    assert.equal(
      (
        await owner.request.post(endpoint, {
          headers: { Origin: origin },
          data: { confirm: true, version: current.version },
        })
      ).status(),
      200,
    );
    db.prepare("UPDATE museums SET deletion_scheduled_at=? WHERE id=?").run(
      new Date().toISOString(),
      museumId,
    );
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.getByRole("button", { name: "确认取消删除", exact: true }).count(), 0);
    const expired = db.prepare("SELECT version FROM museums WHERE id=?").get(museumId);
    const refusal = await owner.request.delete(endpoint, {
      headers: { Origin: origin },
      data: { confirm: true, version: expired.version },
    });
    assert.equal(refusal.status(), 409);
    assert.equal((await refusal.json()).error, "DELETION_DEADLINE_PASSED");
    db.prepare(
      "UPDATE museums SET deletion_attempts=1,deletion_last_error='CLEANUP_FAILED',deletion_next_attempt_at=? WHERE id=?",
    ).run(new Date(Date.now() + 3600000).toISOString(), museumId);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("后台清理失败，宫殿保持冻结", { exact: false }).waitFor();
    assert.ok(!(await page.locator("main").innerText()).includes("CLEANUP_FAILED"));
    assert.equal(
      (await member.request.get(`${origin}/memories/${memoryId}?museumId=${museumId}`)).status(),
      404,
    );
    assert.equal((await visitor.request.get(shareUrl)).status(), 404);
    assert.equal(
      db.prepare("SELECT story FROM memories WHERE id=?").get(memoryId).story,
      "Private story",
    );
  } finally {
    await owner.close();
    await member.close();
    await visitor.close();
  }
}
