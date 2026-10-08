import { COMMITTEES, COUNTRIES, committeeByCode, emptyForm } from '../../committees.js';
import { calculateVote } from '../../voting.js';
const MAX_BODY = 64000, SESSION_MS = 8 * 60 * 60 * 1000;
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
    if (url.pathname === '/api/health') return respond({ ok: true });
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (!allowed) return respond({ error: 'Origem não autorizada.' }, 403);
    try {
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        if (!env.SUPERVISOR_USER || !env.SUPERVISOR_PASSWORD) return respond({ error: 'O administrador ainda precisa ativar o login do painel no servidor.' }, 503);
        const fingerprint = base64(await digest(request.headers.get('CF-Connecting-IP') || 'local'));
        const limit = await env.DASHBOARD.get(env.DASHBOARD.idFromName('all-committees')).fetch('https://dashboard.internal/login-attempt', { method: 'POST', body: JSON.stringify({ fingerprint }) });
        if (limit.status === 429) return respond({ error: 'Muitas tentativas. Aguarde um minuto e tente novamente.' }, 429);
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('Login inválido.');
        const user = text(body.username, 100), password = text(body.password, 200);
        if (!equal(await digest(user), await digest(env.SUPERVISOR_USER)) || !equal(await digest(password), await digest(env.SUPERVISOR_PASSWORD))) return respond({ error: 'Login ou senha inválidos.' }, 401);
        const expiresAt = Date.now() + SESSION_MS;
        return respond({ token: await makeToken(env, expiresAt), expiresAt });
      }
      if (url.pathname === '/api/dashboard' || url.pathname === '/api/dashboard/live') {
        if (request.method !== 'GET') return respond({ error: 'Método não permitido.' }, 405);
        const live = url.pathname.endsWith('/live');
        const token = live ? wsCredential(request) : request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
        const session = await verifyToken(env, token);
        if (!session) return respond({ error: 'Entre com login e senha para acompanhar os comitês.' }, 401);
        if (live && request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return respond({ error: 'Esta rota exige WebSocket.' }, 426);
        const stub = env.DASHBOARD.get(env.DASHBOARD.idFromName('all-committees'));
        const headers = new Headers(request.headers); headers.set('x-session-expires', String(session.expiresAt));
        const response = await stub.fetch(new Request(`https://dashboard.internal/${live ? 'connect' : 'snapshot'}`, { headers }));
        return live ? response : respond(await response.json(), response.status);
      }
      const match = url.pathname.match(/^\/api\/committees\/([A-Z0-9_-]+)(\/live|\/proposals)?$/);
      if (!match || !committeeByCode(match[1])) return respond({ error: 'Comitê não encontrado.' }, 404);
      const [, code, suffix] = match, live = suffix === '/live', finalizing = suffix === '/proposals';
      if (!(live ? request.method === 'GET' : finalizing ? request.method === 'POST' : ['GET', 'PUT'].includes(request.method))) return respond({ error: 'Método não permitido.' }, 405);
      if (live && request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return respond({ error: 'Esta rota exige WebSocket.' }, 426);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(`committee:${code}`));
      const headers = new Headers(request.headers); headers.set('x-committee-code', code);
      let form;
      if (request.method === 'PUT' || finalizing) {
        const body = await readJson(request);
        form = normalize(body, code);
        if (finalizing) {
          if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)) throw new InputError('Identificador da proposta inválido.');
          form.requestId = body.requestId.toLowerCase();
        }
      }
      const response = await stub.fetch(new Request(`https://committee.internal/${live ? 'connect' : finalizing ? 'finalize' : form ? 'save' : 'snapshot'}`, { method: form ? 'POST' : 'GET', headers, body: form ? JSON.stringify(form) : undefined }));
      return live ? response : respond(await response.json(), response.status);
    } catch (error) {
      if (error instanceof InputError) return respond({ error: error.message }, 400);
      console.error('MINIONU:', error.message);
      return respond({ error: 'Não foi possível concluir a operação. Tente novamente.' }, 503);
    }
  }
};

