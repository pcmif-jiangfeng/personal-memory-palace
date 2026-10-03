import assert from "node:assert/strict";

// Caller owns the disposable server, accounts and cleanup. This scenario never sends mail.
export async function verifyCollaborativeEditing({
  owner,
  member,
  visitor,
  origin,
  museumId,
  memoryId,
}) {
  const share = await owner.request.post(`${origin}/api/shares?museumId=${museumId}`, {
    headers: { Origin: origin },
    data: { memoryId, enabled: true, mode: "link" },
  });
  assert.equal(share.status(), 200, await share.text());
  const { url } = await share.json();
  const pages = await Promise.all([owner.newPage(), member.newPage()]);
  const errors = [];
  for (const page of pages) page.on("pageerror", (error) => errors.push(error.message));
  try {
    const target = `${origin}/memories/${memoryId}?museumId=${museumId}`;
    await Promise.all(pages.map((page) => page.goto(target, { waitUntil: "load" })));
    for (const page of pages) {
      await page.getByRole("button", { name: "保存基本信息", exact: true }).waitFor();
      assert.equal(
        (await page.getByText("如果馆长已开启这段记忆的分享", { exact: false }).count()) > 0,
        true,
      );
    }
    assert.equal(await pages[1].locator(".publication-control").count(), 0);
    assert.equal(await pages[0].locator(".publication-control").count(), 1);
    const titles = ["馆长已保存的新标题", "协作者尚未保存的标题"];
    const stories = ["馆长保存的新故事", "协作者需要保留的故事草稿"];
    for (const [index, page] of pages.entries()) {
      await page.getByLabel("标题", { exact: true }).fill(titles[index]);
      await page.locator(".memory-details-form textarea").fill(stories[index]);
    }
    const firstResponse = pages[0].waitForResponse(
      (response) =>
        response.url().includes(`/api/memories/${memoryId}`) &&
        response.request().method() === "POST",
    );
    await pages[0].getByRole("button", { name: "保存基本信息", exact: true }).click();
    assert.equal((await firstResponse).status(), 200);
    const staleResponse = pages[1].waitForResponse(
      (response) =>
        response.url().includes(`/api/memories/${memoryId}`) &&
        response.request().method() === "POST",
    );
    await pages[1].getByRole("button", { name: "保存基本信息", exact: true }).click();
    assert.equal((await staleResponse).status(), 409);
    await pages[1].getByRole("button", { name: "重新加载最新内容", exact: true }).waitFor();
    assert.equal(await pages[1].getByLabel("标题", { exact: true }).inputValue(), titles[1]);
    assert.equal(await pages[1].locator(".memory-details-form textarea").inputValue(), stories[1]);
    const shared = await visitor.request.get(new URL(url, origin).href);
    assert.equal(shared.status(), 200);
    const html = await shared.text();
    assert.ok(html.includes(titles[0]));
    assert.ok(html.includes(stories[0]));
    assert.ok(!html.includes(titles[1]));
    assert.deepEqual(errors, []);
  } finally {
    await Promise.all(pages.map((page) => page.close()));
  }
}
