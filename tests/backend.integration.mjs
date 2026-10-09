import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { emptyForm, COMMITTEES } from '../committees.js';
test('D1 e Durable Objects: permissões DEV, usuários, crise persistida, reset e cópias antigas', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: 'backend/.test-build/index.js', compatibilityDate: '2026-10-07',
    d1Databases: { DB: 'isolated-test' }, durableObjects: { ROOMS: { className: 'RoomLiveUpdates', useSQLite: true }, DASHBOARD: { className: 'GlobalDashboard', useSQLite: true } },
    bindings: { INITIAL_EDITING_UNLOCK_AT: '2000-01-01T00:00:00.000Z', ALLOWED_ORIGINS: 'http://localhost:5500', DEV_USER: 'devlocal', DEV_PASSWORD: 'SenhaLocalParaTestes123', SUPERVISOR_USER: 'supervisorlocal', SUPERVISOR_PASSWORD: 'OutraSenhaLocalTestes123' }
  }));
  try {
    const db = await mf.getD1Database('DB');
    for (const filename of ['0001_rooms.sql', '0002_global_forms.sql', '0003_users.sql', '0004_dev_control.sql']) {
      const sql = await readFile(`backend/migrations/${filename}`, 'utf8');
      await db.batch(sql.split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
    }
    const api = async (path, method = 'GET', body, token) => {
      const response = await mf.dispatchFetch('http://local.test/api' + path, { method, headers: { Origin: 'http://localhost:5500', 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    const dev = await api('/auth/login', 'POST', { username: 'devlocal', password: 'SenhaLocalParaTestes123' });
    assert.equal(dev.status, 200); assert.equal(dev.data.user.role, 'dev');
    const supervisor = await api('/auth/login', 'POST', { username: 'supervisorlocal', password: 'OutraSenhaLocalTestes123' });
    assert.equal(supervisor.status, 200); assert.equal(supervisor.data.user.role, 'supervisor');
    const token = dev.data.token, other = supervisor.data.token;
    const sockets = [], messages = [];
    for (const c of COMMITTEES) {
      const response = await mf.dispatchFetch(`http://local.test/api/committees/${c.code}/live`, { headers: { Origin: 'http://localhost:5500', Upgrade: 'websocket' } });
      assert.equal(response.status, 101); const socket = response.webSocket; socket.accept();
      const received = []; socket.addEventListener('message', event => { if (event.data !== 'pong') received.push(JSON.parse(event.data)); }); sockets.push(socket); messages.push(received); socket.send('ping');
    }
    const delivered = async (predicate) => { const deadline = Date.now() + 3000; while (!messages.every(predicate)) { if (Date.now() > deadline) assert.fail('Aviso não chegou a todos os sockets.'); await new Promise(resolve => setTimeout(resolve, 10)); } };
    for (const path of ['/dev/status', '/dev/backup', '/users']) { assert.equal((await api(path)).status, 401); assert.equal((await api(path, 'GET', undefined, other)).status, 403); }
    assert.equal((await api('/dev/reset', 'POST', { confirmation: 'RESETAR TODOS' }, other)).status, 403);
    assert.equal((await api('/dashboard', 'GET', undefined, other)).data.committees.length, 8);
    const created = await api('/users', 'POST', { username: 'novo-supervisor', displayName: 'Teste', password: 'SenhaDoNovoUsuario123', role: 'supervisor' }, token);
    assert.equal(created.status, 201); assert.equal(created.data.user.role, 'supervisor');
    const newLogin = await api('/auth/login', 'POST', { username: 'novo-supervisor', password: 'SenhaDoNovoUsuario123' });
    assert.equal(newLogin.status, 200);
    assert.equal((await api('/users/' + created.data.user.id, 'PUT', { active: false }, token)).status, 200);
    assert.equal((await api('/auth/me', 'GET', undefined, newLogin.data.token)).status, 401);
    assert.equal((await api('/users/' + dev.data.user.id, 'PUT', { active: false }, token)).status, 409);
    const room = await api('/committees/CDH'); assert.equal(room.status, 200);
    const form = { ...room.data, crisisTitle: 'Dados anteriores ao reset' };
    assert.equal((await api('/committees/CDH', 'PUT', form)).status, 200);
    const started = await api('/crisis/start', 'POST', { title: 'Crise local', message: 'Aviso aos diretores' }, other);
    assert.equal(started.status, 200);
    await delivered(received => received.some(event => event.type === 'crisis-state' && event.notice?.id === started.data.system.crisis.id));
    assert.equal((await api('/crisis/start', 'POST', {}, other)).status, 409);
    for (const c of COMMITTEES) assert.equal((await api('/committees/' + c.code)).data.notice.id, started.data.system.crisis.id);
    assert.equal((await api('/dashboard', 'GET', undefined, token)).data.system.crisis.title, 'Crise local');
    const backup = await api('/dev/backup', 'GET', undefined, token);
    assert.equal(backup.status, 200); assert.equal(backup.data.dashboard.committees.find(c => c.committee === 'CDH').crisisTitle, form.crisisTitle); assert.ok(backup.data.events.length);
    assert.equal((await api('/dev/reset', 'POST', { confirmation: 'errada' }, token)).status, 400);
    assert.equal((await api('/committees/CDH')).data.crisisTitle, form.crisisTitle);
    const reset = await api('/dev/reset', 'POST', { confirmation: 'RESETAR TODOS' }, token);
    assert.equal(reset.status, 200); assert.equal(reset.data.resetCount, 8);
    await delivered(received => received.some(event => event.type === 'form-reset' && event.resetEpoch === reset.data.system.resetEpoch));
    for (const c of COMMITTEES) { const clean = (await api('/committees/' + c.code)).data; assert.equal(clean.resetEpoch, reset.data.system.resetEpoch); assert.equal(clean.crisisTitle, ''); assert.equal(clean.notice, null); assert.equal(clean.state.voting.history.length, 0); }
    assert.equal((await api('/committees/CDH', 'PUT', form)).status, 409);
    const fresh = (await api('/committees/CDH')).data; fresh.crisisTitle = 'Depois do reset';
    assert.equal((await api('/committees/CDH', 'PUT', fresh)).status, 200);
    assert.equal((await api('/users', 'GET', undefined, token)).data.users.length, 3);
    assert.ok((await api('/dev/status', 'GET', undefined, token)).data.audit.some(e => e.action === 'reset'));
    assert.equal((await api('/crisis/start', 'POST', { title: 'Nova crise', message: 'Segundo aviso' }, token)).status, 200);
    assert.equal((await api('/dev/crisis/end', 'POST', {}, token)).status, 200);
    assert.equal((await api('/committees/CDH')).data.notice, null);
    const oldCSNU = (await api('/committees/CSNU')).data;
    oldCSNU.state.delegations.pop();
    oldCSNU.state.delegations[0].comment = 'Informação anterior à inclusão do Reino Unido';
    oldCSNU.state.voting.history.push({ id: crypto.randomUUID(), recordedAt: '2026-10-08T00:00:00.000Z', proposal: 'Registro anterior', votes: oldCSNU.state.delegations.map((d, i) => ({ country: d.country, vote: i < 6 ? 'favoravel' : 'abstido' })), hasVeto: true, vetoCountries: oldCSNU.state.vetoCountries, visualDecision: '', result: 'approved' });
    await db.prepare('UPDATE committee_forms SET form_json = ? WHERE code = ?').bind(JSON.stringify(oldCSNU), 'CSNU').run();
    const csnu = (await api('/committees/CSNU')).data;
    assert.equal(csnu.state.delegations.length, 10);
    assert.equal(csnu.state.delegations[0].comment, oldCSNU.state.delegations[0].comment);
    csnu.state.delegations.find(d => d.country === 'Reino Unido').vote = 'contra';
    csnu.state.voting.history.push({ id: crypto.randomUUID(), recordedAt: new Date().toISOString(), proposal: 'Proposta vetada pelo Reino Unido', votes: csnu.state.delegations.map(d => ({ country: d.country, vote: d.vote })), hasVeto: true, vetoCountries: csnu.state.vetoCountries, visualDecision: 'approved', result: 'approved' });
    const vetoSave = await api('/committees/CSNU', 'PUT', csnu);
    assert.equal(vetoSave.status, 200); assert.equal(vetoSave.data.state.voting.history[0].result, 'approved'); assert.equal(vetoSave.data.state.voting.history[0].votes.length, 9); assert.equal(vetoSave.data.state.voting.history[1].result, 'rejected'); assert.deepEqual(vetoSave.data.state.voting.history[1].vetoes, ['Reino Unido']);
    const oldClient = structuredClone(vetoSave.data); oldClient.state.delegations.pop(); oldClient.crisisTitle = 'Cliente anterior';
    assert.equal((await api('/committees/CSNU', 'PUT', oldClient)).status, 200);
    assert.equal((await api('/committees/CSNU')).data.state.delegations.find(d => d.country === 'Reino Unido').vote, 'contra');
    const malformed = emptyForm('CDH'); malformed.state.delegations.pop();
    assert.equal((await api('/committees/CDH', 'PUT', malformed)).status, 400);
    assert.equal((await api('/dev/editing', 'POST', { locked: true, until: null }, other)).status, 403);
    assert.equal((await api('/dev/editing', 'POST', { locked: true, until: 'invalid' }, token)).status, 400);
    const locked = await api('/dev/editing', 'POST', { locked: true, until: null }, token);
    assert.equal(locked.status, 200); assert.equal(locked.data.editing.locked, true);
    await delivered(received => received.some(event => event.type === 'editing-state' && event.editing.changedAt === locked.data.editing.changedAt));
    const readable = await api('/committees/CDH'); assert.equal(readable.status, 200); assert.equal(readable.data.editing.locked, true);
    assert.equal((await api('/committees/CDH', 'PUT', readable.data)).status, 423);
    assert.equal((await api('/public/status')).data.editing.locked, true);
    assert.equal((await api('/dev/reset', 'POST', { confirmation: 'RESETAR TODOS' }, token)).status, 200);
    assert.equal((await api('/public/status')).data.editing.locked, true);
    assert.equal((await api('/dev/editing', 'POST', { locked: false }, token)).data.editing.locked, false);
    assert.equal((await api('/committees/CDH', 'PUT', (await api('/committees/CDH')).data)).status, 200);
    const deadline = new Date(Date.now() + 800).toISOString();
    assert.equal((await api('/dev/editing', 'POST', { locked: true, until: deadline }, token)).status, 200);
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.equal((await api('/public/status')).data.editing.locked, false);
    assert.equal((await api('/committees/CDH', 'PUT', (await api('/committees/CDH')).data)).status, 200);
    for (const socket of sockets) socket.close();
    let online = 1, attempts = 0;
    while (online && attempts++ < 30) { await new Promise(resolve => setTimeout(resolve, 20)); online = (await api('/dashboard', 'GET', undefined, token)).data.committees.find(c => c.committee === 'CDH').activeEditors; }
    assert.equal(online, 0);
  } finally { await mf.dispose(); }
});
