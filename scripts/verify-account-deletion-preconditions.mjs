// Disposable local fixture only. No production connection or deletion operation.
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

const directory = mkdtempSync(path.join(tmpdir(), "deletion-preconditions-http-"));
const db = initializeDatabase(path.join(directory, "palace.sqlite"), false);
let server;
let output = "";
try {
  const users = ["owner", "target", "empty"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "PRIVATE-HASH-SENTINEL",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const first = createMuseumInDatabase(db, {
    ownerId: users[0].id,
    name: "OWNER-FIRST",
    slug: "first",
  });
  const targetOwn = createMuseumInDatabase(db, {
    ownerId: users[1].id,
    name: "TARGET-PRIVATE-MUSEUM",
    slug: "target",
  });
  const second = createMuseumInDatabase(db, {
    ownerId: users[0].id,
    name: "OWNER-SECOND",
    slug: "second",
  });
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(second.id, users[1].id);
  db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES ('private',?,'PRIVATE-TITLE-SENTINEL','PRIVATE-STORY-SENTINEL','now','now')",
  ).run(first.id);
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
  const tables = [
    "users",
    "museums",
    "museum_memberships",
    "memories",
    "audit_logs",
    "user_sessions",
    "schema_migrations",
  ];
  const snapshot = () =>
    tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const initial = snapshot();
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
        MEMORY_PALACE_SESSION_SECRET: "isolated-j3-http-secret-at-least-32-characters",
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
  const api = "/api/account/deletion-preconditions";
  const get = (url, cookie = cookies[0]) =>
    fetch(`${base}${url}`, {
      headers: { Cookie: cookie },
      redirect: "manual",
      signal: AbortSignal.timeout(60000),
    });
  const read = async (cookie = cookies[0], query = "") => {
    const response = await get(`${api}${query}`, cookie);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    const result = await response.json();
    assert.doesNotMatch(
      JSON.stringify(result),
      /PRIVATE-(?:HASH|TITLE|STORY)-SENTINEL|token_hash|password_hash/,
    );
    return result;
  };
  assert.equal((await get(api, "")).status, 401);
  assert.equal((await get("/account/deletion", "")).status, 307);
  const owner = await read();
  assert.equal(owner.canEnterDeletionFlow, false);
  assert.equal(owner.reason, "TRANSFER_OWNERSHIP_REQUIRED");
  assert.equal(owner.ownedMuseumCount, 2);
  assert.equal(owner.blockedMuseumCount, 1);
  assert.equal(
    owner.museums.some((m) => m.id === targetOwn.id),
    false,
  );
  const secondPage = await read(cookies[0], "?page=2");
  assert.deepEqual(secondPage.museums, []);
  assert.equal(secondPage.canEnterDeletionFlow, false);
  const html = await (await get("/account/deletion")).text();
  assert.match(html, /必须先转移对应馆长身份/);
  assert.match(html, /本次不会发起待删除/);
  assert.ok(html.includes(`/account/museums/${second.id}/transfer`));
  assert.doesNotMatch(html, /TARGET-PRIVATE-MUSEUM|PRIVATE-(?:HASH|TITLE|STORY)-SENTINEL/);
  assert.match(await (await get(`/account?museumId=${first.id}`)).text(), /检查账号删除条件/);
  const target = await read(cookies[1]);
  assert.equal(target.canEnterDeletionFlow, true);
  assert.equal(target.ownedMuseumCount, 1);
  assert.equal(target.museums[0].id, targetOwn.id);
  const empty = await read(cookies[2]);
  assert.equal(empty.canEnterDeletionFlow, true);
  assert.equal(empty.ownedMuseumCount, 0);
  assert.match(await (await get("/account/onboarding", cookies[2])).text(), /检查账号删除条件/);
  for (const query of [
    "?page=0",
    "?page=1&page=2",
    `?userId=${users[1].id}`,
    `?museumId=${first.id}`,
  ]) {
    assert.equal((await get(`${api}${query}`)).status, 400);
    assert.equal((await get(`/account/deletion${query}`)).status, 404);
  }
  for (const method of ["POST", "DELETE", "PATCH"])
    assert.equal(
      (
        await fetch(`${base}${api}`, {
          method,
          headers: { Cookie: cookies[0], Origin: base, "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      405,
    );
  assert.deepEqual(snapshot(), initial);
  const transferred = await fetch(`${base}/api/museums/${second.id}/transfer`, {
    method: "POST",
    headers: { Cookie: cookies[0], Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({
      confirm: true,
      targetUserId: users[1].id,
      oldOwnerDisposition: "stay",
      version: 1,
    }),
  });
  assert.equal(transferred.status, 200);
  const afterTransfer = snapshot();
  const oldOwner = await read();
  assert.equal(oldOwner.canEnterDeletionFlow, true);
  assert.equal(oldOwner.ownedMuseumCount, 1);
  const newOwner = await read(cookies[1]);
  assert.equal(newOwner.canEnterDeletionFlow, false);
  assert.equal(newOwner.ownedMuseumCount, 2);
  assert.match(await (await get("/account/deletion")).text(), /前置检查通过/);
  assert.deepEqual(snapshot(), afterTransfer);
  assert.equal(
    db.prepare("SELECT story FROM memories WHERE id='private'").get().story,
    "PRIVATE-STORY-SENTINEL",
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM museums").get().n, 3);
  console.log(
    "J3 HTTP checks passed: authenticated account-only full-ownership guard; safe pagination; zero-owned and joined-only cases; strict query; POST/DELETE/PATCH 405; current transfer result reflected; no deletion, scheduling or precheck data writes.",
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
  // Exact new fixture directory only, not a repository or production path.
  rmSync(directory, { recursive: true, force: true });
}
