// Synthetic local Museums and files only; production data is never selected.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import sharp from "sharp";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";

const directory = mkdtempSync(path.join(tmpdir(), "museum-copy-http-"));
const db = initializeDatabase(path.join(directory, "palace.sqlite"), false);
let server;
let browser;
try {
  const users = ["source", "target", "outsider"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "fixture-hash",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const museums = users.map((user) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      name: user.displayName,
      slug: user.displayName,
      storageQuotaBytes: 1000000,
    }),
  );
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museums[1].id, users[0].id);
  const token = randomBytes(32).toString("base64url");
  db.prepare(
    "INSERT INTO user_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,'now')",
  ).run(
    createHash("sha256").update(token).digest("hex"),
    users[0].id,
    new Date(Date.now() + 600000).toISOString(),
  );
  const cookie = `memory_palace_user=${token}`;
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MEMORY_PALACE_DATA_DIR: directory,
        MEMORY_PALACE_DATASET: "owner",
        MEMORY_PALACE_OWNER_PASSWORD: "",
        MEMORY_PALACE_SECURE_COOKIES: "false",
        MEMORY_PALACE_SESSION_SECRET: "isolated-museum-copy-secret-at-least-32-characters",
      },
    },
  );
  let serverOutput = "";
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      serverOutput = (serverOutput + chunk).slice(-3000);
    });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try {
      if (
        (await fetch(`${base}/api/photos`, { signal: AbortSignal.timeout(2000) })).status === 401
      ) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, serverOutput);
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ffffff" } })
    .webp()
    .toBuffer();
  const form = new FormData();
  form.append("photos", new Blob([image], { type: "image/webp" }), "copy-fixture.webp");
  form.append("originalName", "copy-fixture.webp");
  const upload = await fetch(`${base}/api/photos?museumId=${museums[0].id}`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: base },
    body: form,
  });
  assert.equal(upload.status, 201, await upload.clone().text());
  const photo = (await upload.json()).photos[0];
  const sourceRow = db.prepare("SELECT * FROM uploaded_photos WHERE id=?").get(photo.id);
  const url = `/api/photos/${photo.id}/copy?museumId=${museums[0].id}`;
  const copy = (body = { targetMuseumId: museums[1].id }, auth = cookie, origin = base) =>
    fetch(`${base}${url}`, {
      method: "POST",
      headers: { Cookie: auth, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await copy(undefined, "")).status, 401);
  assert.equal((await copy(undefined, cookie, "https://attacker.example")).status, 403);
  assert.equal((await copy({ targetMuseumId: museums[1].id, userId: users[1].id })).status, 400);
  assert.equal((await copy({ targetMuseumId: museums[2].id })).status, 404);
  db.prepare("UPDATE museums SET storage_quota_bytes=0 WHERE id=?").run(museums[1].id);
  assert.equal((await copy()).status, 507);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pending_uploads").get().n, 0);
  db.prepare("UPDATE museums SET storage_quota_bytes=1000000 WHERE id=?").run(museums[1].id);
  const response = await copy();
  assert.equal(response.status, 201, await response.clone().text());
  const result = await response.json();
  const targetRow = db
    .prepare("SELECT * FROM uploaded_photos WHERE id=? AND museum_id=?")
    .get(result.photoId, museums[1].id);
  assert.ok(targetRow);
  assert.deepEqual(db.prepare("SELECT * FROM uploaded_photos WHERE id=?").get(photo.id), sourceRow);
  const sourcePath = path.join(directory, "images", photo.optimizedStorageKey);
  const targetPath = path.join(directory, "images", targetRow.optimized_storage_key);
  assert.deepEqual(readFileSync(targetPath), readFileSync(sourcePath));
  if (statSync(sourcePath).ino !== 0)
    assert.notEqual(statSync(sourcePath).ino, statSync(targetPath).ino);
  if (process.env.PALACE_TEST_PLAYWRIGHT && process.env.PALACE_TEST_CHROME) {
    const { chromium } = await import(process.env.PALACE_TEST_PLAYWRIGHT);
    browser = await chromium.launch({
      executablePath: process.env.PALACE_TEST_CHROME,
      headless: true,
    });
    const context = await browser.newContext();
    await context.addCookies([{ name: "memory_palace_user", value: token, url: base }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`${base}/workspace?museumId=${museums[0].id}`);
    await page.getByRole("checkbox", { name: "选择照片“copy-fixture.webp”" }).check();
    await page.getByLabel("复制到另一座博物馆").selectOption(museums[1].id);
    const saved = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/photos/${photo.id}/copy`) && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "复制这张照片", exact: true }).click();
    assert.equal((await saved).status(), 201);
    await page.getByText("已生成独立副本，原照片不受影响。", { exact: false }).waitFor();
    await page.getByRole("link", { name: "查看目标博物馆" }).click();
    await page.getByRole("checkbox", { name: "选择照片“copy-fixture.webp”" }).first().waitFor();
    assert.equal(
      await page.getByRole("checkbox", { name: "选择照片“copy-fixture.webp”" }).count(),
      2,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS K1 Chrome: select source Photo, choose target, copy, open target workspace; no page/console errors",
    );
  }
  const removed = await fetch(`${base}/api/photos/${photo.id}?museumId=${museums[0].id}`, {
    method: "DELETE",
    headers: { Cookie: cookie, Origin: base },
  });
  assert.equal(removed.status, 200, await removed.clone().text());
  assert.deepEqual(readFileSync(targetPath), image);
  assert.equal(
    (
      await fetch(`${base}/media/${targetRow.optimized_storage_key}`, {
        headers: { Cookie: cookie },
      })
    ).status,
    200,
  );
  console.log(
    "PASS K1 HTTP: production API auth/origin/input/quota checks; independent target Photo/files; source deletion does not affect copies",
  );
  const memoryPhotos = [];
  for (const index of [0, 1]) {
    const memoryForm = new FormData();
    memoryForm.append("photos", new Blob([image], { type: "image/webp" }), `memory-${index}.webp`);
    memoryForm.append("originalName", `memory-${index}.webp`);
    const uploaded = await fetch(`${base}/api/photos?museumId=${museums[0].id}`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: base },
      body: memoryForm,
    });
    assert.equal(uploaded.status, 201);
    memoryPhotos.push((await uploaded.json()).photos[0]);
  }
  db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,is_public,created_at,updated_at) VALUES ('memory-source',?,'Copy Memory','Original Story',1,'now','now')",
  ).run(museums[0].id);
  for (const [index, item] of memoryPhotos.entries()) {
    db.prepare(
      `INSERT INTO memory_images (id,museum_id,memory_id,storage_key,exhibit_title,sort_order,is_cover,created_at)
      VALUES (?,?,'memory-source',?,'Exhibit',?,?,'now')`,
    ).run(`exhibit-${index}`, museums[0].id, item.optimizedStorageKey, index, index === 1 ? 1 : 0);
    db.prepare("UPDATE uploaded_photos SET used_at='now' WHERE id=?").run(item.id);
  }
  db.prepare(
    "INSERT INTO later_notes (id,museum_id,memory_id,content,created_at) VALUES ('note-source',?,'memory-source','Later words','2026-01-01T00:00:00.000Z')",
  ).run(museums[0].id);
  const memoryCopyUrl = `${base}/api/memories/memory-source/copy?museumId=${museums[0].id}`;
  const copyMemory = (target = museums[1].id) =>
    fetch(memoryCopyUrl, {
      method: "POST",
      headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ targetMuseumId: target }),
    });
  assert.equal((await copyMemory(museums[2].id)).status, 404);
  const copiedMemoryResponse = await copyMemory();
  assert.equal(copiedMemoryResponse.status, 201, await copiedMemoryResponse.clone().text());
  const copiedMemory = await copiedMemoryResponse.json();
  const exhibits = db
    .prepare("SELECT * FROM memory_images WHERE memory_id=? ORDER BY sort_order")
    .all(copiedMemory.memoryId);
  assert.equal(exhibits.length, 2);
  assert.equal(exhibits[1].is_cover, 1);
  for (const [index, exhibit] of exhibits.entries()) {
    assert.notEqual(exhibit.storage_key, memoryPhotos[index].optimizedStorageKey);
    assert.deepEqual(readFileSync(path.join(directory, "images", exhibit.storage_key)), image);
  }
  if (browser) {
    const context = await browser.newContext();
    await context.addCookies([{ name: "memory_palace_user", value: token, url: base }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`${base}/memories/memory-source?museumId=${museums[0].id}`);
    await page.locator("summary").filter({ hasText: "复制这段 Memory" }).click();
    await page.getByLabel("复制到另一座博物馆").selectOption(museums[1].id);
    const saved = page.waitForResponse(
      (res) =>
        res.url().includes("/api/memories/memory-source/copy") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "复制这段 Memory", exact: true }).click();
    assert.equal((await saved).status(), 201);
    await page.getByRole("link", { name: "查看目标博物馆" }).click();
    await page.getByRole("heading", { name: "Copy Memory", exact: true }).waitFor();
    assert.ok((await page.textContent("body")).includes("Later words"));
    assert.deepEqual(errors, []);
    console.log(
      "PASS K2 Chrome: copy saved Memory and open independent private target exhibition; no page/console errors",
    );
  }
  db.exec("UPDATE memories SET story='Changed original' WHERE id='memory-source'");
  assert.equal(
    db.prepare("SELECT story FROM memories WHERE id=?").get(copiedMemory.memoryId).story,
    "Original Story",
  );
  assert.equal(
    db.prepare("SELECT is_public FROM memories WHERE id=?").get(copiedMemory.memoryId).is_public,
    0,
  );
  console.log(
    "PASS K2 HTTP: new Memory/Photos/exhibits/notes and files; private target; independent source changes",
  );
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null)
    await new Promise((resolve) => {
      server.once("exit", resolve);
      server.kill();
    });
  db.close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
