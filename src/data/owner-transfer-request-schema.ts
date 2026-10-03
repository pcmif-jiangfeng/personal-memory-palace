export const ownerTransferRequestSchemaSql = `
CREATE TABLE IF NOT EXISTS owner_transfer_requests (
  id TEXT PRIMARY KEY,
  museum_id TEXT NOT NULL REFERENCES museums(id) ON DELETE RESTRICT,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','cancelled','invalidated','expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  resolved_at TEXT,
  CHECK(owner_user_id<>target_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS owner_transfer_one_pending ON owner_transfer_requests(museum_id) WHERE status='pending';
`;
