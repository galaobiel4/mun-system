import { login, authStatus, setupAccount, currentUser, endSession } from './client.js?v=20261008-lock-v1';
const $ = id => document.getElementById(id), KEY = 'minionu-supervisor-session';
export async function initAdminAuth({ requireDev = false, onEnter, onLogout = () => {} }) {
  let session, user, timer, generation = 0;
  const cleanup = () => { try { onLogout(); } catch (error) { console.error('Falha ao limpar o painel:', error); } };
  const friendly = error => /Cannot read properties|is not a function|JSON/.test(error.message) ? 'Atualize a página e tente entrar novamente.' : error.message;
  const auth = {
    get token() { return session?.token; },
    get user() { return user; },
    logout(message = '') {
      generation++; clearTimeout(timer); session = undefined; user = undefined;
      try { sessionStorage.removeItem(KEY); } catch {}
      cleanup(); $('panel').hidden = true; $('login-area').hidden = false;
      $('password').value = ''; $('login-error').textContent = message;
    }
  };
  async function enter(candidate) {
    const current = ++generation; cleanup(); clearTimeout(timer);
    if (!candidate?.token || !Number.isFinite(candidate.expiresAt) || candidate.expiresAt <= Date.now()) { auth.logout('Sessão expirada. Entre novamente.'); return; }
    try {
      const identity = await currentUser(candidate.token);
      if (current !== generation) return;
      if (requireDev && identity.user.role !== 'dev') throw new Error('Seu login tem acesso ao acompanhamento. Esta página exige um login DEV.');
      session = candidate; user = identity.user;
      await onEnter(auth, () => current === generation);
      if (current !== generation) return;
      try { sessionStorage.setItem(KEY, JSON.stringify(candidate)); } catch {}
      $('login-area').hidden = true; $('panel').hidden = false; $('password').value = '';
      timer = setTimeout(() => auth.logout('Sessão expirada. Entre novamente.'), candidate.expiresAt - Date.now());
    } catch (error) { console.error('Falha ao abrir o painel:', error); if (current === generation) auth.logout(friendly(error)); }
  }
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault(); $('login-button').disabled = true; $('login-error').textContent = '';
    try { await enter(await login($('username').value.trim(), $('password').value)); }
    catch (error) { $('login-error').textContent = friendly(error); }
    finally { $('login-button').disabled = false; }
  });
  $('logout').addEventListener('click', () => { const token = auth.token; auth.logout(); if (token) endSession(token).catch(() => {}); });
  const setup = $('setup-form');
  if (setup) setup.addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true; $('setup-error').textContent = '';
    try {
      if ($('setup-password').value !== $('setup-confirm').value) throw new Error('As senhas não conferem.');
      const candidate = await setupAccount({ activationPassword: $('activation-password').value, displayName: $('setup-name').value.trim(), username: $('setup-username').value.trim(), password: $('setup-password').value });
      setup.reset(); setup.hidden = true; $('login-form').hidden = false; await enter(candidate);
    } catch (error) { $('setup-error').textContent = error.message; } finally { button.disabled = false; }
  });
  try {
    const state = await authStatus();
    if (setup) { setup.hidden = !state.needsSetup || !state.canSetup; $('login-form').hidden = state.needsSetup && state.canSetup; }
    if (state.needsSetup && !setup) $('login-error').textContent = 'Configure o primeiro acesso pela página DEV.';
    if (state.needsSetup && !state.canSetup) $('login-error').textContent = 'Configure a senha de ativação no servidor para iniciar o primeiro acesso.';
  } catch (error) { $('login-error').textContent = error.message; }
  try { const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (saved) await enter(saved); } catch { auth.logout(); }
  return auth;
}

