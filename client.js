import { API_BASE } from './config.js';
const apiUrl = path => { if (!API_BASE) throw new Error('O site ainda precisa ser publicado com a URL do servidor.'); return `${API_BASE.replace(/\/$/, '')}${path}`; };
async function call(path, method = 'GET', body, token) {
  const headers = { 'content-type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(apiUrl(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) { const error = new Error(data.error || 'Falha ao conectar.'); error.status = response.status; throw error; } return data;
}
export const login = (username, password) => call('/api/auth/login', 'POST', { username, password });
export const authStatus = () => call('/api/auth/status');
export const setupAccount = body => call('/api/auth/setup', 'POST', body);
export const currentUser = token => call('/api/auth/me', 'GET', undefined, token);
export const endSession = token => call('/api/auth/logout', 'POST', {}, token);
export const listUsers = (token, offset = 0) => call(`/api/users?offset=${offset}`, 'GET', undefined, token);
export const createUser = (token, body) => call('/api/users', 'POST', body, token);
export const updateUser = (token, id, body) => call(`/api/users/${encodeURIComponent(id)}`, 'PUT', body, token);
export const loadDashboard = token => call('/api/dashboard', 'GET', undefined, token);
export const startCrisis = (token, body) => call('/api/crisis/start', 'POST', body, token);
export const devStatus = token => call('/api/dev/status', 'GET', undefined, token);
export const exportBackup = token => call('/api/dev/backup', 'GET', undefined, token);
export const resetAll = token => call('/api/dev/reset', 'POST', { confirmation: 'RESETAR TODOS' }, token);
export const endCrisis = token => call('/api/dev/crisis/end', 'POST', {}, token);
export const loadForm = code => call(`/api/committees/${encodeURIComponent(code)}`);
export const saveForm = (code, form) => call(`/api/committees/${encodeURIComponent(code)}`, 'PUT', form);
function watch(path, token, onUpdate, onStatus) {
  let socket, timer, stopped = false, attempt = 0;
  function connect() {
    if (stopped) return; onStatus('connecting');
    try { const url = new URL(apiUrl(path)); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; socket = token ? new WebSocket(url, ['mun-live', `mun-auth.${token}`]) : new WebSocket(url); }
    catch (error) { onStatus('error', error.message); return; }
    socket.addEventListener('open', () => { attempt = 0; onStatus('connected'); });
    socket.addEventListener('message', event => { try { onUpdate(JSON.parse(event.data)); } catch {} });
    socket.addEventListener('close', event => {
      if (stopped) return;
      if (event.code === 1008 && token) { stopped = true; onStatus('expired'); return; }
      onStatus('reconnecting'); timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15000));
    });
    socket.addEventListener('error', () => onStatus('error', 'Sem conexão. Tentando reconectar…'));
  }
  connect(); return () => { stopped = true; clearTimeout(timer); socket?.close(); };
}
export const watchDashboard = (token, onUpdate, onStatus = () => {}) => watch('/api/dashboard/live', token, onUpdate, onStatus);
export const watchForm = (code, onUpdate, onStatus = () => {}) => watch(`/api/committees/${encodeURIComponent(code)}/live`, null, onUpdate, onStatus);
export function createAutosave(code, onStatus = () => {}) {
  let pending, timer, busy = false, stopped = false;
  async function flush() {
    timer = undefined; if (stopped || busy || !pending) return;
    busy = true; const snapshot = pending; pending = undefined; onStatus('saving'); let failed = false;
    try { const saved = await saveForm(code, snapshot); if (!pending) onStatus('saved', undefined, saved); }
    catch (error) { failed = true; pending ||= snapshot; if (error.status === 409) { stopped = true; pending = undefined; onStatus('reset', error.message); } else onStatus('error', error.message); }
    finally { busy = false; if (!stopped && pending) timer = setTimeout(flush, failed ? 2000 : 0); }
  }
  const enqueue = snapshot => { if (stopped) return; pending = snapshot; onStatus('pending'); if (!timer && !busy) timer = setTimeout(flush, 150); };
  enqueue.stop = () => { stopped = true; clearTimeout(timer); };
  enqueue.hasPending = () => Boolean(pending || busy);
  return enqueue;
}


