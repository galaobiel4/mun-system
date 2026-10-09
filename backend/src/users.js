import { ensureControlSchema, auditStatement } from './control.js';
const SESSION_MS = 8 * 60 * 60 * 1000, ITERATIONS = 100000;
const encoder = new TextEncoder(), schemas = new WeakMap();
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS auth_user_roles (user_id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('supervisor', 'dev')))`
];
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
const publicUser = row => ({ id: row.id, username: row.username, displayName: row.display_name, active: Boolean(row.active), role: row.role || 'supervisor', createdAt: row.created_at });
async function userRole(env, user) { const row = await env.DB.prepare('SELECT role FROM auth_user_roles WHERE user_id = ?').bind(user.id).first(); return { ...user, role: row?.role || 'supervisor' }; }
const configured = env => [
  { username: env.SUPERVISOR_USER, password: env.SUPERVISOR_PASSWORD },
  { username: env.SUPERVISOR_USER_2, password: env.SUPERVISOR_PASSWORD_2 },
  { username: env.DEV_USER, password: env.DEV_PASSWORD, role: 'dev' }
].filter(item => item.username && item.password);
function ensureSchema(env) {
  let pending = schemas.get(env.DB);
  if (!pending) {
    pending = env.DB.batch(SCHEMA.map(sql => env.DB.prepare(sql))).catch(error => { schemas.delete(env.DB); throw error; });
    schemas.set(env.DB, pending);
  }
  return pending;
}
async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);
  return `${ITERATIONS}.${encode(salt)}.${encode(new Uint8Array(bits))}`;
}
async function passwordMatches(password, stored) {
  try { const [iterations, salt] = stored.split('.'); if (Number(iterations) !== ITERATIONS) return false; return same(encoder.encode(await hashPassword(password, decode(salt))), encoder.encode(stored)); } catch { return false; }
}
async function bodyOf(request) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > 4096 || !request.headers.get('content-type')?.includes('application/json')) throw new Error('Dados inválidos.');
  const reader = request.body?.getReader(); if (!reader) throw new Error('Envie os dados.');
  let size = 0, chunks = [];
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 4096) { await reader.cancel(); throw new Error('Dados acima do limite.'); } chunks.push(value); }
  const data = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  const body = JSON.parse(new TextDecoder().decode(data));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Dados inválidos.');
  return body;
}
function newAccount(body) {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  if (!/^[A-Za-z0-9._-]{3,80}$/.test(username)) throw new Error('Use de 3 a 80 letras, números, pontos, hífens ou sublinhados no login.');
  if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 200) throw new Error('A senha deve ter entre 12 e 200 caracteres.');
  const name = typeof body.displayName === 'string' ? body.displayName.trim() : username;
  if (!name || name.length > 100) throw new Error('Informe um nome de até 100 caracteres.');
  return { username, password: body.password, name };
}
async function issueSession(env, user) {
  const token = encode(crypto.getRandomValues(new Uint8Array(32))), expiresAt = Date.now() + SESSION_MS;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(Date.now()),
    env.DB.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(encode(await digest(token)), user.id, expiresAt)
  ]);
  return { token, expiresAt, user: publicUser(await userRole(env, user)) };
}
async function importConfigured(env, account) {
  const hash = await hashPassword(account.password);
  await env.DB.prepare('INSERT OR IGNORE INTO auth_users (id, username, display_name, password_hash, active, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .bind(crypto.randomUUID(), account.username, account.username, hash, new Date().toISOString()).run();
  const user = await env.DB.prepare('SELECT * FROM auth_users WHERE username = ?').bind(account.username).first();
  if (account.role === 'dev' && await passwordMatches(account.password, user.password_hash)) await env.DB.prepare("INSERT OR IGNORE INTO auth_user_roles (user_id, role) VALUES (?, 'dev')").bind(user.id).run();
  return user;
}
export async function verifySession(env, token) {
  if (typeof token !== 'string' || token.length > 1000 || !token) return null;
  await ensureSchema(env);
  const row = await env.DB.prepare('SELECT u.*, s.expires_at FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1')
    .bind(encode(await digest(token)), Date.now()).first();
  if (row) return { expiresAt: row.expires_at, user: publicUser(await userRole(env, row)) };
  // Preserve existing signed sessions while migrating the configured accounts.
  try {
    const [payload, signature, extra] = token.split('.'); if (!payload || !signature || extra) return null;
    const session = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (!Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null;
    for (const account of configured(env)) {
      const key = await crypto.subtle.importKey('raw', await digest(`${account.username}\0${account.password}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
      if (!(await crypto.subtle.verify('HMAC', key, decode(signature), encoder.encode(payload)))) continue;
      const user = await env.DB.prepare('SELECT * FROM auth_users WHERE username = ?').bind(account.username).first() || await importConfigured(env, account);
      if (user?.active && await passwordMatches(account.password, user.password_hash)) return { expiresAt: session.expiresAt, user: publicUser(await userRole(env, user)) };
    }
  } catch {}
  return null;
}
async function revokeUser(env, id) {
  await env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(id).run();
  await env.DASHBOARD.get(env.DASHBOARD.idFromName('all-committees')).fetch('https://dashboard.internal/revoke-user', { method: 'POST', body: JSON.stringify({ userId: id }) });
}
export async function handleAccounts(request, env, respond) {
  await ensureSchema(env);
  const url = new URL(request.url), path = url.pathname;
  if (path === '/api/auth/status' && request.method === 'GET') {
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM auth_users').first();
    return respond({ needsSetup: count.count === 0 && configured(env).length === 0, canSetup: Boolean(env.SUPERVISOR_PASSWORD), passwordMinimum: 12 });
  }
  if (['/api/auth/login', '/api/auth/setup'].includes(path) && request.method === 'POST') {
    const fingerprint = encode(await digest(request.headers.get('CF-Connecting-IP') || 'local'));
    const limit = await env.DASHBOARD.get(env.DASHBOARD.idFromName('all-committees')).fetch('https://dashboard.internal/login-attempt', { method: 'POST', body: JSON.stringify({ fingerprint }) });
    if (limit.status === 429) return respond({ error: 'Muitas tentativas. Aguarde um minuto e tente novamente.' }, 429);
    let body; try { body = await bodyOf(request); } catch { return respond({ error: 'Dados inválidos.' }, 400); }
    if (path === '/api/auth/setup') {
      if (!env.SUPERVISOR_PASSWORD || typeof body.activationPassword !== 'string' || !same(await digest(body.activationPassword), await digest(env.SUPERVISOR_PASSWORD))) return respond({ error: 'Senha de ativação inválida.' }, 401);
      const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM auth_users').first();
      if (count.count || configured(env).length) return respond({ error: 'O primeiro acesso já foi configurado. Entre no painel.' }, 409);
      let account; try { account = newAccount(body); } catch (error) { return respond({ error: error.message }, 400); }
      const id = crypto.randomUUID(), hash = await hashPassword(account.password);
      const result = await env.DB.prepare('INSERT INTO auth_users (id, username, display_name, password_hash, active, created_at) SELECT ?, ?, ?, ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM auth_users)')
        .bind(id, account.username, account.name, hash, new Date().toISOString()).run();
      if (!result.meta.changes) return respond({ error: 'O primeiro acesso já foi configurado.' }, 409);
      await env.DB.prepare("INSERT INTO auth_user_roles (user_id, role) VALUES (?, 'dev')").bind(id).run();
      return respond(await issueSession(env, await env.DB.prepare('SELECT * FROM auth_users WHERE id = ?').bind(id).first()), 201);
    }
    if (typeof body.username !== 'string' || body.username.length > 100 || typeof body.password !== 'string' || body.password.length > 200) return respond({ error: 'Login ou senha inválidos.' }, 401);
    const username = body.username.trim();
    let user = await env.DB.prepare('SELECT * FROM auth_users WHERE username = ?').bind(username).first();
    if (!user) {
      for (const account of configured(env)) if (same(await digest(username), await digest(account.username)) && same(await digest(body.password), await digest(account.password))) { user = await importConfigured(env, account); break; }
    }
    if (!user || !user.active || !(await passwordMatches(body.password, user.password_hash))) return respond({ error: 'Login ou senha inválidos.' }, 401);
    return respond(await issueSession(env, user));
  }
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, ''), session = await verifySession(env, token);
  if (!session) return respond({ error: 'Entre no painel para gerenciar os usuários.' }, 401);
  if (path === '/api/auth/me' && request.method === 'GET') return respond({ user: session.user });
  if (path === '/api/auth/logout' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(encode(await digest(token))).run();
    return respond({ ok: true });
  }
  if (session.user.role !== 'dev') return respond({ error: 'Esta ação exige acesso DEV.' }, 403);
  for (const account of configured(env)) {
    if (!(await env.DB.prepare('SELECT id FROM auth_users WHERE username = ?').bind(account.username).first())) await importConfigured(env, account);
  }
  if (path === '/api/users' && request.method === 'GET') {
    const offset = Number(url.searchParams.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return respond({ error: 'Página inválida.' }, 400);
    const rows = await env.DB.prepare("SELECT u.id, u.username, u.display_name, u.active, u.created_at, COALESCE(r.role, 'supervisor') AS role FROM auth_users u LEFT JOIN auth_user_roles r ON r.user_id = u.id ORDER BY u.created_at, u.id LIMIT 101 OFFSET ?").bind(offset).all();
    return respond({ users: rows.results.slice(0, 100).map(publicUser), nextOffset: rows.results.length > 100 ? offset + 100 : null, currentUserId: session.user.id });
  }
  if (path === '/api/users' && request.method === 'POST') {
    let account, role; try { const body = await bodyOf(request); account = newAccount(body); role = body.role || 'supervisor'; if (!['supervisor', 'dev'].includes(role)) throw new Error('Perfil inválido.'); } catch (error) { return respond({ error: error.message }, 400); }
    const hash = await hashPassword(account.password), id = crypto.randomUUID();
    const result = await env.DB.prepare('INSERT OR IGNORE INTO auth_users (id, username, display_name, password_hash, active, created_at) VALUES (?, ?, ?, ?, 1, ?)')
      .bind(id, account.username, account.name, hash, new Date().toISOString()).run();
    if (!result.meta.changes) return respond({ error: 'Esse login já está cadastrado.' }, 409);
    await ensureControlSchema(env);
    await env.DB.prepare('INSERT INTO auth_user_roles (user_id, role) VALUES (?, ?)').bind(id, role).run();
    await auditStatement(env, session.user.username, 'create-user', { username: account.username, role }).run();
    return respond({ user: publicUser(await userRole(env, await env.DB.prepare('SELECT * FROM auth_users WHERE id = ?').bind(id).first())) }, 201);
  }
  const match = path.match(/^\/api\/users\/([A-Za-z0-9-]+)$/);
  if (match && request.method === 'PUT') {
    const id = match[1], user = await env.DB.prepare('SELECT * FROM auth_users WHERE id = ?').bind(id).first();
    if (!user) return respond({ error: 'Usuário não encontrado.' }, 404);
    let body; try { body = await bodyOf(request); } catch { return respond({ error: 'Dados inválidos.' }, 400); }
    if (Object.keys(body).some(key => !['password', 'active'].includes(key)) || (!Object.hasOwn(body, 'password') && !Object.hasOwn(body, 'active'))) return respond({ error: 'Alteração inválida.' }, 400);
    if (Object.hasOwn(body, 'active') && typeof body.active !== 'boolean') return respond({ error: 'Estado inválido.' }, 400);
    if (body.active === false && id === session.user.id) return respond({ error: 'Você não pode desativar seu próprio acesso.' }, 409);
    let hash = user.password_hash;
    if (Object.hasOwn(body, 'password')) {
      if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 200) return respond({ error: 'A senha deve ter entre 12 e 200 caracteres.' }, 400);
      hash = await hashPassword(body.password);
    }
    const active = Object.hasOwn(body, 'active') ? Number(body.active) : user.active;
    const result = await env.DB.prepare("UPDATE auth_users SET password_hash = ?, active = ? WHERE id = ? AND (? = 1 OR NOT EXISTS (SELECT 1 FROM auth_user_roles WHERE user_id = ? AND role = 'dev') OR (SELECT COUNT(*) FROM auth_users u JOIN auth_user_roles r ON r.user_id = u.id WHERE u.active = 1 AND r.role = 'dev') > 1)")
      .bind(hash, active, id, active, id).run();
    if (!result.meta.changes) return respond({ error: 'Mantenha pelo menos um administrador ativo.' }, 409);
    if (body.password || body.active === false) await revokeUser(env, id);
    await ensureControlSchema(env);
    await auditStatement(env, session.user.username, 'update-user', { username: user.username, active: Boolean(active), passwordChanged: Object.hasOwn(body, 'password') }).run();
    return respond({ user: publicUser(await userRole(env, { ...user, active })), sessionRevoked: Boolean(body.password && id === session.user.id) });
  }
  return respond({ error: 'Rota ou método não permitido.' }, 405);
}


