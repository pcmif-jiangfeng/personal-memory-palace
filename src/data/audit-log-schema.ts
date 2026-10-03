export const auditLogSchemaSql = `
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  museum_id TEXT NOT NULL REFERENCES museums(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (length(trim(action)) > 0),
  object_type TEXT NOT NULL CHECK (length(trim(object_type)) > 0),
  object_id TEXT NOT NULL CHECK (length(trim(object_id)) > 0),
  timestamp TEXT NOT NULL CHECK (length(trim(timestamp)) > 0),
  diff TEXT CHECK (diff IS NULL OR CASE
    WHEN json_valid(diff) THEN json_type(diff) = 'object'
    ELSE 0 END)
);

CREATE INDEX IF NOT EXISTS audit_logs_museum_timestamp
ON audit_logs(museum_id, timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS audit_logs_museum_object_timestamp
ON audit_logs(museum_id, object_type, object_id, timestamp DESC, id DESC);
`;
