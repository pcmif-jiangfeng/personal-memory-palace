import assert from "node:assert/strict";
import path from "node:path";

export async function verifyPhotoTrash({
  owner,
  member,
  visitor,
  origin,
  museumId,
  memoryId,
  photoId,
  photoName,
  mediaUrl,
  screenshotDirectory,
}) {
  const shared = await owner.request.post(`${origin}/api/shares?museumId=${museumId}`, {
    headers: { Origin: origin },
    data: { memoryId, enabled: true, mode: "link" },
  });
  assert.equal(shared.status(), 200);
  const shareUrl = new URL((await shared.json()).url, origin);
  const sharedMedia = `${mediaUrl}?share=${shareUrl.pathname.split("/").pop()}`;
  assert.equal((await visitor.request.get(sharedMedia)).status(), 200);
  const pages = await Promise.all([member.newPage(), owner.newPage()]);
  const errors = [];
  for (const page of pages) page.on("pageerror", (error) => errors.push(error.message));
  try {
    const [memberPage, ownerPage] = pages;
    await memberPage.goto(`${origin}/workspace?museumId=${museumId}`, { waitUntil: "load" });
    const deletion = memberPage.waitForResponse(
      (response) =>
        response.url().includes(`/api/photos/${photoId}?`) &&
        response.request().method() === "DELETE",
    );
    memberPage.once("dialog", (dialog) => dialog.accept());
    await memberPage.getByRole("button", { name: `删除照片“${photoName}”`, exact: true }).click();
    assert.equal((await deletion).status(), 200);
    assert.equal((await visitor.request.get(sharedMedia)).status(), 404);
    assert.equal((await member.request.get(mediaUrl)).status(), 404);
    const invalidReuse = await member.request.post(`${origin}/api/museums/${museumId}/memories`, {
      headers: { Origin: origin },
      data: {
        title: "Invalid trash reuse",
        story: "Must reject",
        photoIds: [photoId],
        coverPhotoId: photoId,
      },
    });
    assert.equal(invalidReuse.status(), 400);
    await Promise.all(
      pages.map((page) => page.goto(`${origin}/trash?museumId=${museumId}`, { waitUntil: "load" })),
    );
    const section = (page) =>
      page
        .locator(".trash-section")
        .filter({ has: page.getByRole("heading", { name: "照片", exact: true }) });
    for (const [index, page] of pages.entries()) {
      await section(page).getByLabel(photoName, { exact: true }).waitFor();
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          true,
        );
        if (screenshotDirectory)
          await section(page).screenshot({
            path: path.join(
              screenshotDirectory,
              `photo-trash-${index ? "owner" : "member"}-${width}.png`,
            ),
          });
      }
    }
    assert.equal(
      await section(memberPage)
        .getByRole("button", { name: "批量永久删除", exact: true })
        .isDisabled(),
      true,
    );
    await section(ownerPage).getByLabel(photoName, { exact: true }).check();
    ownerPage.once("dialog", (dialog) => dialog.accept());
    const inUse = ownerPage.waitForResponse(
      (response) =>
        response.url().includes("/api/trash?") && response.request().method() === "POST",
    );
    await section(ownerPage).getByRole("button", { name: "批量永久删除", exact: true }).click();
    const blocked = await (await inUse).json();
    assert.equal(blocked.failures[0].error, "PHOTO_IN_USE");
    await section(memberPage).getByLabel(photoName, { exact: true }).check();
    const restoration = memberPage.waitForResponse(
      (response) =>
        response.url().includes("/api/trash?") && response.request().method() === "POST",
    );
    await section(memberPage).getByRole("button", { name: "批量恢复", exact: true }).click();
    assert.deepEqual((await (await restoration).json()).succeededIds, [photoId]);
    assert.equal((await visitor.request.get(sharedMedia)).status(), 200);
    assert.equal((await member.request.get(mediaUrl)).status(), 200);
    assert.deepEqual(errors, []);
  } finally {
    await Promise.all(pages.map((page) => page.close()));
  }
}
