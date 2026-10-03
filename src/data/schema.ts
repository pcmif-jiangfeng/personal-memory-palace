import { auditLogSchemaSql } from "./audit-log-schema.ts";
import { inviteLinkSchemaSql } from "./invite-link-schema.ts";
import { museumMembershipSchemaSql } from "./museum-membership-schema.ts";
import { photoStorageUsageSchemaSql } from "./photo-storage-quota.ts";

export const schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  storage_quota_bytes INTEGER CHECK (storage_quota_bytes >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS museums (
  id TEXT PRIMARY KEY,
  museum_type TEXT NOT NULL DEFAULT 'private' CHECK (museum_type IN ('private','shared')),
  last_edited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(slug)) > 0),
  description TEXT NOT NULL DEFAULT '',
  cover_photo_id TEXT REFERENCES uploaded_photos(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  deletion_scheduled_at TEXT,
  storage_quota_bytes INTEGER NOT NULL DEFAULT 0 CHECK (storage_quota_bytes >= 0),
  storage_used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (storage_used_bytes >= 0),
  storage_usage_ready INTEGER NOT NULL DEFAULT 0 CHECK (storage_usage_ready IN (0,1))
);

${museumMembershipSchemaSql}

${inviteLinkSchemaSql}

${auditLogSchemaSql}

${photoStorageUsageSchemaSql}

CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  last_edited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  museum_id TEXT REFERENCES museums(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  trashed_at TEXT
);

CREATE TABLE IF NOT EXISTS stage_covers (
  stage_id TEXT PRIMARY KEY REFERENCES stages(id) ON DELETE CASCADE,
  museum_id TEXT REFERENCES museums(id) ON DELETE RESTRICT,
  storage_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  last_edited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  museum_id TEXT REFERENCES museums(id) ON DELETE RESTRICT,
  stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  story TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
  is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  trashed_at TEXT
);

CREATE TABLE IF NOT EXISTS memory_images (
  id TEXT PRIMARY KEY,
  museum_id TEXT REFERENCES museums(id) ON DELETE RESTRICT,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '',
  exhibit_title TEXT NOT NULL DEFAULT '',
  exhibit_description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_cover INTEGER NOT NULL DEFAULT 0 CHECK (is_cover IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploaded_photos (
  id TEXT PRIMARY KEY,
  museum_id TEXT REFERENCES museums(id) ON DELETE RESTRICT,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  optimized_storage_key TEXT NOT NULL UNIQUE,
  original_storage_key TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT,
  library_archived_at TEXT,
  trashed_at TEXT
);

CREATE TABLE IF NOT EXISTS photo_deletion_jobs (
  photo_id TEXT PRIMARY KEY,
  museum_id TEXT REFERENCES museums(id) ON DELETE RESTRICT,
  optimized_storage_key TEXT NOT NULL UNIQUE,
  original_storage_key TEXT,
  created_at TEXT NOT NULL,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS pending_uploads (
  id TEXT PRIMARY KEY,
  museum_id TEXT REFERENCES museums(id) ON DELETE RESTRICT,
  storage_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS one_cover_per_memory
ON memory_images(memory_id) WHERE is_cover = 1;

CREATE INDEX IF NOT EXISTS memory_images_memory_sort
ON memory_images(memory_id, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS memory_images_unique_photo
ON memory_images(memory_id, storage_key);

CREATE INDEX IF NOT EXISTS memory_images_storage_key
ON memory_images(storage_key);

CREATE TABLE IF NOT EXISTS memory_relations (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  related_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  museum_id TEXT REFERENCES museums(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (memory_id, related_memory_id),
  CHECK (memory_id <> related_memory_id)
);

CREATE TABLE IF NOT EXISTS later_notes (
  id TEXT PRIMARY KEY,
  museum_id TEXT REFERENCES museums(id) ON DELETE RESTRICT,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  trashed_at TEXT,
  updated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);

CREATE TABLE IF NOT EXISTS share_configs (
  id TEXT PRIMARY KEY,
  museum_id TEXT REFERENCES museums(id) ON DELETE RESTRICT,
  memory_id TEXT NOT NULL UNIQUE REFERENCES memories(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  access_mode TEXT NOT NULL DEFAULT 'link' CHECK (access_mode IN ('link', 'password')),
  password_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS memories_active_stage_created
ON memories(stage_id, created_at DESC) WHERE trashed_at IS NULL;

CREATE INDEX IF NOT EXISTS memories_trashed_at
ON memories(trashed_at) WHERE trashed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS memory_relations_related
ON memory_relations(related_memory_id);

CREATE INDEX IF NOT EXISTS later_notes_memory_created
ON later_notes(memory_id, created_at);

CREATE INDEX IF NOT EXISTS share_configs_enabled
ON share_configs(id, enabled);
`;
