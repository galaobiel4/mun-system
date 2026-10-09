import test from 'node:test';
import assert from 'node:assert/strict';
import { activeEditors, PRESENCE_TTL } from '../backend/src/presence.js';
import { editingStatus } from '../backend/src/control.js';
import { mergePresence } from '../presence-state.js';
import { RoomLiveUpdates } from '../backend/src/index.js';
test('bloqueio libera exatamente no horário definido pelo servidor', () => {
  const until = '2026-10-09T11:00:00.000Z', end = Date.parse(until);
  const system = { editingLock: { enabled: true, until, changedAt: 'fixture' } };
  assert.equal(editingStatus(system, end - 1).locked, true);
  assert.equal(editingStatus(system, end).locked, false);
  assert.equal(editingStatus(system, end + 1).locked, false);
  assert.equal(editingStatus({ editingLock: { enabled: true, until: null } }, end).locked, true);
  assert.equal(editingStatus({ editingLock: { enabled: false, until: null } }, end).locked, false);
});
test('contagem antiga não reabre presença já encerrada', () => {
  const closed = { activeEditors: 0, presenceAt: 200, presenceLastSeen: null };
  assert.deepEqual(mergePresence(closed, { activeEditors: 1, presenceAt: 100, presenceLastSeen: 100 }), closed);
  assert.equal(mergePresence(closed, { activeEditors: 1, presenceAt: 300, presenceLastSeen: 290 }).activeEditors, 1);
  assert.deepEqual(mergePresence(closed, { activeEditors: 1 }), closed);
});
test('heartbeat respeita o vencimento da conexão mais antiga e alarme publica zero', async () => {
  const now = Date.now(); let alarmAt, sockets, published = [];
  const socket = lastSeen => { let attachment = { code: 'CDH', lastSeen }; return { readyState: 1, deserializeAttachment: () => attachment, serializeAttachment: value => { attachment = value; }, send() {}, close() { this.readyState = 3; } }; };
  const old = socket(now - PRESENCE_TTL + 10000), fresh = socket(now); sockets = [old, fresh];
  const state = { getWebSockets: () => sockets, waitUntil() {}, storage: { get: async () => 'CDH', put: async () => {}, setAlarm: async time => { alarmAt = time; }, deleteAlarm: async () => { alarmAt = null; } } };
  const env = { DASHBOARD: { idFromName: value => value, get: () => ({ fetch: async (_url, options) => { published.push(JSON.parse(options.body)); return Response.json({ ok: true }); } }) } };
  const room = new RoomLiveUpdates(state, env);
  await room.webSocketMessage(fresh, 'ping');
  assert.equal(alarmAt, old.deserializeAttachment().lastSeen + PRESENCE_TTL);
  sockets = []; await room.alarm();
  assert.equal(published.at(-1).activeEditors, 0); assert.equal(alarmAt, null); assert.ok(published.at(-1).presenceAt);
});
test('presença expira conexões sem resposta, antigas ou fechadas', () => {
  const now = 200000, socket = (lastSeen, readyState = 1) => ({ readyState, deserializeAttachment: () => ({ lastSeen }) });
  const live = socket(now - 100), stale = socket(now - PRESENCE_TTL), legacy = socket(undefined), closed = socket(now, 3);
  assert.deepEqual(activeEditors([live, stale, legacy, closed], now), [live]);
  assert.deepEqual(activeEditors([live], now, live), []);
});
