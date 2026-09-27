// Store only a SHA-256 digest, never the bearer token from the invitation URL.
export const inviteLinkSchemaSql = `
CREATE TABLE IF NOT EXISTS invite_links (
  id TEXT PRIMARY KEY NOT NULL,
  museum_id TEXT NOT NULL REFERENCES museums(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE
    CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  use_mode TEXT NOT NULL DEFAULT 'single-use'
    CHECK (use_mode IN ('single-use', 'multi-use')),
  expires_at TEXT,
  revoked_at TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(usage_count) = 'integer' AND usage_count >= 0),
  max_uses INTEGER DEFAULT 1
    CHECK (max_uses IS NULL OR (typeof(max_uses) = 'integer' AND max_uses > 0)),
  created_at TEXT NOT NULL,
  CHECK (use_mode = 'multi-use' OR (max_uses IS NOT NULL AND max_uses = 1)),
  CHECK (max_uses IS NULL OR usage_count <= max_uses)
);

CREATE INDEX IF NOT EXISTS invite_links_museum_created
ON invite_links(museum_id, created_at DESC);
`;
