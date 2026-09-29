// Local disposable fixtures only; no production credentials, data or external requests.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";

const directory = mkdtempSync(path.join(tmpdir(), "platform-admin-http-"));
const db = initializeDatabase(path.join(directory, "palace.sqlite"), false);
let server;
let output = "";
try {
  const [admin, owner] = ["admin", "owner"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "PRIVATE-HASH-SENTINEL",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const adminMuseum = createMuseumInDatabase(db, {
    ownerId: admin.id,
    name: "Admin museum",
    slug: "admin-museum",
  });
  const museum = createMuseumInDatabase(db, {
    ownerId: owner.id,
    name: "Metadata museum",
    slug: "metadata-museum",
    description: "PRIVATE-DESCRIPTION-SENTINEL",
  });
  db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,is_public,created_at,updated_at) VALUES ('private',?,'PRIVATE-TITLE-SENTINEL','PRIVATE-STORY-SENTINEL',0,'now','now')",
  ).run(museum.id);
  db.prepare(
    "INSERT INTO stages (id,museum_id,title,is_public,created_at,updated_at) VALUES ('private-stage',?,'PRIVATE-STAGE-SENTINEL',0,'now','now')",
  ).run(museum.id);
  const session = (user) => {
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    db.prepare(
      "INSERT INTO user_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,'now')",
    ).run(hash, user.id, new Date(Date.now() + 600_000).toISOString());
    return { cookie: `memory_palace_user=${token}`, hash };
  };
  const adminSession = session(admin);
  const ownerSession = session(owner);
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
        MEMORY_PALACE_SECURE_COOKIES: "false",
        MEMORY_PALACE_OWNER_PASSWORD: "",
        MEMORY_PALACE_SESSION_SECRET: "isolated-platform-admin-secret-at-least-32-characters",
        MEMORY_PALACE_PLATFORM_ADMIN_USER_ID: admin.id,
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
  const get = (endpoint, cookie, headers = {}) =>
    fetch(`${base}${endpoint}`, {
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers },
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null) throw new Error(`Local server stopped: ${output}`);
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
  const anonymous = await get("/admin");
  assert.equal(anonymous.status, 307);
  assert.match(anonymous.headers.get("location"), /\/account\/login$/);
  assert.equal((await get("/admin", ownerSession.cookie)).status, 404);
  const privateSentinels = /PRIVATE-(?:HASH|DESCRIPTION|TITLE|STORY|STAGE)-SENTINEL/;
  for (const headers of [{}, { RSC: "1" }]) {
    const response = headers.RSC
      ? await fetch(`${base}/admin`, {
          headers: { Cookie: adminSession.cookie, ...headers },
          redirect: "follow",
          signal: AbortSignal.timeout(60_000),
        })
      : await get("/admin", adminSession.cookie, headers);
    assert.equal(response.status, 200);
    assert.equal(new URL(response.url).origin, base);
    assert.equal(new URL(response.url).pathname, "/admin");
    if (headers.RSC) assert.match(response.headers.get("content-type"), /text\/x-component/);
    const body = await response.text();
    assert.match(body, /Metadata museum/);
    assert.match(body, /owner@example.com/);
    assert.doesNotMatch(body, privateSentinels);
  }
  assert.match(await (await get("/account", adminSession.cookie)).text(), /href="\/admin"/);
  assert.doesNotMatch(await (await get("/account", ownerSession.cookie)).text(), /href="\/admin"/);
  assert.equal((await get("/admin?usersPage=0", adminSession.cookie)).status, 404);
  assert.equal((await get("/admin?usersPage=1&usersPage=2", adminSession.cookie)).status, 404);
  assert.equal(
    (await get(`/api/memories/private?museumId=${museum.id}`, adminSession.cookie)).status,
    404,
  );
  assert.equal((await get(`/api/photos?museumId=${museum.id}`, adminSession.cookie)).status, 404);
  assert.equal(
    (await get(`/api/memories/private?museumId=${museum.id}`, ownerSession.cookie)).status,
    200,
  );
  const endpoint = `/api/admin/museums/${museum.id}/quota`;
  const patch = (body, cookie = adminSession.cookie, origin = base) =>
    fetch(`${base}${endpoint}`, {
      method: "PATCH",
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
        "Content-Type": "application/json",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  const adjustment = { storageQuotaBytes: 100, expectedQuotaBytes: 0 };
  assert.equal((await patch(adjustment, undefined, "https://other.example")).status, 403);
  assert.equal((await patch(adjustment, undefined, "")).status, 403);
  assert.equal((await patch(adjustment, "")).status, 401);
  assert.equal((await patch(adjustment, ownerSession.cookie)).status, 403);
  for (const body of [
    "{",
    { ...adjustment, storageQuotaBytes: -1 },
    { ...adjustment, storageQuotaBytes: "100" },
    { ...adjustment, storageQuotaBytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...adjustment, actorUserId: owner.id },
  ]) {
    assert.equal((await patch(body)).status, 400);
  }
  const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#aabbcc" } })
    .webp()
    .toBuffer();
  const upload = () => {
    const body = new FormData();
    body.append("photos", new Blob([data], { type: "image/webp" }), "optimized.webp");
    return fetch(`${base}/api/photos?museumId=${museum.id}`, {
      method: "POST",
      headers: { Cookie: ownerSession.cookie, Origin: base },
      body,
    });
  };
  assert.equal((await upload()).status, 507);
  const saved = await patch({ storageQuotaBytes: data.length, expectedQuotaBytes: 0 });
  assert.equal(saved.status, 200);
  assert.match(saved.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await saved.json(), { id: museum.id, storageQuotaBytes: data.length });
  assert.equal((await patch(adjustment)).status, 409);
  const firstUpload = await upload();
  assert.equal(firstUpload.status, 201, JSON.stringify(await firstUpload.clone().json()));
  const photo = (await firstUpload.json()).photos[0];
  assert.equal(
    statSync(path.join(directory, "images", photo.optimizedStorageKey)).size,
    data.length,
  );
  assert.equal((await upload()).status, 507);
  assert.equal((await get(`/media/${photo.optimizedStorageKey}`, adminSession.cookie)).status, 404);
  assert.equal((await get(`/media/${photo.optimizedStorageKey}`, ownerSession.cookie)).status, 200);
  assert.equal(
    (await patch({ storageQuotaBytes: data.length * 2, expectedQuotaBytes: data.length })).status,
    200,
  );
  assert.equal((await upload()).status, 201);
  assert.equal(
    (await patch({ storageQuotaBytes: 0, expectedQuotaBytes: data.length * 2 })).status,
    200,
  );
  assert.equal((await upload()).status, 507);
  assert.equal((await get(`/media/${photo.optimizedStorageKey}`, ownerSession.cookie)).status, 200);
  const row = db
    .prepare("SELECT storage_used_bytes,version FROM museums WHERE id=?")
    .get(museum.id);
  assert.equal(row.storage_used_bytes, data.length * 2);
  assert.equal(row.version, 1);
  assert.equal(
    db.prepare("SELECT storage_quota_bytes FROM museums WHERE id=?").get(adminMuseum.id)
      .storage_quota_bytes,
    0,
  );
  const audits = db
    .prepare(
      "SELECT actor_user_id,museum_id,diff FROM audit_logs WHERE action='admin.quota.update'",
    )
    .all();
  assert.equal(audits.length, 3);
  for (const audit of audits) {
    assert.equal(audit.actor_user_id, admin.id);
    assert.equal(audit.museum_id, museum.id);
    assert.deepEqual(Object.keys(JSON.parse(audit.diff)).sort(), [
      "afterQuotaBytes",
      "beforeQuotaBytes",
    ]);
  }
  db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(admin.id);
  assert.equal((await patch(adjustment)).status, 401);
  assert.equal((await get("/admin", adminSession.cookie)).status, 307);
  db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(admin.id);
  db.prepare("DELETE FROM user_sessions WHERE token_hash=?").run(adminSession.hash);
  assert.equal((await patch(adjustment)).status, 401);
  console.log(
    "Admin HTTP checks passed: anonymous redirect/401; non-admin 404/403; HTML/RSC metadata only; private content/media 404; origin 403; invalid quota 400; stale 409; audit preserved; quota changes immediately affect uploads (507→201→507); zero retains existing photos; revoked verification/session denied.",
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
  // The sole removal target is the fresh, explicit fixture directory returned by mkdtempSync.
  rmSync(directory, { recursive: true, force: true });
}
