import '../../styles/2026/index.scss';
import { mountShell } from './Shell.js';
import { initShellBehaviors } from './init.js';
import { initializeAuthentication, renderCurrentUser } from './auth/ui.js';
import { accountEmailConfig } from './email/account-persistence.js';

async function start() {
  const auth = await initializeAuthentication();
  if (!auth || (!auth.user && document.querySelector('.shell'))) return;
  mountShell();
  renderCurrentUser(auth);
  initShellBehaviors();
  if (auth.user && document.querySelector('[data-email-app]')) {
    const { initEmailPage } = await import(/* webpackChunkName: "email-page" */ './email/ui.js');
    await initEmailPage({ config: accountEmailConfig(auth.user, auth.client, globalThis.ADMINATOR_EMAIL_CONFIG || {}) });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
