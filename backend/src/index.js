import { COMMITTEES, COUNTRIES, committeeByCode, emptyForm } from '../../committees.js';
import { handleAccounts, verifySession } from './users.js';
import { normalizeVoting, MAX_VOTATIONS } from '../../voting.js';
import { ensureControlSchema, systemState, systemStatement, auditStatement, auditEvents, editingStatus } from './control.js';
import { activeEditors, PRESENCE_TTL } from './presence.js';
const MAX_BODY = 4000000;
const VOTES = new Set(['', 'favoravel', 'abstido', 'contra']);
const VOTE_LABELS = { '': 'Sem voto', favoravel: 'Favorável', abstido: 'Abstido', contra: 'Contra' };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
class InputError extends Error {}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).includes(origin) && Boolean(origin);
    const cors = allowed ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type, Authorization', vary: 'Origin' } : {};
    const respond = (data, status = 200) => json(data, status, cors);
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return respond({ ok: true, version: '2026-10-lock-presence-v2' });
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (!allowed) return respond({ error: 'Origem não autorizada.' }, 403);
    try {
      if (url.pathname === '/api/public/status' && request.method === 'GET') return respond({ editing: editingStatus(await systemState(env)), version: '2026-10-lock-presence-v2' });
      if (url.pathname.startsWith('/api/auth/') || url.pathname === '/api/users' || url.pathname.startsWith('/api/users/')) return await handleAccounts(request, env, respond);
      if (url.pathname.startsWith('/api/dev/') || url.pathname === '/api/crisis/start') {
        const session = await verifySession(env, request.headers.get('Authorization')?.replace(/^Bearer\s+/i, ''));
        if (!session) return respond({ error: 'Entre no painel para continuar.' }, 401);
        const isStart = url.pathname === '/api/crisis/start';
        if (!isStart && session.user.role !== 'dev') return respond({ error: 'Esta ação exige acesso DEV.' }, 403);
        const routes = { '/api/dev/status': 'status', '/api/dev/backup': 'backup', '/api/dev/reset': 'reset', '/api/dev/crisis/end': 'end-crisis', '/api/dev/editing': 'editing', '/api/dev/presence': 'presence', '/api/crisis/start': 'start-crisis' };
        const action = routes[url.pathname];
        if (!action) return respond({ error: 'Rota não encontrada.' }, 404);
        if (request.method !== (['status', 'backup'].includes(action) ? 'GET' : 'POST')) return respond({ error: 'Método não permitido.' }, 405);
        const body = request.method === 'POST' ? await readJson(request) : {};
        if (action === 'editing') {
          if (typeof body.locked !== 'boolean' || (body.until !== null && body.until !== undefined && (typeof body.until !== 'string' || !Number.isFinite(Date.parse(body.until)) || Date.parse(body.until) <= Date.now()))) return respond({ error: 'Informe o estado e uma data futura para a liberação.' }, 400);
          body.until = body.locked && body.until ? new Date(body.until).toISOString() : null;
        }
        if (action === 'reset' && body?.confirmation !== 'RESETAR TODOS') return respond({ error: 'Digite RESETAR TODOS para confirmar.' }, 400);
        if (action === 'start-crisis') { body.title = text(body.title, 500).trim() || 'A crise começou'; body.message = text(body.message, 2000).trim() || 'A crise foi iniciada. Acompanhe as orientações e registre os acontecimentos do seu comitê.'; }
        const stub = env.DASHBOARD.get(env.DASHBOARD.idFromName('all-committees'));
        const response = await stub.fetch(`https://dashboard.internal/control/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, actor: session.user.username }) });
        return respond(await response.json(), response.status);
      }
      if (url.pathname === '/api/dashboard' || url.pathname === '/api/dashboard/live') {
        if (request.method !== 'GET') return respond({ error: 'Método não permitido.' }, 405);
        const live = url.pathname.endsWith('/live');
        const token = live ? wsCredential(request) : request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
        const session = await verifySession(env, token);
        if (!session) return respond({ error: 'Entre com login e senha para acompanhar os comitês.' }, 401);
        if (live && request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return respond({ error: 'Esta rota exige WebSocket.' }, 426);
        const stub = env.DASHBOARD.get(env.DASHBOARD.idFromName('all-committees'));
        const headers = new Headers(request.headers); headers.set('x-session-expires', String(session.expiresAt)); headers.set('x-session-user', session.user.id);
        const response = await stub.fetch(new Request(`https://dashboard.internal/${live ? 'connect' : 'snapshot'}`, { headers }));
        return live ? response : respond(await response.json(), response.status);
      }
      const match = url.pathname.match(/^\/api\/committees\/([A-Z0-9_-]+)(\/live)?$/);
      if (!match || !committeeByCode(match[1])) return respond({ error: 'Comitê não encontrado.' }, 404);
      const [, code, live] = match;
      if (!['GET', 'PUT'].includes(request.method) || (live && request.method !== 'GET')) return respond({ error: 'Método não permitido.' }, 405);
      if (live && request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return respond({ error: 'Esta rota exige WebSocket.' }, 426);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(`committee:${code}`));
      const headers = new Headers(request.headers); headers.set('x-committee-code', code);
      const form = request.method === 'PUT' ? normalize(await readJson(request), code) : undefined;
      const response = await stub.fetch(new Request(`https://committee.internal/${live ? 'connect' : form ? 'save' : 'snapshot'}`, { method: form ? 'POST' : 'GET', headers, body: form ? JSON.stringify(form) : undefined }));
      return live ? response : respond(await response.json(), response.status);
    } catch (error) {
      if (error instanceof InputError) return respond({ error: error.message }, 400);
      console.error('MINIONU:', error.message);
      return respond({ error: 'Não foi possível concluir a operação. Tente novamente.' }, 503);
    }
  }
};

