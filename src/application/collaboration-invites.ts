import type { DatabaseSync } from "node:sqlite";
import { createEmailInviteInDatabase, type EmailInviteSummary } from "../data/email-invites.ts";

export async function createAndSendEmailInviteInDatabase(
  database: DatabaseSync,
  ownerId: string,
  museumId: string,
  targetEmail: string,
  send: (invite: EmailInviteSummary) => Promise<void>,
) {
  // Commit authorization intent before external delivery; failures must not silently create membership.
  const result = createEmailInviteInDatabase(database, ownerId, museumId, targetEmail);
  try {
    await send(result.invite);
    return { ...result, delivery: "accepted" as const };
  } catch {
    // A provider response is not inbox evidence. Retry reuses the original expiry and locator.
    return { ...result, delivery: "failed" as const };
  }
}
