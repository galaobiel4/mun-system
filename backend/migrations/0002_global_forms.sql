CREATE TABLE IF NOT EXISTS committee_forms (
  code TEXT PRIMARY KEY,
  form_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS committee_events (
  committee_code TEXT NOT NULL REFERENCES committee_forms(code),
  revision INTEGER NOT NULL,
  changes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (committee_code, revision)
);
