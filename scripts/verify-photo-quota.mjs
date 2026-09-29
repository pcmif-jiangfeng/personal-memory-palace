// All data, credentials and HTTP traffic are local disposable fixtures; never targets production.
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

const directory = mkdtempSync(path.join(tmpdir(), "museum-quota-http-"));
const db = initializeDatabase(path.join(directory, "palace.sqlite"), false);
let server;
let output = "";
try {
  const user = createUserInDatabase(db, {
    email: "quota@example.com",
    displayName: "Quota test",
    passwordHash: "synthetic-unused-hash",
  });
  db.exec("UPDATE users SET email_verified=1");
  const museum = createMuseumInDatabase(db, {
    ownerId: user.id,
    name: "Quota test",
    slug: "quota-test",
  });
  db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES ('memory',?,'Before','Story','now','now')",
  ).run(museum.id);
  db.prepare(
    "INSERT INTO stages (id,museum_id,title,created_at,updated_at) VALUES ('stage',?,'Before','now','now')",
  ).run(museum.id);
  const token = randomBytes(32).toString("base64url");
  db.prepare(
    "INSERT INTO user_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,'now')",
  ).run(
    createHash("sha256").update(token).digest("hex"),
    user.id,
    new Date(Date.now() + 600_000).toISOString(),
  );
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
        MEMORY_PALACE_SESSION_SECRET: "isolated-quota-verification-secret-at-least-32-characters",
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
  const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#aabbcc" } })
    .webp()
    .toBuffer();
  const headers = { Cookie: `memory_palace_user=${token}`, Origin: base };
  const upload = async (authenticated = true) => {
    const body = new FormData();
    body.append("photos", new Blob([data], { type: "image/webp" }), "optimized.webp");
    return fetch(`${base}/api/photos?museumId=${museum.id}`, {
      method: "POST",
      headers: authenticated ? headers : { Origin: base },
      body,
    });
  };
  assert.equal((await upload(false)).status, 401);
  db.prepare("UPDATE museums SET storage_usage_ready=0,storage_quota_bytes=? WHERE id=?").run(
    data.length,
    museum.id,
  );
  const notReady = await upload();
  assert.equal(notReady.status, 503);
  assert.equal((await notReady.json()).error, "STORAGE_USAGE_NOT_READY");
  db.prepare("UPDATE museums SET storage_usage_ready=1,storage_quota_bytes=0 WHERE id=?").run(
    museum.id,
  );
  const zero = await upload();
  assert.equal(zero.status, 507);
  assert.equal((await zero.json()).details.storageQuotaBytes, 0);
  db.prepare("UPDATE museums SET storage_quota_bytes=? WHERE id=?").run(data.length, museum.id);
  const first = await upload();
  assert.equal(first.status, 201, JSON.stringify(await first.clone().json()));
  const photo = (await first.json()).photos[0];
  assert.equal(
    statSync(path.join(directory, "images", photo.optimizedStorageKey)).size,
    data.length,
  );
  const blocked = await upload();
  assert.equal(blocked.status, 507);
  assert.deepEqual(await blocked.json(), {
    error: "STORAGE_QUOTA_EXCEEDED",
    details: {
      storageUsedBytes: data.length,
      storageQuotaBytes: data.length,
      reservedBytes: 0,
      newCompressedBytes: data.length,
    },
  });
  const writeJson = (endpoint, method, body) =>
    fetch(`${base}${endpoint}?museumId=${museum.id}`, {
      method,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await writeJson("/api/memories/memory", "POST", {
        action: "details",
        version: 1,
        title: "After",
        story: "Edited",
        stageId: null,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await writeJson("/api/stages/stage", "PUT", {
        title: "Edited stage",
        description: "Still editable",
        version: 1,
      })
    ).status,
    200,
  );
  const deleted = await fetch(`${base}/api/photos/${photo.id}?museumId=${museum.id}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deleted.status, 200);
  assert.equal(
    db.prepare("SELECT storage_used_bytes FROM museums WHERE id=?").get(museum.id)
      .storage_used_bytes,
    0,
  );
  assert.equal((await upload()).status, 201);
  console.log(
    "Quota HTTP checks passed: anonymous=401; not-ready=503; zero/full=507; exact limit=201; text/Stage edits=200; deletion releases capacity; retry=201.",
  );
} finally {
  if (server && server.exitCode === null) {
    await new Promise((resolve) => {
      server.once("exit", resolve);
      server.kill();
    });
  }
  db.close();
  rmSync(directory, { recursive: true, force: true });
}
