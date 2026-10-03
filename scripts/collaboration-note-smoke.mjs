import assert from "node:assert/strict";
import path from "node:path";

export async function verifyCollaborativeNotes({
  owner,
  member,
  visitor,
  origin,
  museumId,
  memoryId,
  screenshotDirectory,
}) {
  const memoryUrl = `${origin}/api/memories/${memoryId}?museumId=${museumId}`;
  const created = await member.request.post(memoryUrl, {
    headers: { Origin: origin },
    data: { action: "note", content: "浏览器作者注记" },
  });
  assert.equal(created.status(), 200, await created.text());
  const { memory } = await (await member.request.get(memoryUrl)).json();
  const note = memory.laterNotes.find((item) => item.content === "浏览器作者注记");
  assert.ok(note?.authorUserId);
  assert.ok(note.authorDisplayName);
  assert.ok(!JSON.stringify(note).includes("@example.com"));
  const endpoint = `${origin}/api/later-notes/${note.id}?museumId=${museumId}`;
  for (const [actor, headers, data, status] of [
    [owner, { Origin: origin }, { action: "update", content: "Owner edit", version: 1 }, 403],
    [visitor, { Origin: origin }, { action: "trash" }, 401],
    [member, { Origin: "https://foreign.example" }, { action: "trash" }, 403],
    [
      member,
      { Origin: origin },
      { action: "update", content: "Spoof", version: 1, authorUserId: "owner" },
      400,
    ],
  ])
    assert.equal((await actor.request.post(endpoint, { headers, data })).status(), status);
  const share = await owner.request.post(`${origin}/api/shares?museumId=${museumId}`, {
    headers: { Origin: origin },
    data: { memoryId, enabled: true, mode: "link" },
  });
  assert.equal(share.status(), 200);
  const shareUrl = new URL((await share.json()).url, origin).href;
  const pages = await Promise.all([owner.newPage(), member.newPage(), member.newPage()]);
  const errors = [];
  for (const page of pages) page.on("pageerror", (error) => errors.push(error.message));
  const row = (page) => page.locator(`[data-note-id="${note.id}"]`);
  async function click(page, name, expected = 200, confirm = false) {
    if (confirm) page.once("dialog", (dialog) => dialog.accept());
    const result = page.waitForResponse(
      (response) => response.url() === endpoint && response.request().method() === "POST",
    );
    await row(page).getByRole("button", { name, exact: true }).click();
    assert.equal((await result).status(), expected);
  }
  try {
    const target = `${origin}/memories/${memoryId}?museumId=${museumId}`;
    await Promise.all(pages.map((page) => page.goto(target, { waitUntil: "load" })));
    await row(pages[1]).getByRole("button", { name: "保存注记修改", exact: true }).waitFor();
    assert.equal(
      await row(pages[0]).getByRole("button", { name: "保存注记修改", exact: true }).count(),
      0,
    );
    for (const [index, page] of pages.slice(0, 2).entries()) {
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          true,
        );
        if (screenshotDirectory)
          await row(page).screenshot({
            path: path.join(screenshotDirectory, `note-${index ? "author" : "owner"}-${width}.png`),
          });
      }
    }
    await row(pages[1]).locator("textarea").fill("作者成功保存的新注记");
    await row(pages[2]).locator("textarea").fill("第二个标签页的未保存草稿");
    await click(pages[1], "保存注记修改");
    await click(pages[2], "保存注记修改", 409);
    await row(pages[2]).getByRole("button", { name: "重新加载注记", exact: true }).waitFor();
    assert.equal(await row(pages[2]).locator("textarea").inputValue(), "第二个标签页的未保存草稿");
    assert.ok(
      (await (await visitor.request.get(shareUrl)).text()).includes("作者成功保存的新注记"),
    );
    await click(pages[0], "移入注记回收站", 200, true);
    await row(pages[0]).getByRole("button", { name: "恢复注记", exact: true }).waitFor();
    const hidden = await (await visitor.request.get(shareUrl)).text();
    assert.ok(!hidden.includes("作者成功保存的新注记"));
    await pages[1].reload({ waitUntil: "load" });
    assert.equal(
      await row(pages[1]).getByRole("button", { name: "永久删除注记", exact: true }).count(),
      0,
    );
    await click(pages[1], "恢复注记");
    await row(pages[1]).getByRole("button", { name: "保存注记修改", exact: true }).waitFor();
    assert.ok(
      (await (await visitor.request.get(shareUrl)).text()).includes("作者成功保存的新注记"),
    );
    await pages[0].reload({ waitUntil: "load" });
    await click(pages[0], "移入注记回收站", 200, true);
    await row(pages[0]).getByRole("button", { name: "永久删除注记", exact: true }).waitFor();
    await click(pages[0], "永久删除注记", 200, true);
    const after = (await (await member.request.get(memoryUrl)).json()).memory;
    assert.equal(after.story, memory.story);
    assert.ok(!after.laterNotes.some((item) => item.id === note.id));
    assert.deepEqual(errors, []);
  } finally {
    await Promise.all(pages.map((page) => page.close()));
  }
}
