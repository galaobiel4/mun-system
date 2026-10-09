import { initAdminAuth } from './admin-auth.js';
import { listUsers, createUser, updateUser, devStatus, exportBackup, resetAll, endCrisis, watchDashboard } from './client.js';
const $ = id => document.getElementById(id);
const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
let auth, passwordUser, nextOffset, stop;
function message(id, text, error = false) { $(id).textContent = text; $(id).className = error ? 'error-text' : 'success-text'; }
async function loadUsers(session, append = false) {
  const token = session.token, data = await listUsers(token, append ? nextOffset : 0); if (session.token !== token) return;
  if (!append) $('users-list').replaceChildren();
  for (const user of data.users) {
    const row = node('tr'), identity = node('td'), actions = node('td'), own = user.id === session.user.id;
    identity.append(node('strong', user.displayName), node('div', `${user.username}${own ? ' · você' : ''}`, 'meta'));
    const reset = node('button', 'Alterar senha', 'secondary'); reset.type = 'button';
    reset.addEventListener('click', () => { passwordUser = user; $('reset-password-form').reset(); $('reset-error').textContent = ''; $('password-dialog-user').textContent = `${user.displayName} · ${user.username}`; $('password-dialog').showModal(); });
    const toggle = node('button', user.active ? 'Desativar' : 'Ativar', 'secondary'); toggle.type = 'button'; toggle.disabled = own;
    toggle.addEventListener('click', async () => { toggle.disabled = true; try { await updateUser(session.token, user.id, { active: !user.active }); await loadUsers(session); message('users-message', user.active ? 'Acesso desativado e sessões encerradas.' : 'Acesso ativado.'); } catch (error) { message('users-message', error.message, true); } finally { toggle.disabled = own; } });
    actions.append(reset, toggle); row.append(identity, node('td', `${user.role === 'dev' ? 'DEV' : 'Supervisor'} · ${user.active ? 'Ativo' : 'Desativado'}`), actions); $('users-list').append(row);
  }
  nextOffset = data.nextOffset; $('users-more').hidden = nextOffset === null;
}
async function loadStatus(session) {
  const token = session.token, data = await devStatus(token); if (session.token !== token) return;
  $('dev-committees').textContent = data.committeeCount; $('dev-health').textContent = 'Conectado'; $('dev-crisis').textContent = data.system.crisis ? 'Em andamento' : 'Sem aviso'; $('end-crisis').disabled = !data.system.crisis; $('dev-version').textContent = `Versão: ${data.version} · Consulta: ${new Date().toLocaleString('pt-BR')}`;
  const labels = { 'start-crisis': 'Início da crise', 'end-crisis': 'Aviso de crise encerrado', reset: 'Reset dos comitês', 'create-user': 'Usuário criado', 'update-user': 'Usuário atualizado' };
  $('admin-events').replaceChildren(...data.audit.map(event => { const card = node('article', undefined, 'event'); card.append(node('time', new Date(event.createdAt).toLocaleString('pt-BR')), node('h3', labels[event.action] || event.action), node('p', `Por ${event.actor}${event.details.username ? ' · ' + event.details.username : ''}`)); return card; }));
  if (!data.audit.length) $('admin-events').append(node('p', 'Nenhuma ação administrativa registrada ainda.', 'empty'));
}
auth = await initAdminAuth({ requireDev: true,
  onLogout() { stop?.(); $('password-dialog').close(); $('reset-dialog').close(); $('reset-password-form').reset(); $('reset-all-form').reset(); $('create-user-form').reset(); $('users-list').replaceChildren(); },
  async onEnter(session, isCurrent) {
    await Promise.all([loadUsers(session), loadStatus(session)]); if (!isCurrent()) return;
    $('dev-identity').textContent = `Conectado como ${session.user.displayName} · ${session.user.username}`;
    stop = watchDashboard(session.token, update => { if (isCurrent() && ['crisis-state', 'dashboard-snapshot'].includes(update.type)) loadStatus(session).catch(() => {}); }, state => { if (isCurrent() && state === 'expired') session.logout('Sessão expirada. Entre novamente.'); });
  }
});
$('users-more').addEventListener('click', async () => { $('users-more').disabled = true; try { await loadUsers(auth, true); } catch (error) { message('users-message', error.message, true); } finally { $('users-more').disabled = false; } });
$('create-user-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { if ($('new-user-password').value !== $('new-user-confirm').value) throw new Error('As senhas não conferem.'); await createUser(auth.token, { displayName: $('new-user-name').value.trim(), username: $('new-user-login').value.trim(), password: $('new-user-password').value, role: $('new-user-role').value }); $('create-user-form').reset(); await loadUsers(auth); await loadStatus(auth); message('users-message', 'Usuário criado. Ele já pode entrar com o perfil escolhido.'); }
  catch (error) { message('users-message', error.message, true); } finally { button.disabled = false; }
});
$('password-cancel').addEventListener('click', () => { $('password-dialog').close(); $('reset-password-form').reset(); });
$('reset-password-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { if ($('reset-password').value !== $('reset-confirm').value) throw new Error('As senhas não conferem.'); const result = await updateUser(auth.token, passwordUser.id, { password: $('reset-password').value }); $('password-dialog').close(); $('reset-password-form').reset(); if (result.sessionRevoked) auth.logout('Senha alterada. Entre com sua nova senha.'); else { message('users-message', 'Senha alterada. As sessões anteriores foram encerradas.'); await loadStatus(auth); } }
  catch (error) { $('reset-error').textContent = error.message; } finally { button.disabled = false; }
});
$('refresh-status').addEventListener('click', async () => { try { await loadStatus(auth); message('maintenance-message', 'Diagnóstico atualizado.'); } catch (error) { message('maintenance-message', error.message, true); } });
$('backup').addEventListener('click', async () => {
  $('backup').disabled = true;
  try { const data = await exportBackup(auth.token), url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), link = node('a'); link.href = url; link.download = `minionu-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); message('maintenance-message', 'Backup exportado. Guarde o arquivo para preservar as informações.'); }
  catch (error) { message('maintenance-message', error.message, true); } finally { $('backup').disabled = false; }
});
$('end-crisis').addEventListener('click', async () => { $('end-crisis').disabled = true; try { await endCrisis(auth.token); await loadStatus(auth); message('maintenance-message', 'Aviso de crise encerrado em todos os painéis.'); } catch (error) { message('maintenance-message', error.message, true); $('end-crisis').disabled = false; } });
$('open-reset').addEventListener('click', () => { $('reset-all-form').reset(); $('reset-all-error').textContent = ''; $('reset-dialog').showModal(); });
$('reset-cancel').addEventListener('click', () => $('reset-dialog').close());
$('reset-all-form').addEventListener('submit', async event => {
  event.preventDefault(); if ($('reset-phrase').value.trim() !== 'RESETAR TODOS') { $('reset-all-error').textContent = 'Digite RESETAR TODOS para confirmar.'; return; }
  const button = event.submitter; button.disabled = true;
  try { const result = await resetAll(auth.token); $('reset-dialog').close(); await loadStatus(auth); message('maintenance-message', `${result.resetCount} comitês e o acompanhamento foram resetados. Usuários preservados.`); }
  catch (error) { $('reset-all-error').textContent = error.message; } finally { button.disabled = false; }
});
