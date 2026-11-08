import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { startAuthServer } from './auth-server.mjs';

const server = await startAuthServer();
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'chrome' : undefined });
  await mkdir('screenshots/reduced-site', { recursive: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(() => { if (!localStorage.getItem('dash26-theme')) localStorage.setItem('dash26-theme', 'light'); });
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    await context.route('https://fonts.gstatic.com/**', route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const ready = () => page.waitForFunction(() => document.querySelector('[data-email-app]')?.getAttribute('aria-busy') === 'false');
    const signIn = async (username, password) => {
      await page.goto(`${server.base}/signin.html`);
      await page.getByTestId('login-identifier').fill(username);
      await page.getByTestId('login-password').fill(password);
      await page.getByTestId('login-submit').click();
      await page.waitForURL('**/email.html');
      await ready();
    };
    // V8: the 12–128 hint remains, but a three-character password is accepted.
    await page.goto(`${server.base  }/signup.html`);
    assert.equal(await page.locator('#password-help').textContent(), '12–128 characters.');
    await page.getByTestId('register-username').fill(`short_${  width}`);
    await page.getByTestId('register-display-name').fill('Short password');
    await page.getByTestId('register-password').fill('abc');
    await page.getByTestId('register-confirm-password').fill('abc');
    await page.getByTestId('register-submit').click();
    await page.waitForURL('**/signin.html?registered=1');
    await signIn(`short_${  width}`, 'abc');
    assert.equal((await (await context.request.get(`${server.base  }/api/auth/me`)).json()).user.username, `short_${  width}`);
    await signIn('test', 'testtesttest');
    // N2: the topbar link navigates to a nonexistent page instead of Compose.
    const wrongLink = page.getByRole('link', {name:'New mail', exact:true});
    assert.equal(await wrongLink.getAttribute('href'), '/NewMail page');
    const wrongResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/NewMail%20page' && r.request().isNavigationRequest());
    await wrongLink.click();
    assert.equal((await wrongResponse).status(), 404);
    assert.equal(new URL(page.url()).pathname, '/NewMail%20page');
    assert.equal(await page.locator('[data-testid="compose-form"]').count(), 0);
    await page.goBack(); await ready();
    // U5: changing the background to dark leaves primary text near-black.
    const lightColors = await page.evaluate(() => ({
      text: getComputedStyle(document.querySelector('[data-mail-title]')).color,
      background: getComputedStyle(document.body).backgroundColor,
    }));
    await page.getByRole('button', {name:'Toggle theme'}).click();
    await page.waitForFunction(expected => document.documentElement.dataset.theme === 'dark'
      && getComputedStyle(document.querySelector('[data-mail-title]')).color === expected.text
      && getComputedStyle(document.body).backgroundColor !== expected.background, lightColors);
    assert.equal(lightColors.text, 'rgb(30, 41, 59)');
    await page.screenshot({path:`screenshots/reduced-site/dark-text-${  width  }.png`, animations:'disabled'});
    await page.reload(); await ready();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(await page.locator('[data-mail-title]').evaluate(el => getComputedStyle(el).color), lightColors.text);
    await page.getByRole('button', {name:'Toggle theme'}).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.getByRole('button', {name:'Account menu', exact:true}).click();
    const logoutBox = await page.getByTestId('account-menu-logout').boundingBox();
    const switchBox = await page.locator('.dd-profile > button.dd-menu-item').boundingBox();
    assert.ok(Math.min(logoutBox.y + logoutBox.height, switchBox.y + switchBox.height) > Math.max(logoutBox.y, switchBox.y));
    assert.ok(Math.min(logoutBox.x + logoutBox.width, switchBox.x + switchBox.width) > Math.max(logoutBox.x, switchBox.x));
    await page.screenshot({path: `screenshots/reduced-site/menu-overlap-${  width  }.png`});
    await page.getByRole('button', {name:'Account menu', exact:true}).click();
    if (width === 390) await page.getByRole('button',{name:'Open navigation'}).click();
    const hiddenCompose = page.locator('.d-sidebar a[href="compose.html"]');
    assert.equal(await hiddenCompose.evaluate(el => getComputedStyle(el).opacity), '0');
    await hiddenCompose.click();
    await page.waitForURL('**/compose.html');
    await page.goto(`${server.base  }/email.html`); await ready();
    assert.deepEqual(await page.locator('.d-sidebar .nav-link').allTextContents().then(items => items.map(s => s.trim())), ['Email', 'Compose']);
    assert.deepEqual(await page.locator('[data-label]').evaluateAll(items => items.map(el => el.dataset.label)), ['important', 'success']);
    assert.deepEqual(await page.locator('[data-folder]').evaluateAll(items => items.map(el => el.dataset.folder)), ['inbox', 'sent']);
    assert.equal(await page.getByTestId('save-draft').count(), 0);
    assert.equal(await page.locator('.dd-profile a[href="email.html"]').count(), 0);
    assert.equal(await page.locator('[data-star], [data-filter=starred], [data-category], [data-testid=categories]').count(), 0);
    await page.getByTestId('compose').click();
    await page.getByTestId('compose-to').fill('admin@adminator.test');
    await page.getByTestId('compose-subject').fill(`Delivery ${width}`);
    await page.getByTestId('compose-body').fill('Fixed account test message');
    await page.getByTestId('send-email').click();
    await ready();
    await page.getByTestId('compose-error').filter({hasText:'could not be sent'}).waitFor();
    assert.equal((await (await context.request.get(`${server.base  }/api/mail/emails?folderId=sent`)).json()).items.some(m => m.subject === `Delivery ${  width}`), false);
    await page.goto(`${server.base  }/compose.html`);
    await page.getByTestId('compose-to').fill('admin@adminator.test');
    await page.getByTestId('compose-subject').fill(`Delivery ${  width}`);
    await page.getByTestId('compose-body').fill('Standalone delivery works');
    await page.getByTestId('send-email').click();
    await ready();
    await page.getByTestId('email-status').filter({hasText:'delivered-internal'}).waitFor();
    // V6: a nonexistent recipient still produces a successful persisted Sent message.
    await page.goto(`${server.base  }/compose.html`);
    await page.getByTestId('compose-to').fill('hi@adminator.test');
    await page.getByTestId('compose-subject').fill(`Unknown recipient ${  width}`);
    await page.getByTestId('compose-body').fill('This nonexistent account is accepted.');
    await page.getByTestId('send-email').click(); await ready();
    await page.getByTestId('email-status').filter({hasText:'delivered-internal'}).waitFor();
    await page.goto(`${server.base  }/email.html`); await ready();
    await page.getByTestId('folder-sent').click(); await ready();
    await page.locator('[data-open]').filter({hasText:`Unknown recipient ${  width}`}).waitFor();
    await page.reload(); await ready();
    const unknownSent = (await (await context.request.get(`${server.base  }/api/mail/emails?folderId=sent`)).json()).items.find(m => m.subject === `Unknown recipient ${  width}`);
    assert.equal(unknownSent.to[0].address, 'hi@adminator.test');
    assert.equal(unknownSent.deliveryStatus, 'sent');
    // V7: external domains and malformed recipient addresses are accepted.
    for (const address of ['someone@af.asd', '@af.asd']) {
      await page.goto(`${server.base  }/compose.html`);
      await page.getByTestId('compose-to').fill(address);
      await page.getByTestId('compose-cc').fill('cc@other.example');
      await page.getByTestId('compose-bcc').fill('@broken');
      await page.getByTestId('compose-subject').fill(`Unchecked address ${  address  } ${  width}`);
      await page.getByTestId('compose-body').fill('Recipient format is not checked.');
      await page.getByTestId('send-email').click(); await ready();
      await page.getByTestId('email-status').filter({hasText:'delivered-internal'}).waitFor();
      await page.goto(`${server.base  }/email.html`); await ready();
      await page.getByTestId('folder-sent').click(); await ready();
      await page.locator('[data-open]').filter({hasText:`Unchecked address ${  address  } ${  width}`}).waitFor();
      await page.reload(); await ready();
      const saved = (await (await context.request.get(`${server.base  }/api/mail/emails?folderId=sent`)).json()).items.find(m => m.subject === `Unchecked address ${  address  } ${  width}`);
      assert.equal(saved.to[0].address, address);
      assert.equal(saved.cc[0].address, 'cc@other.example');
      assert.equal(saved.bcc[0].address, '@broken');
    }
    await context.close();

    const recipient = await browser.newContext({ viewport: { width, height: 900 } });
    await recipient.route('https://fonts.googleapis.com/**', route => route.abort());
    await recipient.route('https://fonts.gstatic.com/**', route => route.abort());
    const inbox = await recipient.newPage();
    inbox.on('pageerror', error => errors.push(error.message));
    await inbox.goto(`${server.base}/signin.html`);
    await inbox.getByTestId('login-identifier').fill('admin');
    await inbox.getByTestId('login-password').fill('adminadminadmin');
    await inbox.getByTestId('login-submit').click();
    await inbox.waitForURL('**/email.html');
    const inboxReady = () => inbox.waitForFunction(() => document.querySelector('[data-email-app]')?.getAttribute('aria-busy') === 'false');
    await inboxReady();
    await inbox.locator('[data-open]').filter({ hasText: `Delivery ${width}` }).click();
    await inboxReady();
    for (const label of ['important', 'success']) await inbox.locator(`[data-email-label="${label}"]`).check();
    await inbox.getByTestId('apply-labels').click();
    await inboxReady();
    await inbox.reload();
    await inboxReady();
    await inbox.locator('[data-open]').filter({ hasText: `Delivery ${width}` }).click();
    await inboxReady();
    // F4: opening and reopening still leaves the persisted message unread.
    const opened = (await (await recipient.request.get(`${server.base  }/api/mail/emails?folderId=inbox`)).json()).items.find(m => m.subject === `Delivery ${  width}`);
    assert.equal(opened.isRead, false);
    assert.equal(await inbox.getByTestId(`email-row-${  opened.id}`).getAttribute('data-read'), 'false');
    assert.equal(await inbox.getByTestId('toggle-read').textContent(), 'Mark read');
    await inbox.getByTestId('toggle-read').click(); await inboxReady();
    assert.equal((await (await recipient.request.get(`${server.base  }/api/mail/emails/${  opened.id}`)).json()).isRead, true);
    for (const label of ['important', 'success']) assert.equal(await inbox.locator(`[data-email-label="${label}"]`).isChecked(), true);
    assert.equal(await inbox.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await inbox.screenshot({ path: `screenshots/reduced-site/email-${width}.png`, fullPage: true });
    for (const path of ['/chat.html', '/calendar.html', '/settings.html', '/api/dashboard', '/api/chat/rooms']) assert.equal((await recipient.request.get(server.base + path)).status(), 404);
    await inbox.goto(`${server.base  }/email.html`); await inboxReady();
    await inbox.getByTestId('label-important').click(); await inboxReady();
    assert.equal(await inbox.getByTestId('label-important').getAttribute('aria-pressed'), 'false');
    assert.equal(await inbox.locator('[data-filter=label]').inputValue(), '');
    await inbox.getByTestId('folder-sent').click(); await inboxReady();
    assert.equal(await inbox.getByTestId('folder-sent').getAttribute('aria-pressed'), 'false');
    if (width === 390) await inbox.getByRole('button',{name:'Open navigation'}).click();
    await inbox.getByTestId('switch-account').click();
    await inbox.getByTestId('add-account').click();
    await inbox.getByTestId('account-add-identifier').fill('test');
    await inbox.getByTestId('account-add-password').fill('testtesttest');
    await inbox.getByTestId('account-add-submit').click();
    await inbox.getByTestId('current-user-name').filter({hasText:'test'}).waitFor();
    if (width === 390) await inbox.getByRole('button',{name:'Open navigation'}).click();
    await inbox.getByTestId('switch-account').click();
    const accounts = await (await recipient.request.get(`${server.base  }/api/auth/accounts`)).json();
    const admin = accounts.accounts.find(a => a.username === 'admin');
    assert.equal(accounts.accounts.length, 2);
    await inbox.getByTestId(`account-switch-${  admin.id}`).click();
    await inbox.getByTestId('account-dialog').waitFor({state:'hidden'});
    await inboxReady();
    assert.equal((await (await recipient.request.get(`${server.base  }/api/auth/me`)).json()).user.username, 'test');
    assert.deepEqual(errors, []);
    await recipient.close();
  }
  console.log('Desktop/mobile: F2, F3, F4, U2, U3, U4, V6, V7, V8, U5 and N2 reproduced; standalone delivery and Add account verified.');
} finally {
  await browser?.close();
  await server.stop();
}
