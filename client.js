import { API_BASE } from './config.js';
const apiUrl = path => { if (!API_BASE) throw new Error('O site ainda precisa ser publicado com a URL do servidor.'); return `${API_BASE.replace(/\/$/, '')}${path}`; };
async function call(path, method = 'GET', body, token) {
  const headers = { 'content-type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(apiUrl(path), { method, headers, signal: controller.signal, body: body === undefined ? undefined : JSON.stringify(body) });
    let data;
    try { data = await response.json(); } catch { throw new Error('O servidor não enviou uma resposta válida. Tente novamente.'); }
    if (!response.ok) { const error = new Error(data.error || 'Falha ao conectar.'); error.status = response.status; error.snapshot = data.snapshot; throw error; }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('O servidor demorou para responder. Tente novamente.');
    throw error;
  } finally { clearTimeout(timeout); }
}
export const login = (username, password) => call('/api/auth/login', 'POST', { username, password });
export const loadDashboard = token => call('/api/dashboard', 'GET', undefined, token);
export const loadForm = code => call(`/api/committees/${encodeURIComponent(code)}`);
export const saveForm = (code, form) => call(`/api/committees/${encodeURIComponent(code)}`, 'PUT', form);
export const finalizeProposal = (code, form, requestId) => call(`/api/committees/${encodeURIComponent(code)}/proposals`, 'POST', { ...form, requestId });
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
  let pending, timer, inFlight, stopped = false;
  function flush() {
    timer = undefined; if (stopped || inFlight || !pending) return;
    const snapshot = pending; pending = undefined; onStatus('saving');
    let failed = false, retry = true;
    inFlight = saveForm(code, snapshot).then(saved => {
      if (!stopped && !pending) onStatus('saved', undefined, saved);
    }).catch(error => {
      if (stopped) return;
      if (error.status === 409) {
        stopped = true; pending = undefined;
        onStatus('conflict', error.message, error.snapshot);
        return;
      }
      failed = true; pending ||= snapshot;
      retry = !error.status || error.status >= 500 || error.status === 429;
      onStatus(retry ? 'error' : 'rejected', error.message);
    }).finally(() => {
      inFlight = undefined;
      if (!stopped && pending && retry) timer = setTimeout(flush, failed ? 2000 : 0);
    });
  }
  const enqueue = snapshot => { if (stopped) return; pending = snapshot; onStatus('pending'); if (!timer && !inFlight) timer = setTimeout(flush, 150); };
  // Wait for a PUT already sent before posting a completed voting round.
  enqueue.stop = () => { stopped = true; clearTimeout(timer); pending = undefined; return inFlight || Promise.resolve(); };
  enqueue.hasPending = () => Boolean(pending || inFlight);
  return enqueue;
}