export class RoomLiveUpdates {
  constructor(state, env) { this.state = state; this.env = env; this.queue = Promise.resolve(); }
  fetch(request) {
    if (new URL(request.url).pathname === '/presence') return json({ activeEditors: this.active() });
    const work = this.queue.then(() => this.handle(request)); this.queue = work.catch(() => {}); return work;
  }
  active(exclude) { return this.state.getWebSockets().filter(socket => socket !== exclude && socket.readyState === 1).length; }
  async handle(request) {
    const code = request.headers.get('x-committee-code');
    if (!committeeByCode(code)) return json({ error: 'Comitê inválido.' }, 400);
    let row = await this.env.DB.prepare('SELECT * FROM committee_forms WHERE code = ?').bind(code).first();
    if (!row) {
      const now = new Date().toISOString();
      await this.env.DB.prepare('INSERT INTO committee_forms (code, form_json, revision, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').bind(code, JSON.stringify(emptyForm(code)), now, now).run();
      row = await this.env.DB.prepare('SELECT * FROM committee_forms WHERE code = ?').bind(code).first();
    }
    const history = await this.env.DB.prepare('SELECT proposal_json FROM committee_proposals WHERE committee_code = ? ORDER BY voting_round DESC').bind(code).all();
    const proposals = history.results.map(proposal => JSON.parse(proposal.proposal_json));
    const snapshot = () => ({ ...formSnapshot(row, proposals), activeEditors: this.active() });
    const path = new URL(request.url).pathname;
    if (path === '/snapshot') return json(snapshot());
    if (path === '/connect') {
      const pair = new WebSocketPair(); this.state.acceptWebSocket(pair[1]); pair[1].serializeAttachment({ code });
      pair[1].send(JSON.stringify({ type: 'form-snapshot', ...snapshot() }));
      await this.publish({ type: 'presence', committee: code, activeEditors: this.active() });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if ((path === '/save' || path === '/finalize') && request.method === 'POST') {
      const body = await request.json(), form = normalize(body, code), before = hydrateForm(JSON.parse(row.form_json), code);
      // A retried submission returns the saved result even after the next round starts.
      if (path === '/finalize' && proposals.some(proposal => proposal.id === body.requestId)) return json(snapshot());
      if (form.votingRound !== before.votingRound) return json({ error: 'Esta votação já foi encerrada ou está desatualizada. O formulário foi atualizado; confira a nova proposta antes de votar.', snapshot: snapshot() }, 409);
      let proposal;
      if (path === '/finalize') {
        const result = calculateVote(code, form.state.delegations);
        if (!form.proposalText.trim()) return json({ error: 'Escreva o texto da proposta antes de encerrar a votação.' }, 400);
        if (result.status === 'pending') return json({ error: 'Registre o voto de todas as delegações antes de encerrar a votação.' }, 400);
        proposal = { id: body.requestId, committee: code, proposalText: form.proposalText.trim(), crisisTitle: form.crisisTitle, crisisDetails: form.crisisDetails, delegations: form.state.delegations.map(delegation => ({ ...delegation })), ...result, createdAt: new Date().toISOString(), votingRound: form.votingRound };
        form.proposalText = '';
        form.votingRound++;
        form.state.delegations = form.state.delegations.map(delegation => ({ ...delegation, vote: '' }));
      }
      const changes = diff(before, form);
      if (proposal) {
        const labels = { approved: 'aprovada', denied: 'negada', vetoed: 'vetada' };
        changes.push({ field: 'proposal', label: `Proposta ${labels[proposal.status]}`, proposalId: proposal.id, status: proposal.status, before: null, after: proposal.proposalText.slice(0, 200) });
      }
      if (!changes.length) return json(snapshot());
      const now = new Date().toISOString(), revision = row.revision + 1;
      await this.env.DB.batch([
        ...(proposal ? [this.env.DB.prepare('INSERT INTO committee_proposals (committee_code, id, voting_round, proposal_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(code, proposal.id, proposal.votingRound, JSON.stringify(proposal), proposal.createdAt)] : []),
        this.env.DB.prepare('UPDATE committee_forms SET form_json = ?, revision = ?, updated_at = ? WHERE code = ?').bind(JSON.stringify(form), revision, now, code),
        this.env.DB.prepare('INSERT INTO committee_events (committee_code, revision, changes_json, created_at) VALUES (?, ?, ?, ?)').bind(code, revision, JSON.stringify(changes), now)
      ]);
      const saved = { ...form, proposals: proposal ? [proposal, ...proposals] : proposals, revision, updatedAt: now, createdAt: row.created_at, activeEditors: this.active() };
      const message = { type: 'form-update', ...saved, changes };
      for (const socket of this.state.getWebSockets()) { try { socket.send(JSON.stringify(message)); } catch {} }
      await this.publish(message);
      return json(saved);
    }
    return json({ error: 'Rota não encontrada.' }, 404);
  }
  async publish(event) {
    try {
      const response = await this.env.DASHBOARD.get(this.env.DASHBOARD.idFromName('all-committees')).fetch('https://dashboard.internal/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
      if (!response.ok) console.error('MINIONU: painel temporariamente indisponível:', response.status);
    } catch (error) { console.error('MINIONU: atualização do painel pendente:', error.message); }
  }
  webSocketMessage(socket) { socket.close(1008, 'Esta conexão recebe atualizações apenas.'); }
  async webSocketClose(socket, code, reason) {
    const attachment = socket.deserializeAttachment(); socket.close([1005, 1006, 1015].includes(code) ? 1000 : code, reason);
    if (attachment) await this.publish({ type: 'presence', committee: attachment.code, activeEditors: this.active(socket) });
  }
  async webSocketError(socket) {
    const attachment = socket.deserializeAttachment(); socket.close(1011, 'Erro de conexão.');
    if (attachment) await this.publish({ type: 'presence', committee: attachment.code, activeEditors: this.active(socket) });
  }
}

export class GlobalDashboard {
  constructor(state, env) { this.state = state; this.env = env; this.queue = Promise.resolve(); }
  fetch(request) { const work = this.queue.then(() => this.handle(request)); this.queue = work.catch(() => {}); return work; }
  async snapshot() {
    const rows = await this.env.DB.prepare('SELECT * FROM committee_forms').all();
    const proposals = await this.env.DB.prepare('SELECT committee_code, proposal_json FROM committee_proposals ORDER BY voting_round DESC').all();
    const presence = await Promise.all(COMMITTEES.map(async committee => {
      const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(`committee:${committee.code}`)).fetch('https://committee.internal/presence'); return response.json();
    }));
    const history = await this.env.DB.prepare('SELECT committee_code, revision, changes_json, created_at FROM committee_events ORDER BY created_at DESC LIMIT 50').all();
    return {
      type: 'dashboard-snapshot',
      committees: COMMITTEES.map((committee, index) => {
        const row = rows.results.find(r => r.code === committee.code);
        const history = proposals.results.filter(proposal => proposal.committee_code === committee.code).map(proposal => JSON.parse(proposal.proposal_json));
        return { ...(row ? formSnapshot(row, history) : { ...emptyForm(committee.code), proposals: history, revision: 0, updatedAt: null }), name: committee.name, activeEditors: presence[index].activeEditors };
      }),
      recentEvents: history.results.map(event => ({ committee: event.committee_code, revision: event.revision, updatedAt: event.created_at, changes: JSON.parse(event.changes_json) }))
    };
  }
  async handle(request) {
    const path = new URL(request.url).pathname;
    if (path === '/login-attempt' && request.method === 'POST') {
      const { fingerprint } = await request.json(), key = `login:${fingerprint}`, window = Math.floor(Date.now() / 60000);
      const previous = await this.state.storage.get(key);
      const count = previous?.window === window ? previous.count : 0;
      if (count >= 8) return json({ error: 'Limite de tentativas.' }, 429);
      await this.state.storage.put(key, { window, count: count + 1 });
      return json({ ok: true });
    }
    if (path === '/snapshot') return json(await this.snapshot());
    if (path === '/connect') {
      const data = await this.snapshot(), pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]); pair[1].serializeAttachment({ expiresAt: Number(request.headers.get('x-session-expires')) });
      pair[1].send(JSON.stringify(data));
      return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'mun-live' } });
    }
    if (path === '/update' && request.method === 'POST') {
      const event = await request.json();
      for (const socket of this.state.getWebSockets()) {
        try { if (socket.deserializeAttachment().expiresAt <= Date.now()) socket.close(1008, 'Sessão expirada.'); else socket.send(JSON.stringify(event)); } catch {}
      }
      return json({ ok: true });
    }
    return json({ error: 'Rota não encontrada.' }, 404);
  }
  webSocketMessage(socket) { socket.close(1008, 'Painel somente para acompanhamento.'); }
  webSocketClose(socket, code, reason) { socket.close([1005, 1006, 1015].includes(code) ? 1000 : code, reason); }
  webSocketError(socket) { socket.close(1011, 'Erro de conexão.'); }
}

