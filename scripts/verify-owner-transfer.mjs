// Isolated local HTTP fixtures only; never connects to the production website.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";

const directory = mkdtempSync(path.join(tmpdir(), "owner-transfer-http-"));
const db = initializeDatabase(path.join(directory, "palace.sqlite"), false);
let server;
let output = "";
try {
  const users = ["owner", "target", "other"].map((name) =>
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
      name: `TRANSFER-MUSEUM-${user.displayName}`,
      slug: user.displayName,
    }),
  );
  const museumId = museums[0].id;
  for (const user of users.slice(1))
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'before','before')",
    ).run(museumId, user.id);
  db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,is_public,created_at,updated_at) VALUES ('private',?,'PRIVATE-TITLE-SENTINEL','PRIVATE-STORY-SENTINEL',0,'now','now')",
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
        MEMORY_PALACE_SESSION_SECRET: "isolated-transfer-secret-at-least-32-characters",
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
  const mutate = (url, body, cookie = cookies[0], origin = base, method = "POST") =>
    fetch(`${base}${url}`, {
      method,
      headers: {
        Cookie: cookie,
        ...(origin ? { Origin: origin } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  const transferUrl = `/api/museums/${museumId}/transfer`;
  const pageUrl = `/account/museums/${museumId}/transfer`;
  const body = {
    confirm: true,
    targetUserId: users[1].id,
    oldOwnerDisposition: "stay",
    version: 1,
  };
  const page = await get(pageUrl);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /target@example.com/);
  assert.match(html, /下一步：核对转移/);
  assert.ok(html.includes(`href="/workspace?museumId=${museumId}"`));
  assert.doesNotMatch(html, /SECRET-HASH-SENTINEL|PRIVATE-(?:TITLE|STORY)-SENTINEL/);
  assert.equal((await get(pageUrl, cookies[1])).status, 404);
  assert.equal((await get(pageUrl, cookies[2])).status, 404);
  assert.equal((await get(pageUrl, "")).status, 307);
  for (const cookie of [cookies[1], cookies[2]])
    assert.equal((await mutate(transferUrl, body, cookie)).status, 403);
  assert.equal((await mutate(transferUrl, body, "")).status, 401);
  for (const origin of [null, "https://attacker.example"])
    assert.equal((await mutate(transferUrl, body, cookies[0], origin)).status, 403);
  for (const invalid of [
    { ...body, confirm: false },
    { ...body, actorUserId: users[0].id },
    { ...body, oldOwnerDisposition: "invalid" },
  ])
    assert.equal((await mutate(transferUrl, invalid)).status, 400);
  assert.equal((await mutate(transferUrl, { ...body, version: 2 })).status, 409);
  const result = await mutate(transferUrl, body);
  assert.equal(result.status, 200);
  assert.match(result.headers.get("cache-control"), /no-store/);
  assert.equal((await result.json()).ownerId, users[1].id);
  assert.equal((await mutate(transferUrl, body)).status, 403);
  assert.equal((await get(pageUrl)).status, 404);
  assert.equal((await get(`/account/museums/${museumId}`)).status, 200);
  assert.equal((await get(`/api/memories/private?museumId=${museumId}`)).status, 200);
  assert.equal((await get(`/account?museumId=${museumId}`)).status, 404);
  assert.equal((await get(`/account/invites?museumId=${museumId}`)).status, 404);
  const profileUrl = `/api/museums?museumId=${museumId}`;
  assert.equal(
    (await mutate(profileUrl, { slug: "hijacked" }, cookies[0], base, "PATCH")).status,
    403,
  );
  const targetPage = await get(`/account?museumId=${museumId}`, cookies[1]);
  assert.equal(targetPage.status, 200);
  assert.match(await targetPage.text(), /TRANSFER-MUSEUM-owner/);
  const ownedPage = await get(`/account?museumId=${museums[1].id}`, cookies[1]);
  assert.equal(ownedPage.status, 200);
  assert.match(await ownedPage.text(), /TRANSFER-MUSEUM-target/);
  const joinedRedirect = await get(`/account/museums/${museumId}`, cookies[1]);
  assert.equal(joinedRedirect.status, 307);
  assert.equal(joinedRedirect.headers.get("location"), `/account?museumId=${museumId}`);
  assert.equal(
    (await get(`/account?museumId=${museumId}&museumId=${museums[1].id}`, cookies[1])).status,
    404,
  );
  assert.equal(
    (await mutate("/api/museums", { slug: "ambiguous" }, cookies[1], base, "PATCH")).status,
    409,
  );
  assert.equal(
    (await mutate(profileUrl, { slug: "transferred" }, cookies[1], base, "PATCH")).status,
    200,
  );
  assert.equal(db.prepare("SELECT slug FROM museums WHERE id=?").get(museums[1].id).slug, "target");
  const inviteBody = { useMode: "single-use", maxUses: 1, expiresAt: null };
  assert.equal(
    (await mutate(`/api/invites?museumId=${museumId}`, inviteBody, cookies[0])).status,
    403,
  );
  const created = await mutate(`/api/invites?museumId=${museumId}`, inviteBody, cookies[1]);
  assert.equal(created.status, 201);
  assert.equal(
    (await (await get(`/api/invites?museumId=${museumId}`, cookies[1])).json()).total,
    1,
  );
  assert.equal(
    (await (await get(`/api/invites?museumId=${museums[1].id}`, cookies[1])).json()).total,
    0,
  );
  assert.match(
    await (await get(`/account/museums/${museumId}/audit`, cookies[1])).text(),
    /转移馆长身份/,
  );
  assert.equal((await get(`/account/museums/${museumId}/audit`, cookies[0])).status, 404);
  // A second transfer covers the leave branch using the recipient's original Museum.
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museums[1].id, users[2].id);
  const left = await mutate(
    `/api/museums/${museums[1].id}/transfer`,
    { ...body, targetUserId: users[2].id, oldOwnerDisposition: "leave" },
    cookies[1],
  );
  assert.equal(left.status, 200);
  assert.equal((await get(`/api/photos?museumId=${museums[1].id}`, cookies[1])).status, 404);
  assert.equal((await get(`/account/museums/${museums[1].id}`, cookies[1])).status, 404);
  assert.equal((await get(`/account?museumId=${museumId}`, cookies[1])).status, 200);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='museum.ownerTransfer'").get().n,
    2,
  );
  assert.equal(
    db.prepare("SELECT story FROM memories WHERE id='private'").get().story,
    "PRIVATE-STORY-SENTINEL",
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  console.log(
    "J2 HTTP checks passed: two-step Owner-only page; session/origin/confirmation/version guards; atomic transfer; multi-owned settings/invites bound; former Owner stay/leave; stale privileges denied; content and recipient Museum preserved.",
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
  // Exact freshly created fixture only; never removes a repository or production directory.
  rmSync(directory, { recursive: true, force: true });
}
