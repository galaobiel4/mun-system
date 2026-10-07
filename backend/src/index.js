const MAX_BODY_BYTES = 64_000;
const COMMITTEES = new Set(['', 'CDH', 'OMS', 'UNESCO', 'ONUM', 'CSNU', 'ACNUR', 'CDESC', 'UNICEF']);
const COUNTRIES = ['Brasil', 'Rússia', 'EUA', 'Índia', 'China', 'Nigéria', 'Alemanha', 'França', 'Turquia', 'Reino Unido'];
const VOTES = new Set(['', 'favoravel', 'abstido', 'contra']);
const VOTE_LABELS = { '': 'Sem voto', favoravel: 'Favorável', abstido: 'Abstido', contra: 'Contra' };

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const origins = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const allowed = origins.includes(origin);
    const cors = allowed ? {
      'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization', 'access-control-max-age': '86400', vary: 'Origin'
    } : {};
    const respond = (data, status = 200) => json(data, status, cors);
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    const url = new URL(request.url);
    if (url.pathname === '/api/health' && request.method === 'GET') return respond({ ok: true });
    if (!allowed) return respond({ error: 'Origem não autorizada.' }, 403);
    try {
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        const room = normalizeState(await readJson(request));
        const id = crypto.randomUUID(), accessKey = randomKey(), watchKey = randomKey();
        const now = new Date().toISOString();
        await env.DB.prepare(`INSERT INTO rooms (id, access_key_hash, watch_key_hash, committee, has_veto, crisis_title, crisis_details, state_json, revision, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
          .bind(id, await sha256(accessKey), await sha256(watchKey), room.committee, room.hasVeto ? 1 : 0, room.crisisTitle, room.crisisDetails, JSON.stringify(room.state), now, now).run();
        return respond({ id, accessKey, watchKey, ...room, revision: 0, createdAt: now, updatedAt: now }, 201);
      }
      const match = url.pathname.match(/^\/api\/rooms\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/live)?$/i);
      if (!match) return respond({ error: 'Rota não encontrada.' }, 404);
      const [, id, live] = match;
      if (live && (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')) return respond({ error: 'Esta rota exige WebSocket.' }, 426);
      if (!live && !['GET', 'PUT'].includes(request.method)) return respond({ error: 'Método não permitido.' }, 405);
      // Browser WebSocket authentication uses a subprotocol, keeping credentials out of URLs.
      const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(s => s.trim());
      const key = live ? protocols.find(s => s.startsWith('mun-auth.'))?.slice(9) : request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
      if (!key || !/^[0-9a-f]{64}$/.test(key)) return respond({ error: 'Informe uma chave de acesso válida.' }, 401);
      const row = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first();
      const hash = await sha256(key);
      const editor = row && constantTimeEqual(hash, row.access_key_hash);
      const viewer = row && constantTimeEqual(hash, row.watch_key_hash);
      if (!editor && !viewer) return respond({ error: 'Sala ou chave inválida.' }, 403);
      if (!live && request.method === 'GET') return respond({ ...serializeRoom(row), role: editor ? 'editor' : 'viewer' });
      if (!live && !editor) return respond({ error: 'A chave de supervisão permite apenas acompanhar.' }, 403);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(id));
      if (live) {
        const headers = new Headers(request.headers);
        headers.set('x-room-id', id);
        return stub.fetch(new Request('https://room.internal/connect', { method: 'GET', headers }));
      }
      const room = normalizeState(await readJson(request));
      const result = await stub.fetch('https://room.internal/save', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, room })
      });
      return respond(await result.json(), result.status);
    } catch (error) {
      if (error instanceof InputError) return respond({ error: error.message }, 400);
      console.error('MINIONU API:', error.message);
      return respond({ error: 'Não foi possível concluir a operação. Tente novamente.' }, 503);
    }
  }
};

export class RoomLiveUpdates {
  constructor(state, env) { this.state = state; this.env = env; this.queue = Promise.resolve(); }
  fetch(request) {
    // Serialize snapshots and writes per room to preserve the order of live events.
    const work = this.queue.then(() => this.handle(request));
    this.queue = work.catch(() => {});
    return work;
  }
  async handle(request) {
    const path = new URL(request.url).pathname;
    if (path === '/connect') {
      const id = request.headers.get('x-room-id');
      const row = await this.env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first();
      if (!row) return json({ error: 'Sala não encontrada.' }, 404);
      const history = await this.env.DB.prepare('SELECT revision, changes_json, created_at FROM room_events WHERE room_id = ? ORDER BY revision DESC LIMIT 50').bind(id).all();
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ type: 'snapshot', ...serializeRoom(row), recentEvents: history.results.map(event => ({ revision: event.revision, updatedAt: event.created_at, changes: JSON.parse(event.changes_json) })) }));
      return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'mun-live' } });
    }
    if (path === '/save' && request.method === 'POST') {
      const { id, room } = await request.json();
      const row = await this.env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first();
      if (!row) return json({ error: 'Sala não encontrada.' }, 404);
      const before = serializeRoom(row), changes = diffState(before, room);
      if (!changes.length) return json(before);
      const now = new Date().toISOString(), revision = row.revision + 1;
      await this.env.DB.batch([
        this.env.DB.prepare(`UPDATE rooms SET committee = ?, has_veto = ?, crisis_title = ?, crisis_details = ?, state_json = ?, revision = ?, updated_at = ? WHERE id = ?`)
          .bind(room.committee, room.hasVeto ? 1 : 0, room.crisisTitle, room.crisisDetails, JSON.stringify(room.state), revision, now, id),
        this.env.DB.prepare('INSERT INTO room_events (room_id, revision, changes_json, created_at) VALUES (?, ?, ?, ?)').bind(id, revision, JSON.stringify(changes), now)
      ]);
      const saved = { id, ...room, revision, createdAt: row.created_at, updatedAt: now };
      const message = JSON.stringify({ type: 'form-update', ...saved, changes, changedFields: changes.map(c => c.label) });
      for (const socket of this.state.getWebSockets()) {
        try { socket.send(message); } catch { /* Reconnection recovers the latest stored snapshot. */ }
      }
      return json(saved);
    }
    return json({ error: 'Rota não encontrada.' }, 404);
  }
  webSocketMessage(socket) { socket.close(1008, 'A conexão de supervisão recebe atualizações apenas.'); }
  webSocketClose(socket, code, reason) { socket.close(code, reason); }
  webSocketError(socket) { socket.close(1011, 'Erro de conexão.'); }
}

function json(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } }); }
class InputError extends Error {}
async function readJson(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new InputError('Envie JSON.');
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) throw new InputError('O formulário excede o limite de tamanho.');
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('Envie o formulário.');
  let bytes = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new InputError('O formulário excede o limite de tamanho.'); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); } catch { throw new InputError('JSON inválido.'); }
}
function text(value, max) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) throw new InputError(`Texto inválido ou maior que ${max} caracteres.`);
  return value;
}
function normalizeState(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('Formulário inválido.');
  const committee = text(body.committee, 20);
  if (!COMMITTEES.has(committee)) throw new InputError('Comitê inválido.');
  if (body.hasVeto !== undefined && typeof body.hasVeto !== 'boolean') throw new InputError('Escolha de veto inválida.');
  const state = body.state || {};
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new InputError('Dados das delegações inválidos.');
  const vetoCountries = state.vetoCountries || [], delegations = state.delegations || [];
  if (!Array.isArray(vetoCountries) || vetoCountries.some(c => !COUNTRIES.includes(c))) throw new InputError('País com veto inválido.');
  if (!Array.isArray(delegations) || delegations.length > 10) throw new InputError('Delegações inválidas.');
  const seen = new Set();
  return {
    committee, hasVeto: body.hasVeto === true, crisisTitle: text(body.crisisTitle, 500), crisisDetails: text(body.crisisDetails, 5000),
    state: {
      vetoCountries: COUNTRIES.filter(c => vetoCountries.includes(c)),
      delegations: delegations.map(d => {
        if (!d || !COUNTRIES.includes(d.country) || seen.has(d.country) || !VOTES.has(d.vote || '')) throw new InputError('Delegação ou voto inválido.');
        seen.add(d.country);
        return { country: d.country, comment: text(d.comment, 4000), vote: d.vote || '' };
      })
    }
  };
}
function serializeRoom(row) {
  return { id: row.id, committee: row.committee, hasVeto: Boolean(row.has_veto), crisisTitle: row.crisis_title, crisisDetails: row.crisis_details, state: JSON.parse(row.state_json), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}
function diffState(before, after) {
  const changes = [], labels = { committee: 'Comitê', hasVeto: 'Veto', crisisTitle: 'Crise', crisisDetails: 'Detalhamento e resolução' };
  for (const [key, label] of Object.entries(labels)) if (before[key] !== after[key]) changes.push({ field: key, label, before: before[key], after: after[key] });
  if (JSON.stringify(before.state.vetoCountries) !== JSON.stringify(after.state.vetoCountries)) changes.push({ field: 'vetoCountries', label: 'Países com veto', before: before.state.vetoCountries, after: after.state.vetoCountries });
  for (const delegation of after.state.delegations) {
    const previous = before.state.delegations.find(d => d.country === delegation.country) || { comment: '', vote: '' };
    if (delegation.comment !== previous.comment) changes.push({ field: 'comment', country: delegation.country, label: `${delegation.country}: comentário`, before: previous.comment, after: delegation.comment });
    if (delegation.vote !== previous.vote) changes.push({ field: 'vote', country: delegation.country, label: `${delegation.country}: voto`, before: VOTE_LABELS[previous.vote], after: VOTE_LABELS[delegation.vote] });
  }
  if (JSON.stringify(before.state.delegations.map(d => d.country)) !== JSON.stringify(after.state.delegations.map(d => d.country))) changes.push({ field: 'delegations', label: 'Delegações do comitê', before: before.state.delegations.map(d => d.country), after: after.state.delegations.map(d => d.country) });
  // Keep history messages compact; the current form snapshot retains the full text.
  const excerpt = value => typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value;
  return changes.map(change => ({ ...change, before: excerpt(change.before), after: excerpt(change.after) }));
}
function randomKey() { return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function sha256(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join(''); }
function constantTimeEqual(a, b) { if (a.length !== b.length) return false; let mismatch = 0; for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i); return mismatch === 0; }
