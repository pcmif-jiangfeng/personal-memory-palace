import { after } from "next/server";
import type { DatabaseSync } from "node:sqlite";
import { deliverMuseumNotifications } from "./museum-notifications.ts";

// The durable queue survives shutdown; this is only the prompt first delivery attempt.
export function scheduleMuseumNotificationDelivery(db: DatabaseSync, museumId: string) {
  after(async () => {
    try {
      await deliverMuseumNotifications(db, { museumId, limit: 2 });
    } catch {
      console.error("Museum notification delivery deferred; run emails:send to retry");
    }
  });
}
