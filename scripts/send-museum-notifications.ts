import { getDatabase } from "../src/data/database.ts";
import { deliverMuseumNotifications } from "../src/email/museum-notifications.ts";
import { queueDueMuseumDeletionReminders } from "../src/data/museum-deletion-notifications.ts";

const database = getDatabase();
try {
  const reminders = queueDueMuseumDeletionReminders(database);
  const result = await deliverMuseumNotifications(database);
  console.log(
    `Museum notifications: reminders=${reminders.queuedMuseums}, configured=${result.configured}, sent=${result.sent}, failed=${result.failed}`,
  );
  if (!result.configured || result.failed) process.exitCode = 1;
} finally {
  database.close();
}
