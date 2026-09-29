// Disposable local fixtures only. Never runs against an external website or production data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import sharp from "sharp";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";

const directory = mkdtempSync(path.join(tmpdir(), "collaborator-removal-http-"));
const db = initializeDatabase(path.join(directory, "palace.sqlite"), false);
let server;
let output = "";
try {
  const users = ["owner", "member", "other"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "SECRET-HASH-SENTINEL",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const museums = users.map((user) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      name: `REMOVAL-MUSEUM-${user.displayName}`,
      slug: user.displayName,
      storageQuotaBytes: 1000000,
    }),
  );
  for (const user of users.slice(1))
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'original','original')",
    ).run(museums[0].id, user.id);
  const museumId = museums[0].id;
  db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,is_public,created_at,updated_at) VALUES ('private',?,'PRIVATE-TITLE-SENTINEL','PRIVATE-STORY-SENTINEL',0,'now','now')",
  ).run(museumId);
  db.prepare(
    "INSERT INTO stages (id,museum_id,title,is_public,created_at,updated_at) VALUES ('stage',?,'PRIVATE-STAGE-SENTINEL',0,'now','now')",
  ).run(museumId);
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
        MEMORY_PALACE_SESSION_SECRET: "isolated-removal-http-secret-at-least-32-characters",
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
  const get = (url, cookie = cookies[1]) =>
    fetch(`${base}${url}`, {
      headers: { Cookie: cookie },
      redirect: "manual",
      signal: AbortSignal.timeout(60000),
    });
  const remove = (
    target = users[1].id,
    cookie = cookies[0],
    body = { confirm: true },
    origin = base,
  ) =>
    fetch(`${base}/api/museums/${museumId}/collaborators/${target}`, {
      method: "DELETE",
      headers: {
        Cookie: cookie,
        ...(origin ? { Origin: origin } : {}),
        "Content-Type": "application/json",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  const ownerPage = `/account/museums/${museumId}/collaborators`;
  const list = await get(ownerPage, cookies[0]);
  assert.equal(list.status, 200);
  const listBody = await list.text();
  assert.match(listBody, /member@example.com/);
  assert.match(listBody, /other@example.com/);
  assert.doesNotMatch(listBody, /SECRET-HASH-SENTINEL|PRIVATE-(?:TITLE|STORY|STAGE)-SENTINEL/);
  assert.equal((await get(ownerPage)).status, 404);
  assert.equal((await get(ownerPage, cookies[2])).status, 404);
  assert.equal((await get(ownerPage, "")).status, 307);
  assert.equal((await get(`${ownerPage}?page=0`, cookies[0])).status, 404);
  assert.equal((await get(`/account/museums/${museumId}`)).status, 200);
  assert.match(await (await get("/account")).text(), /REMOVAL-MUSEUM-owner/);
  const memoryUrl = `/api/memories/private?museumId=${museumId}`;
  assert.equal((await get(memoryUrl)).status, 200);
  const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#aabbcc" } })
    .webp()
    .toBuffer();
  const upload = () => {
    const body = new FormData();
    body.append("photos", new Blob([data], { type: "image/webp" }), "member.webp");
    return fetch(`${base}/api/photos?museumId=${museumId}`, {
      method: "POST",
      headers: { Cookie: cookies[1], Origin: base },
      body,
    });
  };
  const uploaded = await upload();
  assert.equal(uploaded.status, 201);
  const photo = (await uploaded.json()).photos[0];
  assert.equal((await get(`/media/${photo.optimizedStorageKey}`)).status, 200);
  assert.equal((await remove(users[1].id, "")).status, 401);
  assert.equal((await remove(users[1].id, cookies[1])).status, 403);
  assert.equal((await remove(users[1].id, cookies[2])).status, 403);
  assert.equal((await remove(users[0].id)).status, 403);
  assert.equal((await remove("unknown")).status, 404);
  assert.equal(
    (await remove(users[1].id, cookies[0], { confirm: true }, "https://other.example")).status,
    403,
  );
  assert.equal((await remove(users[1].id, cookies[0], { confirm: true }, "")).status, 403);
  for (const body of [
    {},
    { confirm: false },
    { confirm: "true" },
    { confirm: true, actorUserId: users[2].id },
    "{",
  ]) {
    assert.equal((await remove(users[1].id, cookies[0], body)).status, 400);
  }
  const saved = await remove();
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ok: true });
  assert.match(saved.headers.get("cache-control"), /no-store/);
  assert.equal((await remove()).status, 200);
  for (const url of [
    memoryUrl,
    `/api/photos?museumId=${museumId}`,
    `/account/museums/${museumId}`,
    `/media/${photo.optimizedStorageKey}`,
  ]) {
    assert.equal((await get(url)).status, 404, url);
  }
  assert.doesNotMatch(await (await get("/account")).text(), /REMOVAL-MUSEUM-owner/);
  const edit = await fetch(`${base}${memoryUrl}`, {
    method: "POST",
    headers: { Cookie: cookies[1], Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "details",
      version: 1,
      title: "Edited",
      story: "Edited",
      stageId: null,
    }),
  });
  assert.equal(edit.status, 404);
  assert.equal((await upload()).status, 404);
  assert.equal((await get(memoryUrl, cookies[2])).status, 200);
  assert.equal((await get(`/media/${photo.optimizedStorageKey}`, cookies[0])).status, 200);
  assert.equal((await get(`/api/photos?museumId=${museums[1].id}`)).status, 200);
  const refreshed = await (await get(ownerPage, cookies[0])).text();
  assert.doesNotMatch(refreshed, /member@example.com/);
  assert.match(refreshed, /other@example.com/);
  assert.match(
    await (await get(`/account/museums/${museumId}/audit`, cookies[0])).text(),
    /馆长移除协作者/,
  );
  const audit = db.prepare("SELECT * FROM audit_logs WHERE action='membership.remove'").all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_user_id, users[0].id);
  assert.equal(audit[0].object_id, users[1].id);
  assert.equal(
    db.prepare("SELECT story FROM memories WHERE id='private'").get().story,
    "PRIVATE-STORY-SENTINEL",
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM uploaded_photos").get().n, 1);
  console.log(
    "J1 HTTP checks passed: owner-only list/removal; configured platform admin cannot remove; confirmation/origin required; membership revoke + one audit; retry safe; old page/read/write/upload/media denied; refreshed switcher excludes Museum; own Museum/other collaborator/data unchanged.",
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
  // Only removes this freshly created explicit fixture directory.
  rmSync(directory, { recursive: true, force: true });
}
