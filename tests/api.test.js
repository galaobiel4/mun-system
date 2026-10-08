import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { emptyForm } from '../committees.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
const origin = 'http://127.0.0.1:5500';
let temporary, config, persist, base, runtime, runtimeOutput = '';

function localEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(CLOUDFLARE_|CF_API_|SUPERVISOR_)/.test(key)));
  return { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false', XDG_CONFIG_HOME: temporary };
}

async function command(args) {
  const child = spawn(process.execPath, [wrangler, ...args], {
    cwd: temporary, env: localEnvironment(), stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, `Wrangler command failed:\n${output}`);
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startRuntime() {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  runtimeOutput = '';
  runtime = spawn(process.execPath, [wrangler, 'dev', '--local', '--config', config,
    '--persist-to', persist, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0'], {
    cwd: temporary, env: localEnvironment(), detached: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  for (const stream of [runtime.stdout, runtime.stderr]) {
    stream.on('data', chunk => { runtimeOutput = (runtimeOutput + chunk).slice(-30000); });
  }
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (runtime.exitCode !== null) throw new Error(`Local API exited:\n${runtimeOutput}`);
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await delay(150);
  }
  throw new Error(`Local API did not start:\n${runtimeOutput}`);
}

async function stopRuntime() {
  if (!runtime || runtime.exitCode !== null) return;
  const exited = once(runtime, 'exit');
  process.kill(-runtime.pid, 'SIGTERM');
  const stopped = await Promise.race([exited.then(() => true), delay(5000).then(() => false)]);
  if (!stopped) {
    process.kill(-runtime.pid, 'SIGKILL');
    await exited;
  }
  runtime = null;
}

async function api(code, method = 'GET', body, suffix = '') {
  const response = await fetch(`${base}/api/committees/${code}${suffix}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  return { status: response.status, body: await response.json() };
}

async function snapshot(code) {
  const response = await api(code);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

function proposal(form, vote = 'favoravel', text = 'Proposta para votação') {
  const body = structuredClone(form);
  body.proposalText = text;
  body.state.delegations.forEach(delegation => { delegation.vote = vote; });
  return { ...body, requestId: randomUUID() };
}

const finalize = (body) => api(body.committee, 'POST', body, '/proposals');
let approvedRequest, approvedSnapshot, deniedRequest, finalCdh, finalCsnu;

describe('proposal API with isolated local Wrangler and D1', { concurrency: false }, () => {
  before(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'mun-voting-test-'));
    persist = join(temporary, 'state');
    config = join(temporary, 'wrangler.toml');
    // Keep production bindings/migrations while locating the test config away
    // from .dev.vars, local state, and any user's Wrangler credentials.
    const original = await readFile(join(root, 'backend/wrangler.toml'), 'utf8');
    const isolated = original
      .replace('main = "src/index.js"', `main = ${JSON.stringify(join(root, 'backend/src/index.js'))}`)
      .replace('migrations_dir = "migrations"', `migrations_dir = ${JSON.stringify(join(root, 'backend/migrations'))}`);
    await writeFile(config, isolated);
    await command(['d1', 'migrations', 'apply', 'minionu', '--local', '--config', config, '--persist-to', persist]);
    await startRuntime();
  }, { timeout: 120000 });

  after(async () => {
    await stopRuntime();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  });

  test('a proposal draft and delegation notes survive a fresh read', async () => {
    const initial = await snapshot('CDH');
    assert.deepEqual(initial.proposals, []);
    assert.equal(initial.votingRound, 0);
    const draft = structuredClone(initial);
    draft.proposalText = '  Garantir acesso à educação.  ';
    draft.crisisTitle = 'Acesso à educação';
    draft.crisisDetails = 'Resolver a falta de vagas.';
    draft.state.delegations[0].comment = 'Delegação apresentou a proposta.';
    draft.state.delegations[0].vote = 'favoravel';
    const saved = await api('CDH', 'PUT', draft);
    assert.equal(saved.status, 200);
    const reloaded = await snapshot('CDH');
    assert.equal(reloaded.proposalText.trim(), draft.proposalText.trim());
    assert.equal(reloaded.state.delegations[0].comment, draft.state.delegations[0].comment);
    assert.equal(reloaded.state.delegations[0].vote, 'favoravel');
    assert.deepEqual(reloaded.proposals, []);
  });

  test('blank and unfinished proposals are rejected without changing state', async () => {
    const before = await snapshot('CDH');
    const blank = proposal(before, 'favoravel', ' \n\t ');
    assert.equal((await finalize(blank)).status, 400);
    const unfinished = proposal(before);
    unfinished.state.delegations[1].vote = '';
    assert.equal((await finalize(unfinished)).status, 400);
    assert.deepEqual(await snapshot('CDH'), before);
  });

  test('approval stores an immutable ballot and resets only the next proposal', async () => {
    const before = await snapshot('CDH');
    approvedRequest = proposal(before, 'favoravel', 'Garantir acesso à educação.');
    // Client-supplied results and history must never decide the saved outcome.
    approvedRequest.status = 'vetoed';
    approvedRequest.counts = { favoravel: 0, contra: 9 };
    approvedRequest.proposals = [{ id: 'forged', status: 'vetoed' }];
    const response = await finalize(approvedRequest);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    approvedSnapshot = response.body;
    assert.equal(approvedSnapshot.proposals.length, 1);
    const entry = approvedSnapshot.proposals[0];
    assert.equal(entry.id, approvedRequest.requestId);
    assert.equal(entry.status, 'approved');
    assert.equal(entry.proposalText, approvedRequest.proposalText);
    assert.deepEqual(entry.delegations, approvedRequest.state.delegations);
    assert.deepEqual(entry.counts, { favoravel: 9, contra: 0, abstido: 0, pending: 0 });
    assert.equal(entry.crisisTitle, approvedRequest.crisisTitle);
    assert.equal(entry.crisisDetails, approvedRequest.crisisDetails);
    assert.ok(Number.isFinite(Date.parse(entry.createdAt)));
    assert.equal(approvedSnapshot.votingRound, before.votingRound + 1);
    assert.equal(approvedSnapshot.proposalText, '');
    assert.ok(approvedSnapshot.state.delegations.every(d => d.vote === ''));
    assert.equal(approvedSnapshot.state.delegations[0].comment, before.state.delegations[0].comment);
    assert.equal(approvedSnapshot.crisisTitle, before.crisisTitle);
    assert.deepEqual((await snapshot('CDH')).proposals, approvedSnapshot.proposals);
  });

  test('retrying a completed submission does not append or increment a round', async () => {
    const retry = await finalize(approvedRequest);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.votingRound, approvedSnapshot.votingRound);
    assert.equal(retry.body.revision, approvedSnapshot.revision);
    assert.deepEqual(retry.body.proposals, approvedSnapshot.proposals);
  });

  test('stale saves and submissions return the current snapshot with HTTP 409', async () => {
    for (const response of [
      await api('CDH', 'PUT', approvedRequest),
      await finalize({ ...approvedRequest, requestId: randomUUID() })
    ]) {
      assert.equal(response.status, 409, JSON.stringify(response.body));
      assert.equal(response.body.snapshot.votingRound, approvedSnapshot.votingRound);
      assert.deepEqual(response.body.snapshot.proposals, approvedSnapshot.proposals);
    }
    assert.deepEqual((await snapshot('CDH')).proposals, approvedSnapshot.proposals);
  });

  test('a second denied proposal appends history, including an all-abstention result', async () => {
    deniedRequest = proposal(await snapshot('CDH'), 'abstido', 'Proposta sem votos válidos.');
    deniedRequest.status = 'approved';
    const response = await finalize(deniedRequest);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.proposals.length, 2);
    const denied = response.body.proposals.find(entry => entry.id === deniedRequest.requestId);
    assert.equal(denied.status, 'denied');
    assert.equal(denied.validVotes, 0);
    assert.equal(denied.counts.abstido, 9);
    assert.deepEqual(response.body.proposals.find(entry => entry.id === approvedRequest.requestId), approvedSnapshot.proposals[0]);
    assert.equal(response.body.votingRound, 2);
  });

  test('draft updates cannot overwrite history or add veto power to another committee', async () => {
    const before = await snapshot('CDH');
    const draft = structuredClone(before);
    draft.proposalText = 'Terceira proposta ainda em elaboração.';
    draft.proposals = [{ id: approvedRequest.requestId, status: 'denied', proposalText: 'Alterado' }];
    draft.hasVeto = true;
    draft.state.vetoCountries = ['Brasil'];
    const response = await api('CDH', 'PUT', draft);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.proposals, before.proposals);
    assert.equal(response.body.hasVeto, false);
    assert.deepEqual(response.body.state.vetoCountries, []);
    assert.equal(response.body.proposalText, draft.proposalText);
    const retry = await finalize(approvedRequest);
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body.proposals, before.proposals);
    assert.equal(retry.body.proposalText, draft.proposalText);
    finalCdh = await snapshot('CDH');
  });

  test('the server enforces normalized CSNU veto members despite tampered settings', async () => {
    const ballot = proposal(await snapshot('CSNU'), 'favoravel', 'Resolução do Conselho de Segurança.');
    ballot.hasVeto = false;
    ballot.state.vetoCountries = [];
    ballot.state.delegations.find(d => d.country === 'Rússia').vote = 'contra';
    ballot.status = 'approved';
    ballot.vetoedBy = [];
    const response = await finalize(ballot);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.hasVeto, true);
    assert.deepEqual(response.body.state.vetoCountries, ['Rússia', 'EUA', 'China', 'França']);
    const entry = response.body.proposals[0];
    assert.equal(entry.status, 'vetoed');
    assert.equal(entry.counts.favoravel, 8);
    assert.deepEqual(entry.vetoedBy, ['Rússia']);
    finalCsnu = await snapshot('CSNU');
  });

  test('the backend uses the original two-thirds rule instead of a claimed client result', async () => {
    const ballot = proposal(await snapshot('OMS'));
    ballot.state.delegations.slice(5).forEach(d => { d.vote = 'contra'; });
    ballot.status = 'approved';
    ballot.majority = 'simples';
    const response = await finalize(ballot);
    assert.equal(response.status, 200);
    const entry = response.body.proposals[0];
    assert.equal(entry.majority, '2/3');
    assert.equal(entry.requiredVotes, 6);
    assert.equal(entry.status, 'denied');
  });

  test('concurrent submissions close a voting round only once', async () => {
    const ballot = proposal(await snapshot('UNESCO'));
    const results = await Promise.all([
      finalize(ballot), finalize({ ...ballot, requestId: randomUUID() })
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const saved = await snapshot('UNESCO');
    assert.equal(saved.proposals.length, 1);
    assert.equal(saved.votingRound, 1);
  });

  test('D1 preserves proposal logs and unfinished drafts after the runtime restarts', async () => {
    await stopRuntime();
    await startRuntime();
    const cdh = await snapshot('CDH');
    const csnu = await snapshot('CSNU');
    assert.deepEqual(cdh.proposals, finalCdh.proposals);
    assert.equal(cdh.proposalText, finalCdh.proposalText);
    assert.equal(cdh.votingRound, finalCdh.votingRound);
    assert.deepEqual(csnu.proposals, finalCsnu.proposals);
    const retry = await finalize(deniedRequest);
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body.proposals, finalCdh.proposals);
  }, { timeout: 90000 });
});
