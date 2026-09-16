export const schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  trashed_at TEXT
);

CREATE TABLE IF NOT EXISTS stage_covers (
  stage_id TEXT PRIMARY KEY REFERENCES stages(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  story TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  trashed_at TEXT
);

CREATE TABLE IF NOT EXISTS memory_images (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_cover INTEGER NOT NULL DEFAULT 0 CHECK (is_cover IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploaded_photos (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  optimized_storage_key TEXT NOT NULL UNIQUE,
  original_storage_key TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS one_cover_per_memory
ON memory_images(memory_id) WHERE is_cover = 1;

CREATE TABLE IF NOT EXISTS memory_relations (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  related_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (memory_id, related_memory_id),
  CHECK (memory_id <> related_memory_id)
);

CREATE TABLE IF NOT EXISTS later_notes (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS share_configs (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL UNIQUE REFERENCES memories(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  access_mode TEXT NOT NULL DEFAULT 'link' CHECK (access_mode IN ('link', 'password')),
  password_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