export class RoomLiveUpdates {
  constructor(state, env) {
    this.state = state; this.env = env; this.queue = Promise.resolve(); this.presenceAt = 0;
    state.blockConcurrencyWhile?.(async () => { this.presenceAt = await state.storage.get('presence-at') || 0; });
  }
  fetch(request) {
    if (new URL(request.url).pathname === '/presence') return this.refreshPresence(request.headers.get('x-committee-code')).then(info => json(info));
    const work = this.queue.then(() => this.handle(request)); this.queue = work.catch(() => {}); return work;
  }
  active(exclude) { return activeEditors(this.state.getWebSockets(), Date.now(), exclude).length; }
  presenceInfo(exclude) {
    const live = activeEditors(this.state.getWebSockets(), Date.now(), exclude);
    this.presenceAt = Math.max(Date.now(), this.presenceAt + 1);
    const pending = this.state.storage?.put('presence-at', this.presenceAt); if (pending) this.state.waitUntil?.(pending);
    return { activeEditors: live.length, presenceAt: this.presenceAt, presenceLastSeen: live.length ? Math.max(...live.map(socket => socket.deserializeAttachment().lastSeen)) : null };
  }
  async refreshPresence(code, announce = false) {
    const sockets = this.state.getWebSockets(), live = activeEditors(sockets), fresh = new Set(live);
    let removed = false;
    for (const socket of sockets) if (!fresh.has(socket)) { try { socket.close(1000, 'Conexão inativa.'); removed = true; } catch {} }
    const info = this.presenceInfo();
    if ((removed || announce) && code) this.publish({ type: 'presence', committee: code, ...info });
    if (live.length) await this.state.storage.setAlarm(Math.min(...live.map(socket => socket.deserializeAttachment().lastSeen)) + PRESENCE_TTL);
    else await this.state.storage.deleteAlarm();
    return info;
  }
  async alarm() { await this.refreshPresence(await this.state.storage.get('committee-code'), true); }
  async handle(request) {
    const code = request.headers.get('x-committee-code');
    if (!committeeByCode(code)) return json({ error: 'Comitê inválido.' }, 400);
    const system = await systemState(this.env);
    let row = await this.env.DB.prepare('SELECT * FROM committee_forms WHERE code = ?').bind(code).first();
    if (!row) {
      const now = new Date().toISOString();
      await this.env.DB.prepare('INSERT OR IGNORE INTO committee_forms (code, form_json, revision, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').bind(code, JSON.stringify({ ...emptyForm(code), resetEpoch: system.resetEpoch }), now, now).run();
      row = await this.env.DB.prepare('SELECT * FROM committee_forms WHERE code = ?').bind(code).first();
    }
    const path = new URL(request.url).pathname;
    const snapshot = () => ({ ...formSnapshot(row), notice: system.crisis, editing: editingStatus(system), ...this.presenceInfo() });
    if (path === '/snapshot') return json(snapshot());
    if (path === '/invalidate' || path === '/notice' || path === '/editing') {
      const message = path === '/invalidate' ? { type: 'form-reset', ...snapshot() } : path === '/editing' ? { type: 'editing-state', editing: editingStatus(system) } : { type: 'crisis-state', notice: system.crisis };
      for (const socket of this.state.getWebSockets()) { try { socket.send(JSON.stringify(message)); } catch {} }
      return json({ ok: true });
    }
    if (path === '/connect') {
      await this.refreshPresence(code);
      const pair = new WebSocketPair(); this.state.acceptWebSocket(pair[1]); pair[1].serializeAttachment({ code, lastSeen: Date.now() });
      await this.state.storage.put('committee-code', code);
      await this.refreshPresence(code);
      pair[1].send(JSON.stringify({ type: 'form-snapshot', ...snapshot() }));
      this.publish({ type: 'presence', committee: code, ...this.presenceInfo() });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (path === '/save' && request.method === 'POST') {
      if (editingStatus(system).locked) return json({ error: 'O preenchimento dos comitês está bloqueado.', editing: editingStatus(system) }, 423);
      const form = await request.json(), previous = JSON.parse(row.form_json);
      if (form.legacyCSNU) {
        // Um navegador com a versão antiga não pode limpar os dados da nova delegação.
        const storedUK = previous.state.delegations.find(d => d.country === 'Reino Unido');
        if (storedUK) form.state.delegations[form.state.delegations.findIndex(d => d.country === 'Reino Unido')] = storedUK;
      }
      delete form.legacyCSNU;
      if ((form.resetEpoch || '') !== system.resetEpoch || (previous.resetEpoch || '') !== system.resetEpoch) return json({ error: 'O comitê foi resetado. Recarregue os dados atuais.', reset: true }, 409);
      // O histórico é cumulativo: um formulário antigo não pode apagar votações já salvas.
      const records = new Map((previous.state.voting?.history || []).map(record => [record.id, record]));
      for (const record of form.state.voting.history) if (!records.has(record.id)) {
        if (code === 'CSNU' && record.votes.length !== committeeByCode(code).countries) return json({ error: 'Atualize a página do CSNU para incluir o Reino Unido antes de registrar uma nova votação.' }, 400);
        records.set(record.id, record);
      }
      if (records.size > MAX_VOTATIONS) return json({ error: 'O histórico atingiu o limite de votações deste comitê.' }, 400);
      form.state.voting.history = [...records.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
      const changes = diff(previous, form);
      if (!changes.length) return json(snapshot());
      const now = new Date().toISOString(), revision = row.revision + 1;
      const results = await this.env.DB.batch([
        this.env.DB.prepare("UPDATE committee_forms SET form_json = ?, revision = ?, updated_at = ? WHERE code = ? AND revision = ? AND COALESCE((SELECT json_extract(value, '$.resetEpoch') FROM app_settings WHERE key = 'system'), '') = ? AND COALESCE((SELECT json_extract(value, '$.editingLock.changedAt') FROM app_settings WHERE key = 'system'), '') = ?").bind(JSON.stringify(form), revision, now, code, row.revision, form.resetEpoch, system.editingLock.changedAt),
        this.env.DB.prepare('INSERT INTO committee_events (committee_code, revision, changes_json, created_at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM committee_forms WHERE code = ? AND revision = ? AND updated_at = ?)').bind(code, revision, JSON.stringify(changes), now, code, revision, now)
      ]);
      if (!results[0].meta.changes) {
        const editing = editingStatus(await systemState(this.env));
        return editing.locked ? json({ error: 'O preenchimento dos comitês está bloqueado.', editing }, 423) : json({ error: 'Os dados do comitê foram atualizados. Recarregue os dados atuais.', reset: true }, 409);
      }
      const saved = { ...form, revision, updatedAt: now, createdAt: row.created_at, ...this.presenceInfo(), notice: system.crisis, editing: editingStatus(system) };
      const message = { type: 'form-update', ...saved, changes };
      for (const socket of this.state.getWebSockets()) { try { socket.send(JSON.stringify(message)); } catch {} }
      this.publish(message);
      return json(saved);
    }
    return json({ error: 'Rota não encontrada.' }, 404);
  }
  publish(event) {
    const work = this.env.DASHBOARD.get(this.env.DASHBOARD.idFromName('all-committees')).fetch('https://dashboard.internal/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) }).catch(error => console.error('Falha ao atualizar acompanhamento:', error.message));
    this.state.waitUntil?.(work);
  }
  async webSocketMessage(socket, message) {
    const attachment = socket.deserializeAttachment();
    if (message === 'ping' && attachment?.code) {
      socket.serializeAttachment({ ...attachment, lastSeen: Date.now() });
      await this.refreshPresence(attachment.code);
      socket.send('pong'); return;
    }
    if (message === 'leave') { socket.close(1000, 'Painel fechado.'); if (attachment) this.publish({ type: 'presence', committee: attachment.code, ...this.presenceInfo(socket) }); return; }
    socket.close(1008, 'Mensagem inválida.');
  }
  async webSocketClose(socket, code, reason) {
    const attachment = socket.deserializeAttachment(); socket.close([1005, 1006, 1015].includes(code) ? 1000 : code, reason);
    if (attachment) this.publish({ type: 'presence', committee: attachment.code, ...this.presenceInfo(socket) });
  }
  async webSocketError(socket) {
    const attachment = socket.deserializeAttachment(); socket.close(1011, 'Erro de conexão.');
    if (attachment) this.publish({ type: 'presence', committee: attachment.code, ...this.presenceInfo(socket) });
  }
}

export class GlobalDashboard {
  constructor(state, env) {
    this.state = state; this.env = env; this.queue = Promise.resolve(); this.presenceVersions = new Map();
    state.blockConcurrencyWhile?.(async () => { this.presenceVersions = new Map(await state.storage.get('presence-versions') || []); });
  }
  fetch(request) { const work = this.queue.then(() => this.handle(request)); this.queue = work.catch(() => {}); return work; }
  async snapshot() {
    const system = await systemState(this.env);
    const rows = await this.env.DB.prepare('SELECT * FROM committee_forms').all();
    const presence = await Promise.all(COMMITTEES.map(async committee => {
      const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(`committee:${committee.code}`)).fetch('https://committee.internal/presence', { headers: { 'x-committee-code': committee.code } }); return response.json();
    }));
    const history = await this.env.DB.prepare('SELECT committee_code, revision, changes_json, created_at FROM committee_events ORDER BY created_at DESC LIMIT 50').all();
    for (let i = 0; i < COMMITTEES.length; i++) this.presenceVersions.set(COMMITTEES[i].code, Math.max(this.presenceVersions.get(COMMITTEES[i].code) || 0, presence[i].presenceAt || 0));
    await this.state.storage.put('presence-versions', [...this.presenceVersions]);
    return {
      type: 'dashboard-snapshot',
      system,
      editing: editingStatus(system),
      committees: COMMITTEES.map((committee, index) => {
        const row = rows.results.find(r => r.code === committee.code);
        return { ...(row ? formSnapshot(row) : { ...emptyForm(committee.code), resetEpoch: system.resetEpoch, revision: 0, updatedAt: null }), name: committee.name, ...presence[index] };
      }),
      recentEvents: history.results.map(event => ({ committee: event.committee_code, revision: event.revision, updatedAt: event.created_at, changes: JSON.parse(event.changes_json) }))
    };
  }
  async handle(request) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/control/')) return this.control(path.slice(9), await request.json());
    if (path === '/login-attempt' && request.method === 'POST') {
      const { fingerprint } = await request.json(), key = `login:${fingerprint}`, window = Math.floor(Date.now() / 60000);
      const previous = await this.state.storage.get(key);
      const count = previous?.window === window ? previous.count : 0;
      if (count >= 8) return json({ error: 'Limite de tentativas.' }, 429);
      await this.state.storage.put(key, { window, count: count + 1 });
      return json({ ok: true });
    }
    if (path === '/snapshot') return json(await this.snapshot());
    if (path === '/revoke-user' && request.method === 'POST') {
      const { userId } = await request.json();
      for (const socket of this.state.getWebSockets()) {
        const attachment = socket.deserializeAttachment();
        if (!attachment?.userId || attachment.userId === userId) { try { socket.close(1008, 'Acesso revogado.'); } catch {} }
      }
      return json({ ok: true });
    }
    if (path === '/connect') {
      const data = await this.snapshot(), pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]); pair[1].serializeAttachment({ expiresAt: Number(request.headers.get('x-session-expires')), userId: request.headers.get('x-session-user') });
      pair[1].send(JSON.stringify(data));
      return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'mun-live' } });
    }
    if (path === '/update' && request.method === 'POST') {
      const event = await request.json();
      if (event.type === 'form-update' && (event.resetEpoch || '') !== (await systemState(this.env)).resetEpoch) return json({ ok: true });
      if (Object.hasOwn(event, 'activeEditors')) {
        const latest = this.presenceVersions.get(event.committee) || 0;
        if (!Number.isFinite(event.presenceAt) || event.presenceAt < latest) {
          if (event.type === 'presence') return json({ ok: true });
          delete event.activeEditors; delete event.presenceAt; delete event.presenceLastSeen;
        } else { this.presenceVersions.set(event.committee, event.presenceAt); await this.state.storage.put('presence-versions', [...this.presenceVersions]); }
      }
      this.broadcast(event);
      return json({ ok: true });
    }
    return json({ error: 'Rota não encontrada.' }, 404);
  }
  broadcast(event) {
    for (const socket of this.state.getWebSockets()) {
      try { if (socket.deserializeAttachment().expiresAt <= Date.now()) socket.close(1008, 'Sessão expirada.'); else socket.send(JSON.stringify(event)); } catch {}
    }
  }
  async control(action, body) {
    await ensureControlSchema(this.env);
    const system = await systemState(this.env);
    if (action === 'status') return json({ system, editing: editingStatus(system), audit: await auditEvents(this.env), committeeCount: COMMITTEES.length, version: '2026-10-lock-presence-v2' });
    if (action === 'editing') {
      system.editingLock = { enabled: body.locked, until: body.until || null, changedAt: crypto.randomUUID() };
      await this.env.DB.batch([systemStatement(this.env, system), auditStatement(this.env, body.actor, 'editing', { locked: body.locked, until: body.until || null })]);
      await this.notifyRooms('/editing');
      const editing = editingStatus(system); this.broadcast({ type: 'editing-state', editing });
      return json({ ok: true, editing, system });
    }
    if (action === 'presence') { const snapshot = await this.snapshot(); this.broadcast(snapshot); return json({ ok: true, committees: snapshot.committees.map(c => ({ committee: c.committee, activeEditors: c.activeEditors })) }); }
    if (action === 'backup') {
      const events = await this.env.DB.prepare('SELECT * FROM committee_events ORDER BY created_at, committee_code, revision').all();
      return json({ version: 1, exportedAt: new Date().toISOString(), dashboard: await this.snapshot(), events: events.results, audit: await auditEvents(this.env) });
    }
    if (action === 'start-crisis' || action === 'end-crisis') {
      if (action === 'start-crisis' && system.crisis) return json({ error: 'A crise já está em andamento. Encerre o aviso no DEV antes de iniciar outra.' }, 409);
      system.crisis = action === 'start-crisis' ? { id: crypto.randomUUID(), title: body.title, message: body.message, startedAt: new Date().toISOString(), startedBy: body.actor } : null;
      await this.env.DB.batch([systemStatement(this.env, system), auditStatement(this.env, body.actor, action, { crisis: system.crisis })]);
      await this.notifyRooms('/notice');
      this.broadcast({ type: 'crisis-state', notice: system.crisis });
      return json({ ok: true, system });
    }
    if (action === 'reset') {
      if (body.confirmation !== 'RESETAR TODOS') return json({ error: 'Confirmação inválida.' }, 400);
      const epoch = crypto.randomUUID(), now = new Date().toISOString(), fresh = { resetEpoch: epoch, crisis: null, editingLock: system.editingLock };
      const statements = COMMITTEES.map(c => this.env.DB.prepare('INSERT INTO committee_forms (code, form_json, revision, created_at, updated_at) VALUES (?, ?, 1, ?, ?) ON CONFLICT(code) DO UPDATE SET form_json = excluded.form_json, revision = committee_forms.revision + 1, updated_at = excluded.updated_at').bind(c.code, JSON.stringify({ ...emptyForm(c.code), resetEpoch: epoch }), now, now));
      await this.env.DB.batch([systemStatement(this.env, fresh), ...statements, this.env.DB.prepare('DELETE FROM committee_events'), auditStatement(this.env, body.actor, action, { committees: COMMITTEES.map(c => c.code), resetEpoch: epoch })]);
      await this.notifyRooms('/invalidate');
      this.broadcast(await this.snapshot());
      return json({ ok: true, system: fresh, resetCount: COMMITTEES.length });
    }
    return json({ error: 'Ação desconhecida.' }, 404);
  }
  async notifyRooms(path) {
    const results = await Promise.allSettled(COMMITTEES.map(c => this.env.ROOMS.get(this.env.ROOMS.idFromName(`committee:${c.code}`)).fetch(`https://committee.internal${path}`, { method: 'POST', headers: { 'x-committee-code': c.code } })));
    // O estado persistido também é recebido quando o painel se reconecta ou consulta o servidor.
    for (const result of results) if (result.status === 'rejected' || !result.value.ok) console.error('Falha ao entregar aviso ao comitê.');
  }
  webSocketMessage(socket) { socket.close(1008, 'Painel somente para acompanhamento.'); }
  webSocketClose(socket, code, reason) { socket.close([1005, 1006, 1015].includes(code) ? 1000 : code, reason); }
  webSocketError(socket) { socket.close(1011, 'Erro de conexão.'); }
}

