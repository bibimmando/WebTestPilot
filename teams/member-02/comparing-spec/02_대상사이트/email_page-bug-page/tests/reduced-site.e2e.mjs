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
    await signIn('test', 'testtesttest');
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
    await page.getByTestId('email-status').filter({ hasText: 'delivered-internal' }).waitFor();
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
    for (const label of ['important', 'success']) assert.equal(await inbox.locator(`[data-email-label="${label}"]`).isChecked(), true);
    assert.equal(await inbox.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await inbox.screenshot({ path: `screenshots/reduced-site/email-${width}.png`, fullPage: true });
    for (const path of ['/chat.html', '/calendar.html', '/settings.html', '/api/dashboard', '/api/chat/rooms']) assert.equal((await recipient.request.get(server.base + path)).status(), 404);
    assert.deepEqual(errors, []);
    await recipient.close();
  }
  console.log('Desktop/mobile: fixed-account login, delivery, labels, persistence and retired routes passed.');
} finally {
  await browser?.close();
  await server.stop();
}
