CREATE TABLE IF NOT EXISTS auth_user_roles (user_id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('supervisor', 'dev')));
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_events (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL);
