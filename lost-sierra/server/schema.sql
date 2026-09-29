PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, url TEXT NOT NULL, imported_at TEXT NOT NULL,
  sha256 TEXT NOT NULL, metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json))
) STRICT;
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL CHECK(json_valid(value_json)), source_id TEXT REFERENCES sources(id)
) STRICT;
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('ride','adventure')),
  name TEXT NOT NULL, area TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published','archived')),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  source_id TEXT REFERENCES sources(id), original_json TEXT CHECK(json_valid(original_json)),
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS entries_browse ON entries(status,kind,area);
CREATE TABLE IF NOT EXISTS entry_slug_aliases (
  slug TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id)
) STRICT;
CREATE INDEX IF NOT EXISTS entry_slug_aliases_entry ON entry_slug_aliases(entry_id);
CREATE TABLE IF NOT EXISTS tracks (
  entry_id TEXT PRIMARY KEY REFERENCES entries(id),
  geojson TEXT NOT NULL CHECK(json_valid(geojson)), source_label TEXT NOT NULL, source_url TEXT,
  distance_m REAL NOT NULL, ascent_m REAL, descent_m REAL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
  entry_id TEXT, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL
) STRICT;
PRAGMA user_version = 1;
