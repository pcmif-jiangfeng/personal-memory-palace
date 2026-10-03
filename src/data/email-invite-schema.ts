// Separate from historical bearer links: the ID locates an invitation, never authorizes joining.
export const emailInviteSchemaSql = `
CREATE TABLE IF NOT EXISTS collaboration_invites (
  id TEXT PRIMARY KEY NOT NULL,
  museum_id TEXT NOT NULL REFERENCES museums(id) ON DELETE CASCADE,
  target_email TEXT NOT NULL CHECK(target_email=lower(trim(target_email)) AND length(target_email) BETWEEN 3 AND 254),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked','expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS collaboration_invites_pending_target
ON collaboration_invites(museum_id,target_email) WHERE status='pending';
CREATE INDEX IF NOT EXISTS collaboration_invites_museum_created
ON collaboration_invites(museum_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS collaboration_invites_target
ON collaboration_invites(target_email,status);
`;
