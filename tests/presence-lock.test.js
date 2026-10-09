import test from 'node:test';
import assert from 'node:assert/strict';
import { activeEditors, PRESENCE_TTL } from '../backend/src/presence.js';
import { editingStatus } from '../backend/src/control.js';
test('bloqueio libera exatamente no horário definido pelo servidor', () => {
  const until = '2026-10-09T11:00:00.000Z', end = Date.parse(until);
  const system = { editingLock: { enabled: true, until, changedAt: 'fixture' } };
  assert.equal(editingStatus(system, end - 1).locked, true);
  assert.equal(editingStatus(system, end).locked, false);
  assert.equal(editingStatus(system, end + 1).locked, false);
  assert.equal(editingStatus({ editingLock: { enabled: true, until: null } }, end).locked, true);
  assert.equal(editingStatus({ editingLock: { enabled: false, until: null } }, end).locked, false);
});
test('presença expira conexões sem resposta, antigas ou fechadas', () => {
  const now = 200000, socket = (lastSeen, readyState = 1) => ({ readyState, deserializeAttachment: () => ({ lastSeen }) });
  const live = socket(now - 100), stale = socket(now - PRESENCE_TTL), legacy = socket(undefined), closed = socket(now, 3);
  assert.deepEqual(activeEditors([live, stale, legacy, closed], now), [live]);
  assert.deepEqual(activeEditors([live], now, live), []);
});
