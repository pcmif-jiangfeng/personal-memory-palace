// Disposable local data only. DELETE on /deletion cancels the plan; it never purges assets.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import sharp from "sharp";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";

const directory = mkdtempSync(path.join(tmpdir(), "museum-deletion-http-"));
const db = initializeDatabase(path.join(directory, "palace.sqlite"), false);
let server;
let output = "";
try {
  const users = ["owner", "member", "admin"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "PRIVATE-HASH",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const museums = users.map((user) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      name: `MUSEUM-${user.displayName}`,
      slug: user.displayName,
      storageQuotaBytes: 1024 * 1024,
    }),
  );
  const id = museums[0].id;
  const cookies = users.map((user) => {
    const token = randomBytes(32).toString("base64url");
    db.prepare(
      "INSERT INTO user_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,'now')",
    ).run(
      createHash("sha256").update(token).digest("hex"),
      user.id,
      new Date(Date.now() + 600000).toISOString(),
    );
    return `memory_palace_user=${token}`;
  });
  db.prepare(
    "INSERT INTO stages (id,museum_id,title,created_at,updated_at) VALUES ('stage',?,'PUBLIC-STAGE','now','now')",
  ).run(id);
  db.prepare(
    "INSERT INTO memories (id,museum_id,stage_id,title,story,created_at,updated_at) VALUES ('memory',?,'stage','PUBLIC-MEMORY','STORY-SENTINEL','now','now')",
  ).run(id);
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MEMORY_PALACE_DATA_DIR: directory,
        MEMORY_PALACE_DATASET: "owner",
        MEMORY_PALACE_OWNER_PASSWORD: "",
        MEMORY_PALACE_PLATFORM_ADMIN_USER_ID: users[2].id,
        MEMORY_PALACE_SECURE_COOKIES: "false",
        MEMORY_PALACE_SESSION_SECRET: "isolated-j4-http-secret-at-least-32-characters",
      },
    },
  );
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      output = (output + chunk).slice(-6000);
    });
  server.on("error", (error) => {
    output += error.message;
  });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null) throw new Error(output);
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
  assert.ok(ready, output);
  const get = (url, cookie = cookies[0]) =>
    fetch(`${base}${url}`, {
      headers: { Cookie: cookie },
      redirect: "manual",
      signal: AbortSignal.timeout(60000),
    });
  const api = `/api/museums/${id}/deletion`;
  const page = `/account/museums/${id}/deletion`;
  const mutate = (method, version, cookie = cookies[0], origin = base, extra = {}) =>
    fetch(`${base}${api}`, {
      method,
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true, version, ...extra }),
      signal: AbortSignal.timeout(60000),
    });
  assert.equal((await get(api, "")).status, 401);
  assert.equal((await get(page, "")).status, 307);
  assert.equal((await get(api, cookies[2])).status, 404); // Admin is not the Museum's Owner.
  assert.equal((await mutate("POST", 1, cookies[0], "https://attacker.example")).status, 403);
  assert.equal((await mutate("POST", 1, "")).status, 401);
  assert.equal(
    (await mutate("POST", 1, cookies[0], base, { deletionScheduledAt: "2030-01-01" })).status,
    400,
  );
  const activePage = await get(page);
  assert.equal(activePage.status, 200);
  assert.match(await activePage.text(), /确认进入 30 天待删除/);
  // Upload a real asset through the same HTTP path used by the UI.
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ffffff" } })
    .webp()
    .toBuffer();
  const form = new FormData();
  form.append("photos", new Blob([image], { type: "image/webp" }), "fixture.webp");
  const upload = await fetch(`${base}/api/photos?museumId=${id}`, {
    method: "POST",
    headers: { Cookie: cookies[0], Origin: base },
    body: form,
  });
  assert.equal(upload.status, 201, await upload.clone().text());
  const photo = (await upload.json()).photos[0];
  const photoPath = path.join(directory, "images", photo.optimizedStorageKey);
  const photoSize = statSync(photoPath).size;
  db.prepare("INSERT INTO stage_covers (stage_id,storage_key,museum_id) VALUES ('stage',?,?)").run(
    photo.optimizedStorageKey,
    id,
  );
  const media = `/media/${photo.optimizedStorageKey}`;
  assert.equal((await get(media, "")).status, 200);
  assert.equal((await get("/memories/memory", "")).status, 200);
  assert.equal((await get("/stages/stage", "")).status, 200);
  // A collaborator added after the precheck must block scheduling inside the write transaction.
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(id, users[1].id);
  assert.equal((await mutate("POST", 1)).status, 409);
  db.prepare("UPDATE museum_memberships SET status='revoked' WHERE museum_id=?").run(id);
  const startedAt = Date.now();
  const response = await mutate("POST", 1);
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  const pending = await response.json();
  assert.equal(pending.status, "pending_deletion");
  assert.equal(pending.version, 2);
  assert.ok(Math.abs(Date.parse(pending.deletionScheduledAt) - startedAt - 30 * 86400000) < 10000);
  assert.doesNotMatch(JSON.stringify(pending), /PRIVATE-HASH|STORY-SENTINEL|ownerId|token/);
  assert.equal((await mutate("POST", 1)).status, 409);
  assert.deepEqual(await (await mutate("POST", 2)).json(), pending);
  assert.equal((await get("/account")).headers.get("location"), page);
  assert.equal((await get(`/account?museumId=${id}`)).headers.get("location"), page);
  const pendingPage = await get(page);
  assert.equal(pendingPage.status, 200);
  assert.match(await pendingPage.text(), /确认取消删除/);
  // Retained/legacy membership fixture tests denial without relaxing the scheduling guard.
  db.prepare("UPDATE museum_memberships SET status='active' WHERE museum_id=?").run(id);
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,status,created_at,updated_at) VALUES (?,?,'revoked','original-created','original-updated')",
  ).run(id, users[2].id);
  const membership = db.prepare("SELECT * FROM museum_memberships WHERE museum_id=?").all(id);
  for (const cookie of [cookies[0], cookies[1], ""]) {
    assert.equal((await get(media, cookie)).status, 404);
    assert.equal((await get("/memories/memory", cookie)).status, 404);
    assert.equal((await get("/stages/stage", cookie)).status, 404);
  }
  for (const url of [
    api,
    page,
    `/account/museums/${id}`,
    `/api/photos?museumId=${id}`,
    `/api/stages?museumId=${id}`,
  ])
    assert.equal((await get(url, cookies[1])).status, 404, url);
  const memberAccount = await (await get("/account", cookies[1])).text();
  assert.doesNotMatch(memberAccount, /MUSEUM-owner/);
  const publicShelf = await (await get("/stages", "")).text();
  assert.doesNotMatch(publicShelf, /PUBLIC-STAGE/);
  assert.equal(statSync(photoPath).size, photoSize);
  const auditPage = await get(`/account/museums/${id}/audit`);
  assert.equal(auditPage.status, 200);
  assert.match(await auditPage.text(), /发起 30 天待删除/);
  assert.equal((await mutate("DELETE", 2, cookies[1])).status, 404);
  assert.equal((await mutate("DELETE", 2, cookies[0], "https://attacker.example")).status, 403);
  const cancelled = await mutate("DELETE", 2);
  assert.equal(cancelled.status, 200);
  const restored = await cancelled.json();
  assert.equal(restored.status, "active");
  assert.equal(restored.deletionScheduledAt, null);
  assert.equal(restored.version, 3);
  assert.deepEqual(
    db.prepare("SELECT * FROM museum_memberships WHERE museum_id=?").all(id),
    membership,
  );
  assert.equal((await get(`/account/museums/${id}`, cookies[1])).status, 200);
  assert.equal((await get(`/api/photos?museumId=${id}`, cookies[1])).status, 200);
  assert.equal((await get(`/api/stages?museumId=${id}`, cookies[1])).status, 200);
  assert.equal((await get(`/account/museums/${id}`, cookies[2])).status, 404);
  assert.equal((await get(api, cookies[1])).status, 403);
  assert.equal((await mutate("DELETE", 3, cookies[1])).status, 403);
  const restoredAudit = await get(`/account/museums/${id}/audit`);
  assert.equal(restoredAudit.status, 200);
  assert.match(await restoredAudit.text(), /取消待删除/);
  const restoredPage = await get(page);
  assert.equal(restoredPage.status, 200);
  const restoredHtml = await restoredPage.text();
  assert.match(restoredHtml, /暂不能发起待删除/);
  assert.doesNotMatch(restoredHtml, /确认取消删除/);
  assert.equal((await get(media, "")).status, 200);
  assert.equal((await get("/stages/stage", "")).status, 200);
  assert.equal((await get("/memories/memory", "")).status, 200);
  assert.equal(statSync(photoPath).size, photoSize);
  assert.equal(
    db.prepare("SELECT story FROM memories WHERE id='memory'").get().story,
    "STORY-SENTINEL",
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n, 3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM museums").get().n, 3);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action LIKE 'museum.deletion%'").get().n,
    2,
  );
  console.log(
    "J4/J5 HTTP checks passed: Owner-only lifecycle; same-origin; fresh collaborator guard; exact 30-day schedule; retries; pending redirects; collaborator/public Memory, Stage and photo denial; cancellation restores active collaborator access without reviving revoked members or granting Owner privileges; membership, accounts and physical assets preserved; cancellation audit and refreshed management page visible.",
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (server && server.exitCode === null)
    await new Promise((resolve) => {
      server.once("exit", resolve);
      server.kill();
    });
  db.close();
  // Exact disposable directory created above; never a repository or production data path.
  // Windows can briefly retain SQLite file handles after the server exits.
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