function formSnapshot(row) {
  const form = JSON.parse(row.form_json);
  if (form.committee === 'CSNU' && !form.state.delegations.some(d => d.country === 'Reino Unido')) form.state.delegations.push({ country: 'Reino Unido', vote: '', comment: '' });
  return { ...form, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}
async function readJson(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new InputError('Envie JSON.');
  const reader = request.body?.getReader(); if (!reader) throw new InputError('Envie os dados.');
  let length = 0; const chunks = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > MAX_BODY) { await reader.cancel(); throw new InputError('Dados acima do limite de tamanho.'); } chunks.push(value); }
  const buffer = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); } catch { throw new InputError('JSON inválido.'); }
}
function text(value, max) { if (value === undefined) return ''; if (typeof value !== 'string' || value.length > max) throw new InputError('Texto inválido ou acima do limite.'); return value; }
function normalize(body, code) {
  if (!body || typeof body !== 'object' || body.committee !== code || typeof body.hasVeto !== 'boolean') throw new InputError('Formulário inválido.');
  const state = body.state;
  if (!state || !Array.isArray(state.vetoCountries) || state.vetoCountries.some(c => !COUNTRIES.includes(c)) || !Array.isArray(state.delegations)) throw new InputError('Delegações ou veto inválidos.');
  const expected = COUNTRIES.slice(0, committeeByCode(code).countries);
  const legacyCSNU = code === 'CSNU' && state.delegations.length === 9;
  const submittedCountries = legacyCSNU ? COUNTRIES.slice(0, 9) : expected;
  if (state.delegations.length !== submittedCountries.length || submittedCountries.some(country => state.delegations.filter(d => d?.country === country).length !== 1)) throw new InputError('Lista de delegações inválida.');
  let voting;
  try { voting = normalizeVoting(state.voting, code); } catch (error) { throw new InputError(error.message); }
  return { committee: code, ...(legacyCSNU ? { legacyCSNU: true } : {}), resetEpoch: text(body.resetEpoch, 80), hasVeto: body.hasVeto, crisisTitle: text(body.crisisTitle, 500), crisisDetails: text(body.crisisDetails, 5000), state: { vetoCountries: COUNTRIES.filter(c => state.vetoCountries.includes(c)), voting, delegations: expected.map(country => { const d = state.delegations.find(d => d.country === country) || { vote: '', comment: '' }; if (!VOTES.has(d.vote)) throw new InputError('Voto inválido.'); return { country, vote: d.vote, comment: text(d.comment, 4000) }; }) } };
}
function diff(before, after) {
  const changes = [], labels = { hasVeto: 'Veto', crisisTitle: 'Crise', crisisDetails: 'Detalhamento e resolução' };
  const previousVoting = before.state.voting || { proposal: '', visualDecision: '', history: [] };
  const voting = after.state.voting || { proposal: '', visualDecision: '', history: [] };
  for (const [field, label] of Object.entries({ proposal: 'Proposta em votação', visualDecision: 'Contraste visual' })) if (previousVoting[field] !== voting[field]) changes.push({ field, label, before: previousVoting[field], after: voting[field] });
  const previousIds = new Set(previousVoting.history.map(record => record.id));
  for (const record of voting.history) if (!previousIds.has(record.id)) changes.push({ field: 'votation', label: 'Votação registrada', before: '', after: record.proposal + ': ' + (record.result === 'approved' ? 'Aprovada' : 'Recusada') });
  for (const [field, label] of Object.entries(labels)) if (before[field] !== after[field]) changes.push({ field, label, before: before[field], after: after[field] });
  if (JSON.stringify(before.state.vetoCountries) !== JSON.stringify(after.state.vetoCountries)) changes.push({ field: 'vetoCountries', label: 'Países com veto', before: before.state.vetoCountries, after: after.state.vetoCountries });
  for (const d of after.state.delegations) { const previous = before.state.delegations.find(p => p.country === d.country) || { comment: '', vote: '' }; if (d.comment !== previous.comment) changes.push({ field: 'comment', country: d.country, label: `${d.country}: comentário`, before: previous.comment, after: d.comment }); if (d.vote !== previous.vote) changes.push({ field: 'vote', country: d.country, label: `${d.country}: voto`, before: VOTE_LABELS[previous.vote], after: VOTE_LABELS[d.vote] }); }
  const excerpt = value => typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value;
  return changes.map(c => ({ ...c, before: excerpt(c.before), after: excerpt(c.after) }));
}
function wsCredential(request) { return (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(s => s.trim()).find(s => s.startsWith('mun-auth.'))?.slice(9); }


