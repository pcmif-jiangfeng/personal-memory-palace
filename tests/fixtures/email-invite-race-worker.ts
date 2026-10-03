import { DatabaseSync } from "node:sqlite";
import { acceptEmailInviteInDatabase } from "../../src/data/email-invite-acceptance.ts";
import { revokeEmailInviteInDatabase } from "../../src/data/email-invites.ts";
import { ApiError } from "../../src/http/errors.ts";

const [databasePath, action, actorId, museumId, inviteId] = process.argv.slice(2);
if (!databasePath || !["accept", "revoke"].includes(action) || !actorId || !museumId || !inviteId)
  throw new Error("Invalid isolated race fixture arguments");
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
process.stdin.once("data", () => {
  try {
    if (action === "accept") acceptEmailInviteInDatabase(database, actorId, inviteId);
    else revokeEmailInviteInDatabase(database, actorId, museumId, inviteId);
    process.stdout.write(JSON.stringify({ action, ok: true }) + "\n");
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    process.stdout.write(JSON.stringify({ action, ok: false, code: error.code }) + "\n");
  } finally {
    database.close();
  }
});
process.stdout.write("READY\n");
