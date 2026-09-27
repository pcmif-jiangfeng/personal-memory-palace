// Run after pnpm build; all data and sessions are disposable test fixtures.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import sharp from "sharp";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";

const project = path.resolve(import.meta.dirname, "..");
const prefix = path.join(tmpdir(), "palace-f2-acceptance-");
const directory = mkdtempSync(prefix);
const db = initializeDatabase(path.join(directory, "palace.sqlite"), false);
let server;
let browser;
try {
  const users = ["owner-a", "collaborator", "owner-b"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "synthetic-unused-hash",
    }),
  );
  db.prepare("UPDATE users SET email_verified=1").run();
  const museums = users.map((user, index) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      name: `Museum ${index}`,
      slug: `test-${index}`,
    }),
  );
  const museumA = museums[0].id;
  const museumB = museums[2].id;
  const membership = db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  );
  membership.run(museumA, users[1].id);
  // Membership in both Museums must not bypass the selected Museum scope.
  membership.run(museumB, users[1].id);
  const now = new Date().toISOString();
  const insert = db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,is_public,created_at,updated_at) VALUES (?,?,?,'Test Story',0,?,?)",
  );
  insert.run("own", museumA, "A Memory", now, now);
  insert.run("foreign", museumB, "B Secret", now, now);
  const photoInsert = db.prepare(
    "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES (?,?,'Test Photo','image/webp',?,1,1,?)",
  );
  photoInsert.run("photo-a", museumA, "test-a.webp", now);
  photoInsert.run("photo-b", museumB, "test-b.webp", now);
  const stageInsert = db.prepare(
    "INSERT INTO stages (id,museum_id,title,is_public,created_at,updated_at) VALUES (?,?,?,0,?,?)",
  );
  stageInsert.run("stage-a", museumA, "A Chapter", now, now);
  stageInsert.run("stage-b", museumB, "B Secret Chapter", now, now);
  const sessions = users.map((user) => {
    const token = randomBytes(32).toString("base64url");
    db.prepare(
      "INSERT INTO user_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)",
    ).run(
      createHash("sha256").update(token).digest("hex"),
      user.id,
      new Date(Date.now() + 600000).toISOString(),
      now,
    );
    return token;
  });
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: project,
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        MEMORY_PALACE_DATA_DIR: directory,
        MEMORY_PALACE_DATASET: "owner",
        MEMORY_PALACE_SECURE_COOKIES: "false",
        MEMORY_PALACE_SESSION_SECRET: "isolated-memory-scope-test-secret-at-least-32-characters",
        MEMORY_PALACE_OWNER_PASSWORD: "isolated-legacy-password",
      },
    },
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error("Isolated server exited before readiness");
    try {
      const response = await fetch(`${base}/account/login`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "Isolated production server did not start");
  const scoped = (suffix) =>
    `${suffix}${suffix.includes("?") ? "&" : "?"}museumId=${encodeURIComponent(museumA)}`;
  async function call(
    url,
    token,
    body,
    expected = 200,
    origin = base,
    method = body === undefined ? "GET" : "POST",
  ) {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: {
        origin,
        "content-type": "application/json",
        ...(token ? { cookie: `memory_palace_user=${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.status, expected, `${url}: ${await response.clone().text()}`);
    return response.json();
  }
  await call(scoped("/api/memories/own"), undefined, undefined, 401);
  await call(scoped("/api/memories/own"), sessions[2], undefined, 404);
  await call(scoped("/api/memories/foreign"), sessions[1], undefined, 404);
  await call(
    scoped("/api/memories/own"),
    sessions[1],
    { action: "trash" },
    403,
    "http://attacker.example",
  );
  assert.deepEqual(
    (await call(scoped("/api/memories"), sessions[1])).memories.map((memory) => memory.id),
    ["own"],
  );
  assert.deepEqual((await call(scoped("/api/memories?q=B%20Secret"), sessions[1])).memories, []);
  assert.equal((await call(scoped("/api/recall"), sessions[1])).memory.id, "own");
  assert.equal((await call("/api/recall", undefined)).memory, null);
  await call(scoped("/api/stages/stage-a"), undefined, undefined, 401);
  await call(scoped("/api/stages/stage-a"), sessions[2], undefined, 404);
  await call(scoped("/api/stages/stage-b"), sessions[1], undefined, 404);
  assert.deepEqual(
    (await call(scoped("/api/stages"), sessions[1])).stages.map((stage) => stage.id),
    ["stage-a"],
  );
  await call(
    scoped("/api/stages"),
    sessions[1],
    { title: "Attack" },
    403,
    "http://attacker.example",
  );
  await call(scoped("/api/stages"), sessions[1], { title: "Attack", coverPhotoId: "photo-b" }, 400);
  const createdStage = (
    await call(
      scoped("/api/stages"),
      sessions[1],
      {
        title: "Created Chapter",
        coverPhotoId: "photo-a",
        userId: users[2].id,
        createdByUserId: users[2].id,
        lastEditedByUserId: users[2].id,
      },
      201,
    )
  ).stage;
  assert.equal(createdStage.createdByUserId, users[1].id);
  assert.equal(createdStage.lastEditedByUserId, users[1].id);
  assert.equal(
    db.prepare("SELECT museum_id FROM stages WHERE id=?").get(createdStage.id).museum_id,
    museumA,
  );
  assert.equal(
    db.prepare("SELECT museum_id FROM stage_covers WHERE stage_id=?").get(createdStage.id)
      .museum_id,
    museumA,
  );
  const stageUrl = scoped(`/api/stages/${createdStage.id}`);
  await call(
    stageUrl,
    sessions[0],
    {
      title: "Owner edited Chapter",
      version: createdStage.version,
      coverPhotoId: "photo-a",
      lastEditedByUserId: users[2].id,
    },
    200,
    base,
    "PUT",
  );
  const attributedStage = (await call(stageUrl, sessions[0])).stage;
  assert.equal(attributedStage.createdByUserId, users[1].id);
  assert.equal(attributedStage.lastEditedByUserId, users[0].id);
  assert.equal(attributedStage.lastEditedByDisplayName, "owner-a");
  const stageConflict = await call(
    stageUrl,
    sessions[1],
    { title: "Stale Stage", coverPhotoId: null, version: createdStage.version },
    409,
    base,
    "PUT",
  );
  assert.equal(stageConflict.error, "STAGE_VERSION_CONFLICT");
  assert.deepEqual((await call(stageUrl, sessions[0])).stage, attributedStage);
  await call(
    "/api/museums",
    sessions[0],
    {
      name: "Museum 0",
      version: museums[0].version,
      description: "Updated settings",
      coverPhotoId: null,
      lastEditedByUserId: users[2].id,
    },
    200,
    base,
    "PATCH",
  );
  assert.equal(
    db.prepare("SELECT last_edited_by_user_id FROM museums WHERE id=?").get(museumA)
      .last_edited_by_user_id,
    users[0].id,
  );
  const profileSnapshot = db.prepare("SELECT * FROM museums WHERE id=?").get(museumA);
  const profileConflict = await call(
    "/api/museums",
    sessions[0],
    { name: "Stale Museum", description: "", coverPhotoId: null, version: museums[0].version },
    409,
    base,
    "PATCH",
  );
  assert.equal(profileConflict.error, "MUSEUM_VERSION_CONFLICT");
  assert.deepEqual(db.prepare("SELECT * FROM museums WHERE id=?").get(museumA), profileSnapshot);
  await call(
    "/api/museums",
    sessions[0],
    { slug: "updated-owner-a", lastEditedByUserId: users[2].id },
    200,
    base,
    "PATCH",
  );
  assert.equal(
    db.prepare("SELECT last_edited_by_user_id FROM museums WHERE id=?").get(museumA)
      .last_edited_by_user_id,
    users[0].id,
  );
  await call(
    stageUrl,
    sessions[1],
    { title: "Updated Chapter", coverPhotoId: null, version: attributedStage.version },
    200,
    base,
    "PUT",
  );
  await call(
    scoped(`/api/stages/${createdStage.id}/publication`),
    sessions[1],
    { isPublic: false },
    200,
    base,
    "PUT",
  );
  for (const method of ["PUT", "DELETE"])
    await call(
      scoped("/api/stages/stage-b"),
      sessions[1],
      method === "PUT" ? { title: "Attack", version: 1 } : undefined,
      404,
      base,
      method,
    );
  await call(
    scoped("/api/stages/stage-b/publication"),
    sessions[1],
    { isPublic: true },
    404,
    base,
    "PUT",
  );
  await call(stageUrl, sessions[1], undefined, 200, base, "DELETE");
  const stageBatch = { type: "stage", action: "restore", ids: [createdStage.id, "stage-b"] };
  assert.deepEqual((await call(scoped("/api/trash"), sessions[1], stageBatch)).succeededIds, [
    createdStage.id,
  ]);
  await call(stageUrl, sessions[1], undefined, 200, base, "DELETE");
  assert.ok(
    (await call(scoped("/api/stages?trashed=true"), sessions[1])).stages.some(
      (stage) => stage.id === createdStage.id,
    ),
  );
  const deleteStageBatch = {
    type: "stage",
    action: "permanent",
    ids: [createdStage.id],
    confirm: true,
  };
  assert.equal(
    (await call(scoped("/api/trash"), sessions[1], deleteStageBatch)).failures[0].error,
    "MUSEUM_OWNER_REQUIRED",
  );
  assert.deepEqual((await call(scoped("/api/trash"), sessions[0], deleteStageBatch)).succeededIds, [
    createdStage.id,
  ]);
  const crossStagePage = await fetch(`${base}/stages/stage-b?museumId=${museumA}`, {
    headers: { cookie: `memory_palace_user=${sessions[1]}` },
  });
  assert.equal(crossStagePage.status, 404);
  const legacy = await fetch(`${base}/api/auth`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ password: "isolated-legacy-password" }),
  });
  assert.equal(legacy.status, 200);
  const legacyCookie = legacy.headers.get("set-cookie").split(";")[0];
  const legacyWrite = await fetch(`${base}${scoped("/api/memories/own")}`, {
    method: "POST",
    headers: { origin: base, cookie: legacyCookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "trash" }),
  });
  assert.equal(
    legacyWrite.status,
    401,
    "Legacy Owner cookie must not bypass User/Museum authorization",
  );
  const legacyStageWrite = await fetch(`${base}${scoped("/api/stages")}`, {
    method: "POST",
    headers: { origin: base, cookie: legacyCookie, "content-type": "application/json" },
    body: JSON.stringify({ title: "Attack" }),
  });
  assert.equal(legacyStageWrite.status, 401);
  await call(scoped("/api/memories/own"), sessions[1], {
    action: "details",
    version: (await call(scoped("/api/memories/own"), sessions[1])).memory.version,
    title: "Edited",
    story: "Story",
    stageId: null,
  });
  await call(scoped("/api/memories/own"), sessions[1], { action: "note", content: "Later note" });
  for (const action of ["trash", "restore", "permanent"])
    await call(scoped("/api/memories/foreign"), sessions[1], { action, confirm: true }, 404);
  await call(
    scoped("/api/memories/own"),
    sessions[1],
    { action: "relations", relatedMemoryIds: ["foreign"] },
    400,
  );
  const input = {
    title: "Created",
    story: "Story",
    photoIds: ["photo-a"],
    coverPhotoId: "photo-a",
    userId: users[2].id,
  };
  const created = await call(scoped("/api/memories"), sessions[1], input, 201);
  assert.equal(
    db.prepare("SELECT museum_id FROM memories WHERE id=?").get(created.memory.id).museum_id,
    museumA,
  );
  await call(
    scoped("/api/memories"),
    sessions[1],
    { ...input, photoIds: ["photo-b"], coverPhotoId: "photo-b" },
    400,
  );
  const memoryUrl = scoped(`/api/memories/${created.memory.id}`);
  await call(memoryUrl, sessions[1], { action: "trash" });
  await call(memoryUrl, sessions[1], { action: "permanent", confirm: true }, 403);
  await call(memoryUrl, sessions[1], { action: "restore" });
  await call(memoryUrl, sessions[1], { action: "trash" });
  await call(memoryUrl, sessions[0], { action: "permanent", confirm: true });
  assert.equal(db.prepare("SELECT id FROM memories WHERE id=?").get(created.memory.id), undefined);
  const imageData = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#7699aa" },
  })
    .webp()
    .toBuffer();
  async function uploadPhoto(museumId, session, data = imageData, expected = 201, origin = base) {
    const form = new FormData();
    form.append("photos", new Blob([data], { type: "image/webp" }), "optimized.webp");
    form.set("originalName", "Acceptance Photo.jpg");
    const response = await fetch(`${base}/api/photos?museumId=${museumId}`, {
      method: "POST",
      headers: { cookie: `memory_palace_user=${session}`, origin },
      body: form,
    });
    assert.equal(response.status, expected, await response.clone().text());
    return expected === 201 ? (await response.json()).photos[0] : null;
  }
  await uploadPhoto(museumA, sessions[2], imageData, 404);
  await uploadPhoto(museumA, sessions[1], Buffer.from("Not an image"), 422);
  await uploadPhoto(museumA, sessions[1], imageData, 403, "http://attacker.example");
  const photoA = await uploadPhoto(museumA, sessions[1]);
  const photoB = await uploadPhoto(museumB, sessions[2]);
  assert.ok(photoA.optimizedStorageKey.startsWith(`uploads/museums/${museumA}/optimized/`));
  assert.ok(photoB.optimizedStorageKey.startsWith(`uploads/museums/${museumB}/optimized/`));
  assert.ok(statSync(path.join(directory, "images", photoA.optimizedStorageKey)).isFile());
  assert.ok(statSync(path.join(directory, "images", photoB.optimizedStorageKey)).isFile());
  async function media(photo, session, expected, variant = "") {
    const response = await fetch(`${base}/media/${photo.optimizedStorageKey}${variant}`, {
      headers: session ? { cookie: `memory_palace_user=${session}` } : {},
    });
    assert.equal(response.status, expected);
    if (expected === 200) {
      assert.equal(response.headers.get("content-type"), "image/webp");
      assert.ok((await response.arrayBuffer()).byteLength > 0);
    }
  }
  await media(photoA, sessions[1], 200);
  await media(photoA, sessions[1], 200, "?variant=thumbnail");
  await media(photoA, undefined, 404);
  await media(photoA, sessions[2], 404);
  await call(scoped(`/api/photos/${photoB.id}/archive`), sessions[1], {}, 404);
  await call(scoped(`/api/photos/${photoB.id}`), sessions[0], undefined, 404, base, "DELETE");
  await call(scoped(`/api/photos/${photoA.id}`), sessions[1], undefined, 403, base, "DELETE");
  assert.ok(
    (await call(scoped("/api/photos?source=recent"), sessions[1])).items.some(
      (photo) => photo.id === photoA.id,
    ),
  );
  assert.ok(
    !(await call(scoped("/api/photos?source=recent"), sessions[1])).items.some(
      (photo) => photo.id === photoB.id,
    ),
  );
  await call(scoped(`/api/photos/${photoA.id}/archive`), sessions[1], {});
  const ids = (await call(scoped("/api/photos?source=library&selection=ids"), sessions[1])).ids;
  assert.ok(ids.includes(photoA.id));
  assert.ok(!ids.includes(photoB.id));
  const photoMemory = (
    await call(
      scoped("/api/memories"),
      sessions[1],
      {
        title: "Photo acceptance",
        story: "Photo memory",
        stageId: null,
        photoIds: [photoA.id],
        coverPhotoId: photoA.id,
        relatedMemoryIds: [],
        createdByUserId: users[0].id,
        lastEditedByUserId: users[0].id,
      },
      201,
    )
  ).memory;
  assert.equal(photoMemory.createdByUserId, users[1].id);
  assert.equal(photoMemory.lastEditedByUserId, users[1].id);
  assert.equal(photoMemory.createdByDisplayName, "collaborator");
  db.prepare("UPDATE memories SET version=5 WHERE id=?").run(photoMemory.id);
  const ownerDraft = (await call(scoped(`/api/memories/${photoMemory.id}`), sessions[0])).memory;
  const memberDraft = (await call(scoped(`/api/memories/${photoMemory.id}`), sessions[1])).memory;
  const versionSave = await call(scoped(`/api/memories/${photoMemory.id}`), sessions[0], {
    action: "details",
    version: ownerDraft.version,
    title: "Photo acceptance",
    story: "Photo memory",
    lastEditedByUserId: users[2].id,
  });
  assert.equal(versionSave.version, 6);
  const attributedMemory = (await call(scoped(`/api/memories/${photoMemory.id}`), sessions[0]))
    .memory;
  assert.equal(attributedMemory.createdByUserId, users[1].id);
  assert.equal(attributedMemory.lastEditedByUserId, users[0].id);
  assert.equal(attributedMemory.lastEditedByDisplayName, "owner-a");
  const conflict = await call(
    scoped(`/api/memories/${photoMemory.id}`),
    sessions[1],
    {
      action: "details",
      version: memberDraft.version,
      title: "Must not overwrite",
      story: "Stale Story",
    },
    409,
  );
  assert.equal(conflict.error, "MEMORY_VERSION_CONFLICT");
  assert.deepEqual(
    (await call(scoped(`/api/memories/${photoMemory.id}`), sessions[0])).memory,
    attributedMemory,
  );
  await call(scoped(`/api/memories/${photoMemory.id}`), sessions[1], {
    action: "publication",
    isPublic: false,
  });
  await call(scoped(`/api/photos/${photoA.id}`), sessions[0], undefined, 409, base, "DELETE");
  const filtered = await call(
    scoped("/api/photos?source=library&q=Photo%20acceptance"),
    sessions[1],
  );
  assert.deepEqual(
    filtered.items.map((photo) => photo.id),
    [photoA.id],
  );
  assert.deepEqual(filtered.items[0].memoryTitles, ["Photo acceptance"]);
  const disposablePhoto = await uploadPhoto(museumA, sessions[0]);
  await media(disposablePhoto, sessions[0], 200, "?variant=preview");
  const deletedPhotos = await call(
    scoped("/api/photos"),
    sessions[0],
    { ids: [disposablePhoto.id, photoB.id] },
    200,
    base,
    "DELETE",
  );
  assert.deepEqual(deletedPhotos.deletedIds, [disposablePhoto.id]);
  assert.equal(deletedPhotos.failures[0].error, "PHOTO_NOT_FOUND");
  await media(disposablePhoto, sessions[0], 404);
  assert.ok(db.prepare("SELECT id FROM uploaded_photos WHERE id=?").get(photoB.id));
  if (process.env.PALACE_TEST_PLAYWRIGHT) {
    const { chromium } = await import(process.env.PALACE_TEST_PLAYWRIGHT);
    browser = await chromium.launch({
      executablePath: process.env.PALACE_TEST_CHROME,
      headless: true,
    });
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: "memory_palace_user",
        value: sessions[1],
        url: base,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    const errors = [];
    const expectedConflictErrors = [];
    let expectingConflict = false;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        if (expectingConflict && /Failed to load resource.*409/.test(message.text()))
          expectedConflictErrors.push(message.text());
        else errors.push(message.text());
      }
    });
    await page.goto(`${base}/workspace?museumId=${museumA}`, { waitUntil: "networkidle" });
    const png = await sharp(imageData).png().toBuffer();
    const browserUpload = page.waitForResponse(
      (response) =>
        response.url().includes("/api/photos?museumId=") && response.request().method() === "POST",
    );
    await page
      .locator(".upload-bar input[type=file]")
      .setInputFiles({ name: "Browser Photo.png", mimeType: "image/png", buffer: png });
    const browserResponse = await browserUpload;
    assert.equal(browserResponse.status(), 201);
    const browserPhoto = (await browserResponse.json()).photos[0];
    assert.ok(browserPhoto.optimizedStorageKey.startsWith(`uploads/museums/${museumA}/optimized/`));
    const tile = page.locator(`[data-photo-id="${browserPhoto.id}"]`);
    await tile.waitFor();
    await page.waitForFunction((photoId) => {
      const img = document.querySelector(`[data-photo-id="${photoId}"] img`);
      return img?.complete && img.naturalWidth > 0;
    }, browserPhoto.id);
    assert.equal(await tile.locator(".photo-tile-delete").isDisabled(), true);
    await tile.locator("input[type=checkbox]").check();
    await page.locator('a[href*="/memories/new?"]').click();
    assert.ok(page.url().includes(`museumId=${museumA}`));
    await page.locator(".memory-form input[name=title]").fill("Browser photo Memory");
    await page.locator(".memory-form textarea[name=story]").fill("Created from a scoped photo");
    const browserMemorySave = page.waitForResponse(
      (response) =>
        response.url().includes("/api/memories?") && response.request().method() === "POST",
    );
    await page.locator(".memory-form button[type=submit]").click();
    assert.equal((await browserMemorySave).status(), 201);
    await page.waitForURL(/\/memories\/(?!new)/);
    await page.getByRole("heading", { name: "Browser photo Memory", exact: true }).waitFor();
    assert.equal(
      await page.locator(".memory-attribution").innerText(),
      "由 collaborator 创建 · 最后由 collaborator 编辑",
    );
    if (process.env.PALACE_TEST_PHOTO_SCREENSHOT)
      await page.screenshot({ path: process.env.PALACE_TEST_PHOTO_SCREENSHOT, fullPage: true });
    assert.deepEqual(errors, []);
    await page.goto(`${base}/memories/own?museumId=${museumA}`, { waitUntil: "networkidle" });
    await page.locator(".memory-details-form input").fill("Browser edited");
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/api/memories/own") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "保存基本信息", exact: true }).click();
    assert.equal((await saved).status(), 200);
    assert.equal(
      db.prepare("SELECT title FROM memories WHERE id='own'").get().title,
      "Browser edited",
    );
    await page.waitForFunction(() =>
      document
        .querySelector(".memory-attribution")
        ?.textContent?.includes("最后由 collaborator 编辑"),
    );
    assert.equal(
      await page.locator(".memory-attribution").innerText(),
      "创建者未记录 · 最后由 collaborator 编辑",
    );
    if (process.env.PALACE_TEST_SCREENSHOT)
      await page.screenshot({ path: process.env.PALACE_TEST_SCREENSHOT, fullPage: true });
    assert.deepEqual(errors, []);
    const ownerContext = await browser.newContext();
    await ownerContext.addCookies([
      {
        name: "memory_palace_user",
        value: sessions[0],
        url: base,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const ownerPage = await ownerContext.newPage();
    ownerPage.on("pageerror", (error) => errors.push(error.message));
    ownerPage.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await ownerPage.goto(`${base}/memories/own?museumId=${museumA}`, { waitUntil: "networkidle" });
    await page.locator(".memory-details-form input").fill("Collaborator stale draft");
    await ownerPage.locator(".memory-details-form input").fill("Owner latest content");
    const ownerSaved = ownerPage.waitForResponse(
      (response) =>
        response.url().includes("/api/memories/own") && response.request().method() === "POST",
    );
    await ownerPage.getByRole("button", { name: "保存基本信息", exact: true }).click();
    assert.equal((await ownerSaved).status(), 200);
    expectingConflict = true;
    const staleSaved = page.waitForResponse(
      (response) =>
        response.url().includes("/api/memories/own") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "保存基本信息", exact: true }).click();
    assert.equal((await staleSaved).status(), 409);
    const conflictAlert = page.locator(".memory-management [role=alert]");
    await conflictAlert.waitFor();
    assert.match(await conflictAlert.innerText(), /草稿仍保留/);
    assert.equal(
      await page.locator(".memory-details-form input").inputValue(),
      "Collaborator stale draft",
    );
    assert.equal(
      db.prepare("SELECT title FROM memories WHERE id='own'").get().title,
      "Owner latest content",
    );
    assert.equal(
      db.prepare("SELECT last_edited_by_user_id FROM memories WHERE id='own'").get()
        .last_edited_by_user_id,
      users[0].id,
    );
    await conflictAlert.scrollIntoViewIfNeeded();
    if (process.env.PALACE_TEST_CONFLICT_SCREENSHOT)
      await page.screenshot({ path: process.env.PALACE_TEST_CONFLICT_SCREENSHOT });
    expectingConflict = false;
    assert.ok(expectedConflictErrors.length <= 1);
    assert.deepEqual(errors, []);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "重新加载最新内容", exact: true }).click();
    assert.equal(
      await page.locator(".memory-details-form input").inputValue(),
      "Collaborator stale draft",
    );
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "重新加载最新内容", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector(".memory-details-form input")?.value === "Owner latest content",
    );
    await page.locator(".memory-details-form input").fill("Collaborator reloaded save");
    const reloadedSave = page.waitForResponse(
      (response) =>
        response.url().includes("/api/memories/own") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "保存基本信息", exact: true }).click();
    assert.equal((await reloadedSave).status(), 200);
    assert.equal(
      db.prepare("SELECT title FROM memories WHERE id='own'").get().title,
      "Collaborator reloaded save",
    );
    await ownerContext.close();
    await page.goto(`${base}/stages?museumId=${museumA}`, { waitUntil: "networkidle" });
    assert.equal(
      await page.getByRole("heading", { name: "B Secret Chapter", exact: true }).count(),
      0,
    );
    await page.locator("#stage-stage-a input[name=title]").fill("Browser edited Chapter");
    const stageSaved = page.waitForResponse(
      (response) =>
        response.url().includes("/api/stages/stage-a?") && response.request().method() === "PUT",
    );
    await page
      .locator("#stage-stage-a button[type=submit], #stage-stage-a .stage-form-actions button")
      .first()
      .click();
    assert.equal((await stageSaved).status(), 200);
    assert.equal(
      db.prepare("SELECT title FROM stages WHERE id='stage-a'").get().title,
      "Browser edited Chapter",
    );
    await page.goto(`${base}/?museumId=${museumA}`, { waitUntil: "networkidle" });
    const stageLink = page.locator('a.stage-book[href*="stage-a"]');
    assert.ok((await stageLink.getAttribute("href")).includes(`museumId=${museumA}`));
    await stageLink.click();
    await page.getByRole("heading", { name: "Browser edited Chapter", exact: true }).waitFor();
    if (process.env.PALACE_TEST_STAGE_SCREENSHOT)
      await page.screenshot({ path: process.env.PALACE_TEST_STAGE_SCREENSHOT, fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
    const settingsContext = await browser.newContext();
    await settingsContext.addCookies([
      {
        name: "memory_palace_user",
        value: sessions[0],
        url: base,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const settingsPage = await settingsContext.newPage();
    settingsPage.on("pageerror", (error) => errors.push(error.message));
    settingsPage.on("console", (message) => {
      if (message.type() !== "error") return;
      if (expectingConflict && /Failed to load resource.*409/.test(message.text()))
        expectedConflictErrors.push(message.text());
      else errors.push(message.text());
    });
    for (const kind of ["stage", "profile"]) {
      const isStage = kind === "stage";
      const endpoint = isStage ? scoped("/api/stages/stage-a") : "/api/museums";
      const method = isStage ? "PUT" : "PATCH";
      await settingsPage.goto(`${base}${isStage ? `/stages?museumId=${museumA}` : "/account"}`, {
        waitUntil: "networkidle",
      });
      const input = settingsPage.locator(
        isStage ? "#stage-stage-a input[name=title]" : "input[name=name]",
      );
      const save = isStage
        ? settingsPage.locator("#stage-stage-a .stage-form-actions button").first()
        : settingsPage.getByRole("button", { name: "保存博物馆资料", exact: true });
      await input.fill(`Retained ${kind} draft`);
      const version = isStage
        ? (await call(endpoint, sessions[1])).stage.version
        : db.prepare("SELECT version FROM museums WHERE id=?").get(museumA).version;
      await call(
        endpoint,
        sessions[isStage ? 1 : 0],
        isStage
          ? { title: "Latest Chapter", version }
          : { name: "Latest Museum", description: "Latest About", coverPhotoId: null, version },
        200,
        base,
        method,
      );
      expectingConflict = true;
      const staleSave = settingsPage.waitForResponse(
        (response) =>
          response.url() === `${base}${endpoint}` && response.request().method() === method,
      );
      await save.click();
      assert.equal((await staleSave).status(), 409);
      const notice = settingsPage.locator(
        isStage ? ".stage-manager .form-message" : ".login-form .form-error[role=alert]",
      );
      await notice.waitFor();
      assert.match(await notice.innerText(), /草稿仍保留/);
      assert.equal(await input.inputValue(), `Retained ${kind} draft`);
      const row = isStage
        ? db.prepare("SELECT title FROM stages WHERE id='stage-a'").get()
        : db.prepare("SELECT name FROM museums WHERE id=?").get(museumA);
      assert.equal(isStage ? row.title : row.name, isStage ? "Latest Chapter" : "Latest Museum");
      const screenshot =
        process.env[
          isStage
            ? "PALACE_TEST_STAGE_CONFLICT_SCREENSHOT"
            : "PALACE_TEST_PROFILE_CONFLICT_SCREENSHOT"
        ];
      if (screenshot) {
        await notice.scrollIntoViewIfNeeded();
        await settingsPage.screenshot({ path: screenshot });
      }
      expectingConflict = false;
      settingsPage.once("dialog", (dialog) => dialog.accept());
      await settingsPage.getByRole("button", { name: "重新加载最新内容", exact: true }).click();
      await settingsPage.waitForFunction(
        ({ selector, value }) => document.querySelector(selector)?.value === value,
        {
          selector: isStage ? "#stage-stage-a input[name=title]" : "input[name=name]",
          value: isStage ? "Latest Chapter" : "Latest Museum",
        },
      );
      for (const suffix of ["first", "second"]) {
        await input.fill(`Reloaded ${kind} ${suffix}`);
        const savedAgain = settingsPage.waitForResponse(
          (response) =>
            response.url() === `${base}${endpoint}` && response.request().method() === method,
        );
        await save.click();
        assert.equal((await savedAgain).status(), 200);
      }
    }
    assert.deepEqual(errors, []);
    assert.ok(expectedConflictErrors.length <= 3);
    await settingsContext.close();
    console.log(
      "PASS Chrome: upload, Memory/Stage/Profile edits and conflicts, retained drafts, confirmed reload and repeat saves; no unexpected page/console errors (expected conflict HTTP 409)",
    );
  }
  await call(scoped("/api/memories/own"), sessions[1], { action: "trash" });
  const deniedBatch = await call(scoped("/api/trash"), sessions[1], {
    type: "memory",
    action: "permanent",
    ids: ["own"],
    confirm: true,
  });
  assert.equal(deniedBatch.failures[0].error, "MUSEUM_OWNER_REQUIRED");
  const batch = await call(scoped("/api/trash"), sessions[1], {
    type: "memory",
    action: "restore",
    ids: ["own", "foreign"],
  });
  assert.deepEqual(batch.succeededIds, ["own"]);
  assert.equal(batch.failures[0].error, "MEMORY_NOT_FOUND");
  db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,is_public,created_at,updated_at) VALUES ('share-memory',?,'Share acceptance','Share story',1,?,?)",
  ).run(museumA, now, now);
  const shareInput = {
    memoryId: "share-memory",
    enabled: true,
    mode: "link",
    password: "",
    rotate: false,
  };
  await call(scoped("/api/shares"), undefined, shareInput, 401);
  await call(scoped("/api/shares"), sessions[1], shareInput, 403);
  await call(scoped("/api/shares"), sessions[2], shareInput, 404);
  await call(scoped("/api/shares"), sessions[0], { ...shareInput, memoryId: "foreign" }, 404);
  await call(scoped("/api/shares"), sessions[0], shareInput, 403, "http://attacker.example");
  const legacyShare = await fetch(`${base}${scoped("/api/shares")}`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json", cookie: legacyCookie },
    body: JSON.stringify(shareInput),
  });
  assert.equal(legacyShare.status, 401);
  let share = await call(scoped("/api/shares"), sessions[0], shareInput);
  assert.equal(
    db.prepare("SELECT museum_id FROM share_configs WHERE id=?").get(share.token).museum_id,
    museumA,
  );
  assert.equal((await fetch(`${base}${share.url}`)).status, 200);
  const oldShare = share;
  share = await call(scoped("/api/shares"), sessions[0], {
    ...shareInput,
    rotate: true,
    mode: "password",
    password: "isolated-share-password",
  });
  assert.equal((await fetch(`${base}${oldShare.url}`)).status, 404);
  await call("/api/share-access", undefined, { token: share.token, password: "wrong" }, 401);
  const passwordAccess = await fetch(`${base}/api/share-access`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ token: share.token, password: "isolated-share-password" }),
  });
  assert.equal(passwordAccess.status, 200);
  const shareCookie = passwordAccess.headers.get("set-cookie").split(";")[0];
  const sharedPage = await fetch(`${base}${share.url}`, { headers: { cookie: shareCookie } });
  const sharedHtml = await sharedPage.text();
  assert.match(sharedHtml, /Share acceptance/);
  assert.match(sharedHtml, /创建者未记录/);
  assert.match(sharedHtml, /最后由 owner-a 编辑/);
  await call(scoped("/api/trash"), sessions[0], {
    type: "memory",
    action: "trash",
    ids: ["share-memory"],
  });
  assert.equal((await fetch(`${base}${share.url}`)).status, 404);
  await call(scoped("/api/trash"), sessions[0], {
    type: "memory",
    action: "restore",
    ids: ["share-memory"],
  });
  await call(scoped("/api/shares"), sessions[0], { ...shareInput, enabled: false });
  assert.equal((await fetch(`${base}${share.url}`)).status, 404);
  share = await call(scoped("/api/shares"), sessions[0], shareInput);
  // F6: exercise real route boundaries, not just repository authorization helpers.
  for (const [label, museumId] of [
    ["a", museumA],
    ["b", museumB],
  ]) {
    db.prepare(
      "INSERT INTO memories (id,museum_id,title,story,trashed_at,created_at,updated_at) VALUES (?,?,'IDOR trash secret','Story',?,?,?)",
    ).run(`idor-trash-memory-${label}`, museumId, now, now, now);
    db.prepare(
      "INSERT INTO stages (id,museum_id,title,trashed_at,created_at,updated_at) VALUES (?,?,'IDOR trash secret',?,?,?)",
    ).run(`idor-trash-stage-${label}`, museumId, now, now, now);
  }
  const snapshotDomain = () =>
    JSON.stringify(
      [
        "memories",
        "stages",
        "uploaded_photos",
        "memory_images",
        "stage_covers",
        "later_notes",
        "memory_relations",
        "share_configs",
        "photo_deletion_jobs",
        "pending_uploads",
      ].map((table) =>
        db
          .prepare(`SELECT * FROM ${table}`)
          .all()
          .map((row) => JSON.stringify(row))
          .sort(),
      ),
    );
  async function deniedMatrix(token, target, museumDenied = false, photoDeleteStatus = 404) {
    const before = snapshotDomain();
    const spoofedIdentity = { userId: target.ownerUserId, museumId: target.museumId };
    await call(scoped(`/api/memories/${target.memory}`), token, undefined, 404);
    await call(
      scoped(`/api/memories/${target.memory}`),
      token,
      {
        action: "details",
        version: 1,
        title: "IDOR injection",
        story: "Injection",
        stageId: null,
        ...spoofedIdentity,
      },
      404,
    );
    await call(
      scoped(`/api/memories/${target.memory}`),
      token,
      { action: "note", content: "IDOR secret injection", ...spoofedIdentity },
      404,
    );
    await call(scoped(`/api/memories/${target.memory}`), token, { action: "trash" }, 404);
    await call(scoped(`/api/stages/${target.stage}`), token, undefined, 404);
    await call(
      scoped(`/api/stages/${target.stage}`),
      token,
      {
        title: "IDOR injection",
        description: "",
        coverPhotoId: null,
        version: 1,
        ...spoofedIdentity,
      },
      404,
      base,
      "PUT",
    );
    await call(scoped(`/api/stages/${target.stage}`), token, undefined, 404, base, "DELETE");
    await call(scoped(`/api/photos/${target.photo}/archive`), token, {}, 404);
    await call(
      scoped(`/api/photos/${target.photo}`),
      token,
      undefined,
      photoDeleteStatus,
      base,
      "DELETE",
    );
    await call(
      scoped("/api/shares"),
      token,
      { ...shareInput, memoryId: target.memory, ...spoofedIdentity },
      404,
    );
    await call(
      scoped("/api/shares"),
      token,
      { ...shareInput, memoryId: target.memory, enabled: false, ...spoofedIdentity },
      404,
    );
    for (const [type, id] of [
      ["memory", target.trashMemory],
      ["stage", target.trashStage],
    ]) {
      for (const action of ["restore", "permanent"]) {
        const result = await call(
          scoped("/api/trash"),
          token,
          { type, action, ids: [id], confirm: true, ...spoofedIdentity },
          museumDenied ? 404 : 200,
        );
        if (!museumDenied) {
          assert.deepEqual(result.succeededIds, []);
          assert.deepEqual(result.failures, [
            { id, error: type === "memory" ? "MEMORY_NOT_FOUND" : "STAGE_NOT_FOUND" },
          ]);
        }
      }
    }
    assert.equal(snapshotDomain(), before, "Rejected requests changed domain data");
  }
  const targetB = {
    ownerUserId: users[2].id,
    museumId: museumB,
    memory: "foreign",
    stage: "stage-b",
    photo: photoB.id,
    trashMemory: "idor-trash-memory-b",
    trashStage: "idor-trash-stage-b",
  };
  const targetA = {
    ownerUserId: users[0].id,
    museumId: museumA,
    memory: "own",
    stage: "stage-a",
    photo: photoA.id,
    trashMemory: "idor-trash-memory-a",
    trashStage: "idor-trash-stage-a",
  };
  await deniedMatrix(sessions[0], targetB);
  await deniedMatrix(sessions[1], targetB, false, 403);
  await deniedMatrix(sessions[2], targetA, true);
  const wrongToken = `${share.token}tampered`;
  assert.equal((await fetch(`${base}/share/${wrongToken}`)).status, 404);
  await call(
    "/api/share-access",
    undefined,
    { token: wrongToken, password: "isolated-share-password" },
    401,
  );
  db.prepare("UPDATE museum_memberships SET status='revoked' WHERE museum_id=? AND user_id=?").run(
    museumA,
    users[1].id,
  );
  await call(scoped("/api/memories/own"), sessions[1], undefined, 404);
  await call(scoped("/api/memories/own"), sessions[1], { action: "trash" }, 404);
  await call(scoped("/api/stages/stage-a"), sessions[1], undefined, 404);
  await call(scoped("/api/stages/stage-a"), sessions[1], undefined, 404, base, "DELETE");
  await call(scoped("/api/photos"), sessions[1], undefined, 404);
  await call(scoped("/api/shares"), sessions[1], shareInput, 404);
  await deniedMatrix(sessions[1], targetA, true);
  console.log(
    "PASS F6: Owner/both-Museum collaborator/nonmember/revoked-member IDOR matrix, forged body identity, tampered Share token, unchanged domain snapshots",
  );
  await media(photoA, sessions[1], 404);
  db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museumA);
  await call(scoped("/api/memories/own"), sessions[0], { action: "trash" }, 404);
  await call(scoped("/api/stages"), sessions[0], { title: "Denied" }, 404);
  await media(photoA, sessions[0], 404);
  assert.equal((await fetch(`${base}${share.url}`)).status, 404);
  await call(scoped("/api/shares"), sessions[0], shareInput, 404);
  assert.equal(db.prepare("SELECT title FROM memories WHERE id='foreign'").get().title, "B Secret");
  assert.equal(
    db.prepare("SELECT title FROM stages WHERE id='stage-b'").get().title,
    "B Secret Chapter",
  );
  console.log(
    "PASS HTTP: Memory/Stage/Photo/Share scope, link/password/rotation/disable and Trash lifecycle, physical isolation, revocation and pending Museum",
  );
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
  db.close();
  assert.ok(directory.startsWith(prefix));
  rmSync(directory, { recursive: true, force: true });
}
