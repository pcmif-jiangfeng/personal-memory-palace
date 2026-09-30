// Production HTTP with synthetic Users/Museums; real email delivery is explicitly disabled.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { createOwnInviteInDatabase } from "../src/data/invite-management.ts";
import { deliverMuseumNotifications } from "../src/email/museum-notifications.ts";
import { queueDueMuseumDeletionReminders } from "../src/data/museum-deletion-notifications.ts";

const directory = mkdtempSync(path.join(tmpdir(), "museum-notifications-http-"));
const db = initializeDatabase(path.join(directory, "palace.sqlite"), false);
let server;
let output = "";
try {
  const users = ["owner", "member", "outsider"].map((name) =>
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
    }),
  );
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
  const invite = createOwnInviteInDatabase(db, users[0].id, {
    useMode: "multi-use",
    maxUses: null,
    expiresAt: null,
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
        MEMORY_PALACE_SESSION_SECRET: "isolated-notifications-secret-at-least-32-characters",
        RESEND_API_KEY: "",
        MEMORY_PALACE_EMAIL_FROM: "",
      },
    },
  );
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      output = (output + chunk).slice(-3000);
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
  const mutate = (url, body, actor = 0, method = "POST", origin = base) =>
    fetch(`${base}${url}`, {
      method,
      headers: {
        Cookie: actor === null ? "" : cookies[actor],
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  const join = () => mutate("/api/invites/accept", { token: invite.token }, 1);
  assert.equal((await mutate("/api/invites/accept", { token: invite.token }, null)).status, 401);
  assert.equal(
    (
      await mutate(
        "/api/invites/accept",
        { token: invite.token },
        1,
        "POST",
        "https://attacker.example",
      )
    ).status,
    403,
  );
  assert.equal((await join()).status, 200);
  assert.equal((await join()).status, 200);
  const museumId = museums[0].id;
  assert.equal((await mutate(`/api/museums/${museumId}/leave`, { confirm: true }, 1)).status, 200);
  assert.equal((await mutate(`/api/museums/${museumId}/leave`, { confirm: true }, 1)).status, 200);
  assert.equal((await join()).status, 200);
  const removeUrl = `/api/museums/${museumId}/collaborators/${users[1].id}`;
  assert.equal((await mutate(removeUrl, { confirm: true }, 2, "DELETE")).status, 404);
  assert.equal((await mutate(removeUrl, { confirm: true }, 0, "DELETE")).status, 200);
  assert.equal((await mutate(removeUrl, { confirm: true }, 0, "DELETE")).status, 200);
  assert.equal((await join()).status, 200);
  assert.equal(
    (
      await mutate(`/api/museums/${museumId}/transfer`, {
        confirm: true,
        version: 1,
        targetUserId: users[1].id,
        oldOwnerDisposition: "leave",
      })
    ).status,
    200,
  );
  const counts = db
    .prepare("SELECT kind,COUNT(*) n FROM museum_notifications GROUP BY kind ORDER BY kind")
    .all();
  assert.deepEqual(
    counts.map((row) => [row.kind, row.n]),
    [
      ["collaboration.join", 6],
      ["collaboration.leave", 2],
      ["collaboration.ownerTransfer", 2],
      ["collaboration.removed", 2],
    ],
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM museum_notifications WHERE status='pending'").get().n,
    12,
  );
  let delivered = 0;
  const result = await deliverMuseumNotifications(db, {
    configuration: { apiKey: "fixture-key", from: "test@example.com" },
    fetcher: async () => {
      delivered++;
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(result.sent, 12);
  assert.equal(delivered, 12);
  assert.doesNotMatch(output, /TypeError|Unhandled|deferred/);
  console.log(
    "PASS K3 production HTTP: auth/origin, join/leave/remove/transfer, retry deduplication, durable pending and mock delivery",
  );
  const deletionUrl = `/api/museums/${museumId}/deletion`;
  const scheduled = await mutate(deletionUrl, { confirm: true, version: 2 }, 1);
  assert.equal(scheduled.status, 200, await scheduled.clone().text());
  const pending = await scheduled.json();
  assert.equal((await mutate(deletionUrl, { confirm: true, version: 3 }, 1)).status, 200);
  const remindAt = new Date(Date.parse(pending.deletionScheduledAt) - 86400000);
  assert.equal(queueDueMuseumDeletionReminders(db, remindAt).queuedMuseums, 1);
  assert.equal(queueDueMuseumDeletionReminders(db, remindAt).queuedMuseums, 0);
  const mockOptions = {
    configuration: { apiKey: "fixture-key", from: "test@example.com" },
    fetcher: async () => new Response("{}", { status: 200 }),
  };
  assert.equal((await deliverMuseumNotifications(db, mockOptions)).sent, 2);
  assert.equal((await mutate(deletionUrl, { confirm: true, version: 3 }, 1, "DELETE")).status, 200);
  assert.equal((await deliverMuseumNotifications(db, mockOptions)).sent, 1);
  assert.equal(db.prepare("SELECT status FROM museums WHERE id=?").get(museumId).status, "active");
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM museum_notifications WHERE kind LIKE 'deletion.%' AND status='sent'",
      )
      .get().n,
    3,
  );
  console.log(
    "PASS K4 production HTTP: initiated/cancelled notifications, bounded once-per-cycle reminder, mock delivery; no deletion",
  );
  db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,is_public,visibility,created_at,updated_at) VALUES ('support-private',?,'SUPPORT-PRIVATE-TITLE','SUPPORT-PRIVATE-STORY',0,'private','now','now')",
  ).run(museumId);
  const supportUrl = `/api/admin/museums/${museumId}/support-read`;
  const grantUrl = `/api/museums/${museumId}/support-access`;
  const requestBody = { memoryId: "support-private", grantId: "missing" };
  assert.equal((await mutate(supportUrl, requestBody, null)).status, 401);
  assert.equal((await mutate(supportUrl, requestBody, 1)).status, 403);
  assert.equal((await mutate(supportUrl, requestBody, 2)).status, 403);
  assert.equal(
    (await mutate(supportUrl, requestBody, 2, "POST", "https://attacker.example")).status,
    403,
  );
  assert.equal(
    (await mutate(grantUrl, { memoryId: "support-private", confirm: true }, 2)).status,
    404,
  );
  assert.equal(
    (
      await mutate(
        grantUrl,
        { memoryId: "support-private", confirm: true, purpose: "fault_handling" },
        1,
      )
    ).status,
    400,
  );
  const granted = await mutate(grantUrl, { memoryId: "support-private", confirm: true }, 1);
  assert.equal(granted.status, 201, await granted.clone().text());
  const permit = await granted.json();
  const allowed = await mutate(
    supportUrl,
    { memoryId: "support-private", grantId: permit.grantId },
    2,
  );
  assert.equal(allowed.status, 200, await allowed.clone().text());
  assert.match(allowed.headers.get("cache-control"), /private, no-store/);
  assert.equal((await allowed.json()).story, "SUPPORT-PRIVATE-STORY");
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='support.privateRead'").get().n,
    1,
  );
  assert.equal(
    (
      await fetch(`${base}/memories/support-private?museumId=${museumId}`, {
        headers: { Cookie: cookies[2] },
      })
    ).status,
    404,
  );
  const dashboard = await fetch(`${base}/admin`, { headers: { Cookie: cookies[2] } });
  assert.equal(dashboard.status, 200);
  assert.doesNotMatch(await dashboard.text(), /SUPPORT-PRIVATE-STORY|SUPPORT-PRIVATE-TITLE/);
  db.exec(
    "CREATE TRIGGER block_private_audit BEFORE INSERT ON audit_logs WHEN NEW.action='support.privateRead' BEGIN SELECT RAISE(ABORT,'support audit failure'); END",
  );
  const blocked = await mutate(
    supportUrl,
    { memoryId: "support-private", grantId: permit.grantId },
    2,
  );
  assert.equal(blocked.status, 500);
  assert.doesNotMatch(await blocked.text(), /SUPPORT-PRIVATE-STORY/);
  db.exec("DROP TRIGGER block_private_audit");
  assert.equal(
    (await mutate(grantUrl, { grantId: permit.grantId, confirm: true }, 1, "DELETE")).status,
    200,
  );
  assert.equal(
    (await mutate(supportUrl, { memoryId: "support-private", grantId: permit.grantId }, 2)).status,
    403,
  );
  const incidentPermit = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/grant-support-access.ts",
        museumId,
        "support-private",
        "fault_handling",
        "INC-123",
        "--confirm",
      ],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        windowsHide: true,
        encoding: "utf8",
        env: {
          ...process.env,
          MEMORY_PALACE_DATA_DIR: directory,
          MEMORY_PALACE_DATASET: "owner",
          MEMORY_PALACE_PLATFORM_ADMIN_USER_ID: users[2].id,
        },
      },
    ),
  );
  assert.equal(
    (await mutate(supportUrl, { memoryId: "support-private", grantId: incidentPermit.grantId }, 2))
      .status,
    200,
  );
  console.log(
    "PASS K5 production HTTP: default deny, scoped Owner grant, private/no-store, audited read, fail-closed audit, revoke; normal content/dashboard unchanged",
  );
} finally {
  if (server && server.exitCode === null)
    await new Promise((resolve) => {
      server.once("exit", resolve);
      server.kill();
    });
  db.close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