function formSnapshot(row, proposals = []) { return { ...hydrateForm(JSON.parse(row.form_json), row.code), proposals, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }

// Existing rows predate proposal drafts, rounds, and server-owned voting rules.
function hydrateForm(saved, code) {
  const form = emptyForm(code), cleanText = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
  form.crisisTitle = cleanText(saved?.crisisTitle, 500);
  form.crisisDetails = cleanText(saved?.crisisDetails, 5000);
  form.proposalText = cleanText(saved?.proposalText, 5000);
  form.votingRound = Number.isSafeInteger(saved?.votingRound) && saved.votingRound >= 0 ? saved.votingRound : 0;
  const delegations = Array.isArray(saved?.state?.delegations) ? saved.state.delegations : [];
  form.state.delegations = form.state.delegations.map(delegation => {
    const previous = delegations.find(candidate => candidate?.country === delegation.country);
    return { ...delegation, comment: cleanText(previous?.comment, 4000), vote: VOTES.has(previous?.vote) ? previous.vote : '' };
  });
  return form;
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
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.committee !== code) throw new InputError('Formulário inválido.');
  const state = body.state;
  if (!state || !Array.isArray(state.delegations)) throw new InputError('Delegações inválidas.');
  const expected = COUNTRIES.slice(0, committeeByCode(code).countries);
  if (state.delegations.length !== expected.length || expected.some(country => state.delegations.filter(d => d?.country === country).length !== 1)) throw new InputError('Lista de delegações inválida.');
  const votingRound = body.votingRound === undefined ? 0 : body.votingRound;
  if (!Number.isSafeInteger(votingRound) || votingRound < 0 || votingRound >= Number.MAX_SAFE_INTEGER) throw new InputError('Rodada de votação inválida.');
  const form = emptyForm(code);
  return { ...form, crisisTitle: text(body.crisisTitle, 500), crisisDetails: text(body.crisisDetails, 5000), proposalText: text(body.proposalText, 5000), votingRound, state: { vetoCountries: form.state.vetoCountries, delegations: expected.map(country => { const d = state.delegations.find(d => d.country === country); if (!VOTES.has(d.vote)) throw new InputError('Voto inválido.'); return { country, vote: d.vote, comment: text(d.comment, 4000) }; }) } };
}
function diff(before, after) {
  const changes = [], labels = { hasVeto: 'Veto', crisisTitle: 'Crise', crisisDetails: 'Detalhamento e resolução', proposalText: 'Proposta em votação', votingRound: 'Rodada de votação' };
  for (const [field, label] of Object.entries(labels)) if (before[field] !== after[field]) changes.push({ field, label, before: before[field], after: after[field] });
  if (JSON.stringify(before.state.vetoCountries) !== JSON.stringify(after.state.vetoCountries)) changes.push({ field: 'vetoCountries', label: 'Países com veto', before: before.state.vetoCountries, after: after.state.vetoCountries });
  for (const d of after.state.delegations) { const previous = before.state.delegations.find(p => p.country === d.country); if (d.comment !== previous.comment) changes.push({ field: 'comment', country: d.country, label: `${d.country}: comentário`, before: previous.comment, after: d.comment }); if (d.vote !== previous.vote) changes.push({ field: 'vote', country: d.country, label: `${d.country}: voto`, before: VOTE_LABELS[previous.vote], after: VOTE_LABELS[d.vote] }); }
  const excerpt = value => typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value;
  return changes.map(c => ({ ...c, before: excerpt(c.before), after: excerpt(c.after) }));
}
function wsCredential(request) { return (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(s => s.trim()).find(s => s.startsWith('mun-auth.'))?.slice(9); }
async function digest(value) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
function equal(a, b) { if (a.length !== b.length) return false; let mismatch = 0; for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i]; return mismatch === 0; }
function base64(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unbase64(value) { const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); }
async function signingKey(env) { return crypto.subtle.importKey('raw', await digest(`${env.SUPERVISOR_USER}\0${env.SUPERVISOR_PASSWORD}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
async function makeToken(env, expiresAt) { const payload = base64(new TextEncoder().encode(JSON.stringify({ expiresAt, nonce: crypto.randomUUID() }))); const signature = await crypto.subtle.sign('HMAC', await signingKey(env), new TextEncoder().encode(payload)); return `${payload}.${base64(new Uint8Array(signature))}`; }
async function verifyToken(env, token) {
  if (!env.SUPERVISOR_USER || !env.SUPERVISOR_PASSWORD || !token || token.length > 1000) return null;
  try { const [payload, signature, extra] = token.split('.'); if (!payload || !signature || extra) return null; const valid = await crypto.subtle.verify('HMAC', await signingKey(env), unbase64(signature), new TextEncoder().encode(payload)); if (!valid) return null; const session = JSON.parse(new TextDecoder().decode(unbase64(payload))); return Number.isFinite(session.expiresAt) && session.expiresAt > Date.now() ? session : null; } catch { return null; }
}
