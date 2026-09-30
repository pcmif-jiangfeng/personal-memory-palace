import { getDatabase } from "../src/data/database.ts";
import { getPlatformAdminUserId } from "../src/config.ts";
import { grantIncidentSupportAccessInDatabase } from "../src/data/platform-admin-support.ts";
import { validateSupportId } from "../src/http/museum-support-access.ts";

const [museumId, memoryId, purpose, caseReference, confirmation, ...extra] = process.argv.slice(2);
if (confirmation !== "--confirm" || extra.length || !caseReference || !purpose)
  throw new Error(
    "Usage: grant-support-access.ts <museumId> <memoryId> <fault_handling|security_incident> <caseReference> --confirm",
  );
validateSupportId(museumId);
validateSupportId(memoryId);
const db = getDatabase();
try {
  console.log(
    JSON.stringify(
      grantIncidentSupportAccessInDatabase(
        db,
        getPlatformAdminUserId(),
        museumId,
        memoryId,
        purpose,
        caseReference,
      ),
    ),
  );
} finally {
  db.close();
}
