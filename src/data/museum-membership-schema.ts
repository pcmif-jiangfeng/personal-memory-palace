// Owner remains museums.owner_id. This table records collaborators only;
// revoked relationships are retained and reactivated rather than duplicated.
export const museumMembershipSchemaSql = `
CREATE TABLE IF NOT EXISTS museum_memberships (
  museum_id TEXT NOT NULL REFERENCES museums(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'collaborator' CHECK (role = 'collaborator'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (museum_id, user_id)
);

CREATE INDEX IF NOT EXISTS museum_memberships_user_status
ON museum_memberships(user_id, status);
`;
