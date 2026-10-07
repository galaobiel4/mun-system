CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  access_key_hash TEXT NOT NULL,
  watch_key_hash TEXT NOT NULL,
  committee TEXT NOT NULL DEFAULT '',
  has_veto INTEGER NOT NULL DEFAULT 0 CHECK (has_veto IN (0, 1)),
  crisis_title TEXT NOT NULL DEFAULT '',
  crisis_details TEXT NOT NULL DEFAULT '',
  state_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_events (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  revision INTEGER NOT NULL,
  changes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (room_id, revision)
);
