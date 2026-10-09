const schemas = new WeakMap();
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS admin_events (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL)'
];
export function ensureControlSchema(env) {
  let pending = schemas.get(env.DB);
  if (!pending) {
    pending = env.DB.batch(SCHEMA.map(sql => env.DB.prepare(sql))).catch(error => { schemas.delete(env.DB); throw error; });
    schemas.set(env.DB, pending);
  }
  return pending;
}
export async function systemState(env) {
  await ensureControlSchema(env);
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'system'").first();
  return row ? JSON.parse(row.value) : { resetEpoch: '', crisis: null };
}
export const systemStatement = (env, system) => env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('system', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(system));
export const auditStatement = (env, actor, action, details) => env.DB.prepare('INSERT INTO admin_events (id, actor, action, details_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), actor, action, JSON.stringify(details), new Date().toISOString());
export async function auditEvents(env) {
  await ensureControlSchema(env);
  const rows = await env.DB.prepare('SELECT actor, action, details_json, created_at FROM admin_events ORDER BY created_at DESC LIMIT 100').all();
  return rows.results.map(row => ({ actor: row.actor, action: row.action, details: JSON.parse(row.details_json), createdAt: row.created_at }));
}
