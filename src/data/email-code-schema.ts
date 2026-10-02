export const emailCodeSchemaSql = `
CREATE TABLE IF NOT EXISTS email_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('REGISTER','RESET_PASSWORD','CHANGE_PASSWORD')),
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  created_at TEXT NOT NULL,
  grant_hash TEXT,
  grant_expires_at TEXT,
  UNIQUE(user_id,purpose)
);
`;
