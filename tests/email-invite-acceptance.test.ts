import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import {
  createEmailInviteInDatabase,
  revokeEmailInviteInDatabase,
} from "../src/data/email-invites.ts";
import { acceptEmailInviteInDatabase } from "../src/data/email-invite-acceptance.ts";

function fixture(databasePath = ":memory:") {
  const db = initializeDatabase(databasePath, false);
  const owner = createUserInDatabase(db, {
    email: "owner@example.com",
    displayName: "馆长",
    passwordHash: "hash",
  });
  const other = createUserInDatabase(db, {
    email: "other@example.com",
    displayName: "其他账号",
    passwordHash: "hash",
  });
  db.exec("UPDATE users SET email_verified=1");
  const museum = createMuseumInDatabase(db, {
    ownerId: owner.id,
    name: "共同宫殿",
    slug: "together",
    museumType: "shared",
  });
  const invitation = createEmailInviteInDatabase(
    db,
    owner.id,
    museum.id,
    "target@example.com",
  ).invite;
  const target = createUserInDatabase(db, {
    email: "target@example.com",
    displayName: "受邀人",
    passwordHash: "hash",
  });
  return { db, owner, other, museum, invitation, target };
}

test("only the verified target can actively accept an invitation issued before registration", () => {
  const { db, other, museum, invitation, target } = fixture();
  try {
    assert.throws(() => acceptEmailInviteInDatabase(db, null, invitation.id), /USER_REQUIRED/);
    assert.throws(
      () => acceptEmailInviteInDatabase(db, other.id, invitation.id),
      /INVITE_NOT_FOUND/,
    );
    assert.throws(
      () => acceptEmailInviteInDatabase(db, target.id, invitation.id),
      /EMAIL_VERIFICATION_REQUIRED/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM museum_memberships").get()?.n, 0);
    db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(target.id);
    const accepted = acceptEmailInviteInDatabase(db, target.id, invitation.id);
    assert.equal(accepted.museum.id, museum.id);
    assert.equal(accepted.alreadyMember, false);
    assert.equal(
      db.prepare("SELECT status FROM collaboration_invites WHERE id=?").get(invitation.id)?.status,
      "accepted",
    );
    assert.equal(
      db
        .prepare("SELECT status FROM museum_memberships WHERE museum_id=? AND user_id=?")
        .get(museum.id, target.id)?.status,
      "active",
    );
    assert.equal(acceptEmailInviteInDatabase(db, target.id, invitation.id).alreadyMember, true);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='membership.join'").get()?.n,
      1,
    );
  } finally {
    db.close();
  }
});

test("a consumed invitation cannot restore a revoked member; a fresh invitation can", () => {
  const { db, owner, museum, invitation, target } = fixture();
  try {
    db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(target.id);
    acceptEmailInviteInDatabase(db, target.id, invitation.id);
    db.prepare(
      "UPDATE museum_memberships SET status='revoked' WHERE museum_id=? AND user_id=?",
    ).run(museum.id, target.id);
    assert.throws(
      () => acceptEmailInviteInDatabase(db, target.id, invitation.id),
      /INVITE_UNAVAILABLE/,
    );
    const fresh = createEmailInviteInDatabase(db, owner.id, museum.id, target.email).invite;
    assert.notEqual(fresh.id, invitation.id);
    acceptEmailInviteInDatabase(db, target.id, fresh.id);
    assert.equal(
      db
        .prepare("SELECT status FROM museum_memberships WHERE museum_id=? AND user_id=?")
        .get(museum.id, target.id)?.status,
      "active",
    );
  } finally {
    db.close();
  }
});

test("expiry at the exact deadline and pending deletion prevent acceptance without changing grants", (t) => {
  const { db, museum, invitation, target } = fixture();
  try {
    db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(target.id);
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse(invitation.expiresAt) });
    assert.throws(
      () => acceptEmailInviteInDatabase(db, target.id, invitation.id),
      /INVITE_UNAVAILABLE/,
    );
    t.mock.timers.reset();
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(museum.id);
    assert.throws(
      () => acceptEmailInviteInDatabase(db, target.id, invitation.id),
      /INVITE_UNAVAILABLE/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM museum_memberships").get()?.n, 0);
  } finally {
    db.close();
  }
});

