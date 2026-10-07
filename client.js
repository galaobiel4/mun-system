import { API_BASE } from './config.js';

function apiUrl(path) {
  if (!API_BASE) throw new Error('Configure a URL da API em config.js para ativar o acompanhamento ao vivo.');
  return `${API_BASE.replace(/\/$/, '')}${path}`;
}
async function call(path, method, key, body) {
  const headers = { 'content-type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const response = await fetch(apiUrl(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Falha ao conectar à sala.');
  return data;
}
export const createRoom = state => call('/api/rooms', 'POST', null, state);
export const loadRoom = (id, key) => call(`/api/rooms/${encodeURIComponent(id)}`, 'GET', key);
export const saveRoom = (id, key, state) => call(`/api/rooms/${encodeURIComponent(id)}`, 'PUT', key, state);

export function watchRoom(id, key, onUpdate, onStatus = () => {}) {
  let socket, retry, stopped = false, attempt = 0;
  function connect() {
    if (stopped) return;
    onStatus('connecting');
    try {
      const url = new URL(apiUrl(`/api/rooms/${encodeURIComponent(id)}/live`));
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url, ['mun-live', `mun-auth.${key}`]);
    } catch (error) { onStatus('error', error.message); return; }
    socket.addEventListener('open', () => { attempt = 0; onStatus('connected'); });
    socket.addEventListener('message', event => {
      try { const update = JSON.parse(event.data); if (['snapshot', 'form-update'].includes(update.type)) onUpdate(update); } catch { /* Ignore malformed frames. */ }
    });
    socket.addEventListener('close', () => {
      if (stopped) return;
      onStatus('reconnecting');
      retry = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15000));
    });
    socket.addEventListener('error', () => onStatus('error', 'Conexão interrompida. Tentando reconectar…'));
  }
  connect();
  return () => { stopped = true; clearTimeout(retry); socket?.close(); };
}

// Send ordered snapshots at most every 150 ms, even during continuous typing.
// Retain the last unsaved snapshot and retry automatically after network failure.
export function createAutosave(id, key, onStatus = () => {}) {
  let pending, timer, inFlight = false, stopped = false;
  async function flush() {
    timer = undefined;
    if (stopped || inFlight || !pending) return;
    inFlight = true; const snapshot = pending; pending = undefined;
    onStatus('saving');
    let failed = false;
    try { await saveRoom(id, key, snapshot); if (!pending) onStatus('saved'); }
    catch (error) { failed = true; pending ||= snapshot; onStatus('error', error.message); }
    finally { inFlight = false; if (!stopped && pending) timer = setTimeout(flush, failed ? 2000 : 0); }
  }
  const enqueue = snapshot => {
    if (stopped) return;
    pending = snapshot; onStatus('pending');
    if (!timer && !inFlight) timer = setTimeout(flush, 150);
  };
  enqueue.stop = () => { stopped = true; clearTimeout(timer); };
  enqueue.hasPending = () => Boolean(pending || inFlight);
  return enqueue;
}