test("first successful revoke or acceptance wins, and legacy bearer strings never grant joining", () => {
  for (const revokeFirst of [true, false]) {
    const { db, owner, museum, invitation, target } = fixture();
    try {
      db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(target.id);
      assert.throws(
        () => acceptEmailInviteInDatabase(db, target.id, "a".repeat(43)),
        /INVALID_INVITE_ID/,
      );
      if (revokeFirst) {
        revokeEmailInviteInDatabase(db, owner.id, museum.id, invitation.id);
        assert.throws(
          () => acceptEmailInviteInDatabase(db, target.id, invitation.id),
          /INVITE_UNAVAILABLE/,
        );
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM museum_memberships").get()?.n, 0);
      } else {
        acceptEmailInviteInDatabase(db, target.id, invitation.id);
        assert.throws(
          () => revokeEmailInviteInDatabase(db, owner.id, museum.id, invitation.id),
          /INVITE_ALREADY_ACCEPTED/,
        );
        assert.equal(
          db.prepare("SELECT status FROM museum_memberships WHERE user_id=?").get(target.id)
            ?.status,
          "active",
        );
      }
    } finally {
      db.close();
    }
  }
});

test("membership, consumption and notification are atomic with the join audit", () => {
  const { db, invitation, target } = fixture();
  try {
    db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(target.id);
    db.exec(
      "CREATE TRIGGER reject_join BEFORE INSERT ON audit_logs WHEN NEW.action='membership.join' BEGIN SELECT RAISE(ABORT,'audit failed'); END",
    );
    assert.throws(() => acceptEmailInviteInDatabase(db, target.id, invitation.id), /audit failed/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM museum_memberships").get()?.n, 0);
    assert.equal(
      db.prepare("SELECT status FROM collaboration_invites WHERE id=?").get(invitation.id)?.status,
      "pending",
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM museum_notifications").get()?.n, 0);
  } finally {
    db.close();
  }
});

test(
  "two independent SQLite writers racing acceptance and revocation commit exactly one winner",
  { timeout: 15_000 },
  async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "palace-email-invite-race-"));
    const databasePath = path.join(directory, "isolated.sqlite");
    const f = fixture(databasePath);
    const children: ReturnType<typeof spawn>[] = [];
    try {
      f.db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(f.target.id);
      const racers = ["accept", "revoke"].map((action) => {
        const child = spawn(
          process.execPath,
          [
            "--experimental-strip-types",
            path.resolve("tests/fixtures/email-invite-race-worker.ts"),
            databasePath,
            action,
            action === "accept" ? f.target.id : f.owner.id,
            f.museum.id,
            f.invitation.id,
          ],
          { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
        );
        children.push(child);
        let output = "";
        let diagnostic = "";
        let markReady: () => void;
        const ready = new Promise<void>((resolve) => {
          markReady = resolve;
        });
        child.stdout!.on("data", (chunk) => {
          output += chunk.toString();
          if (output.includes("READY\n")) markReady();
        });
        child.stderr!.on("data", (chunk) => {
          diagnostic += chunk.toString();
        });
        const completed = new Promise<{ action: string; ok: boolean; code?: string }>(
          (resolve, reject) => {
            child.on("error", reject);
            child.on("close", (code) => {
              markReady();
              if (code !== 0) return reject(new Error(`Race fixture failed: ${diagnostic}`));
              try {
                resolve(JSON.parse(output.trim().split("\n").at(-1)!));
              } catch (error) {
                reject(error);
              }
            });
          },
        );
        return { child, ready, completed };
      });
      await Promise.all(racers.map((racer) => racer.ready));
      for (const racer of racers) racer.child.stdin!.end("GO\n");
      const results = await Promise.all(racers.map((racer) => racer.completed));
      assert.equal(results.filter((result) => result.ok).length, 1);
      const status = f.db
        .prepare("SELECT status FROM collaboration_invites WHERE id=?")
        .get(f.invitation.id)?.status;
      const membership = f.db
        .prepare("SELECT status FROM museum_memberships WHERE museum_id=? AND user_id=?")
        .get(f.museum.id, f.target.id);
      if (status === "accepted") {
        assert.equal(membership?.status, "active");
        assert.equal(
          results.find((result) => result.action === "revoke")?.code,
          "INVITE_ALREADY_ACCEPTED",
        );
      } else {
        assert.equal(status, "revoked");
        assert.equal(membership, undefined);
        assert.equal(
          results.find((result) => result.action === "accept")?.code,
          "INVITE_UNAVAILABLE",
        );
      }
    } finally {
      for (const child of children) if (child.exitCode === null) child.kill();
      f.db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
