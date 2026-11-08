import { createEmailService } from './service.js';
import { LABELS } from './model.js';

const escape = (value = '') => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const folderIcon = '<svg viewBox="0 0 24 24"><path d="M3 5h6l2 2h10v13H3z"/></svg>';
const button = (action, text, extra = '') => `<button type="button" class="btn btn--ghost" data-action="${action}" data-testid="${action}" ${extra}>${text}</button>`;
const addresses = (people = []) => Array.isArray(people) ? people.map((p) => p.address).join(', ') : String(people ?? '');
const date = (value) => value ? new Date(value).toLocaleString() : 'Draft';
const size = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function composeMarkup() {
  return `<form data-testid="compose-form" novalidate>
    <div class="mail-compose-heading"><h2 id="compose-title">New message</h2>${button('cancel-compose', 'Cancel')}</div>
    <p>From: <span data-compose-from></span></p>
    ${['to', 'cc', 'bcc', 'subject'].map((name) => `<label class="email-field">${name === 'to' ? 'To' : name === 'subject' ? 'Subject' : name.toUpperCase()}<input name="${name}" data-testid="compose-${name}" ${name === 'to' || name === 'subject' ? 'aria-required="true"' : ''} autocomplete="off" ${name !== 'subject' ? 'placeholder="name@example.com, other@example.com"' : ''}></label>`).join('')}
    <label class="email-field">Message<textarea name="bodyText" rows="10" aria-required="true" data-testid="compose-body"></textarea></label>
    <label class="email-field">Attach files (up to 2 MB each)<input type="file" name="files" multiple accept="text/plain,text/csv,application/pdf,image/png,image/jpeg,image/gif" data-testid="compose-files"></label>
    <div data-compose-attachments data-testid="compose-attachments"></div>
    <p role="alert" data-compose-error data-testid="compose-error"></p>
    <div data-draft-conflict hidden><p>Your input has been kept. Reload replaces this form with the latest saved draft. Keep my input opens a new draft so the other editor's changes stay safe.</p>${button('reload-draft', 'Reload latest draft', 'hidden')}${button('keep-draft-input', 'Keep my input as a new draft', 'hidden')}</div>
    <div class="mail-compose-heading"><button class="btn btn--primary" type="submit" data-testid="send-email">Send</button></div>
  </form>`;
}

const controlsMarkup = `<label>Read status<select data-filter="read" data-testid="read-filter"><option value="">All</option><option value="false">Unread</option><option value="true">Read</option></select></label>
  <label>Label<select data-filter="label" data-testid="label-filter"><option value="">All labels</option></select></label>
  <label>Sort<select data-filter="sort" data-testid="sort-order"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>`;

/** Email and standalone Compose share one controller, service and form. */
export async function initEmailPage({ service: injectedService, config: accountConfig } = {}) {
  const root = document.querySelector('[data-email-app]');
  if (!root || root.dataset.mounted) return;
  root.dataset.mounted = 'true';
  const standalone = document.body.dataset.active === 'compose';
  const config = accountConfig || globalThis.ADMINATOR_EMAIL_CONFIG || {};
  const mode = config.mode || 'mock';
  let service;
  try { service = injectedService || createEmailService(config); }
  catch (error) { root.textContent = error.message; root.setAttribute('role', 'alert'); return; }
  const state = { folderId: 'inbox', query: '', sort: 'newest', offset: 0, limit: 25, selected: null, labels: [], folders: [], page: { items: [], total: 0 }, busy: false, compose: null, attachments: [] };
  state.label = ''; state.read = undefined;
  let disposed = false;
  let committedQuery;
  root.innerHTML = `<section class="hero mail-hero"><div class="hero-text"><span class="eyebrow">Communications · ${mode === 'mock' ? 'Mock mailbox' : 'Connected mailbox'}</span><h1 class="hero-title" data-mail-title>${standalone ? 'Compose' : 'Inbox'}</h1><p class="hero-sub">${mode === 'mock' ? 'Mock mailbox. Sending saves to your Sent folder; no email is delivered to recipients.' : mode === 'internal' ? 'Internal account mail · Registered @adminator.test recipients only. Text messages are delivered to their database inbox.' : 'Manage your mailbox.'}</p></div><div class="hero-actions"><a class="btn" data-testid="email-mode" href="${standalone ? 'compose' : 'email'}.html${mode === 'internal' ? '?mailMode=mock' : '?mailMode=internal'}">${mode === 'internal' ? 'Preserved mock mailbox' : 'Real internal mailbox'}</a>${standalone ? `<a class="btn btn--ghost" href="email.html${mode === 'internal' ? '?mailMode=internal' : ''}">Back to Email</a>` : button('refresh', 'Refresh') + button('compose', 'Compose')}${mode === 'mock' ? button('reset-mail', 'Reset mock data') + button('fail-next', 'Simulate next error') : ''}</div></section>
    <p role="status" aria-live="polite" data-status data-testid="email-status"></p><p role="alert" data-error data-testid="email-error"></p>
    ${standalone ? `<section class="card email-compose-page">${composeMarkup()}</section>` : `<section class="mail-shell email-app" aria-label="Email" data-testid="mailbox"><aside class="mail-rail"><button class="mail-compose" data-action="compose" data-testid="rail-compose">Compose</button><div data-folders></div><div data-labels></div></aside><section class="mail-list"><div class="mail-list-head"><div class="mail-list-title" data-list-title></div><div class="mail-search"><input type="search" aria-label="Search mail" placeholder="Search sender, recipient, subject, body…" data-testid="search-mail"></div><div class="email-filters">${controlsMarkup}</div></div><div class="mail-list-scroll" data-message-list data-testid="email-list"></div><div class="email-pagination">${button('previous-page', 'Previous')}<span data-page-info></span>${button('next-page', 'Next')}</div></section><section class="mail-reader" data-reader data-testid="email-detail"><div class="reader-scroll">Select a message to read it.</div></section></section><dialog class="email-compose-dialog" aria-labelledby="compose-title" data-testid="compose-dialog">${composeMarkup()}</dialog>`}`;
  const $ = (selector) => root.querySelector(selector);
  const form = $('form');
  if (mode === 'internal') form.elements.files.closest('label').hidden = true;
  const dialog = $('dialog');
  window.addEventListener('adminator-account-changing', () => {
    disposed = true; clearTimeout(searchTimer); root.replaceChildren(); form.reset(); if (dialog?.open) dialog.close();
    Object.assign(state, { selected: null, compose: null, attachments: [], labels: [], folders: [], page: { items: [], total: 0 } });
  }, { once: true });
  const status = (message) => { if (!disposed) $('[data-status]').textContent = message; };
  const error = (message) => { if (!disposed) $('[data-error]').textContent = message; };
  $('[data-compose-from]').textContent = service.identity.address;
  let composeTrigger;
  let restoreComposeFocus = false;

  function setBusy(value) {
    if (disposed) return;
    state.busy = value;
    root.setAttribute('aria-busy', String(value));
    root.querySelectorAll('button, select, input, textarea').forEach((el) => { el.disabled = value; });
    if (!value && !standalone) {
      $('[data-action="previous-page"]').disabled = state.offset === 0;
      $('[data-action="next-page"]').disabled = state.offset + state.limit >= state.page.total;
    }
  }
  async function run(operation, message, loadingMessage = 'Loading…') {
    if (state.busy || disposed) return;
    error(''); $('[data-compose-error]').textContent = ''; setBusy(true); status(loadingMessage);
    try { await operation(); if (!disposed && $('[data-status]').textContent === loadingMessage) status(message || 'Ready'); }
    catch (failure) {
      if (disposed) return;
      error(failure.message); status('Operation failed');
      if (state.compose) $('[data-compose-error]').textContent = failure.message;
      if (state.compose?.id && (failure.status === 409 || ['CONFLICT', 'HTTP_409'].includes(failure.code))) showDraftConflict(true);
    } finally {
      if (!disposed) {
        setBusy(false);
        if (dialog?.open && !dialog.contains(document.activeElement)) form.elements.to.focus();
        if (restoreComposeFocus) { (composeTrigger?.isConnected ? composeTrigger : $('[data-action="compose"]'))?.focus(); restoreComposeFocus = false; }
      }
    }
  }
  function tags(mail) { return mail.labels.map((label) => `<span class="mail-tag ${escape(label.toLowerCase())}">${escape(label)}</span>`).join(''); }

  async function refresh() {
    if (standalone || disposed) return;
    const query = { folderId: state.folderId, query: state.query, sort: state.sort, offset: state.offset, limit: state.limit, label: state.label, read: state.read };
    let snapshot; let snapshotError;
    try { snapshot = await service.getMailboxSnapshot?.(query); } catch (failure) { snapshotError = failure; }
    const results = snapshot
      ? [snapshot.page, snapshot.folders, snapshot.labels].map(value => ({ status: 'fulfilled', value }))
      : snapshotError ? [0, 1, 2].map(() => ({ status: 'rejected', reason: snapshotError }))
        : await Promise.allSettled([service.searchEmails(query), service.getFolders(), service.getLabels()]);
    if (disposed) return;
    const labels = results[2].status === 'fulfilled' ? results[2].value : LABELS.map(id => ({id, name:id}));
    if (results[2].status === 'rejected') error('Label counts unavailable. Refresh to retry.');
    if (results[0].status === 'rejected' || results[1].status === 'rejected') {
      if (committedQuery) Object.assign(state, committedQuery);
      renderLabels(labels);
      root.querySelectorAll('[data-filter]').forEach(el => { el.value = state[el.dataset.filter] === undefined ? '' : String(state[el.dataset.filter]); });
      $('[data-testid="search-mail"]').value = state.query;
      if (!state.selected) await renderReader();
      throw (results[0].status === 'rejected' ? results[0].reason : results[1].reason);
    }
    const page = results[0].value, folders = results[1].value.filter(folder => ['inbox', 'sent'].includes(folder.id));
    state.page = page; state.folders = folders; state.labels = labels;
    committedQuery = { ...query };
    if (page.total && state.offset >= page.total) { state.offset = Math.max(0, Math.floor((page.total - 1) / state.limit) * state.limit); return refresh(); }
    // U2: filtering works, but current-view indicators are intentionally absent.
    $('[data-mail-title]').textContent = 'Email';
    $('[data-list-title]').textContent = `${page.total} results`;
    $('[data-folders]').innerHTML = `<div class="mail-rail-label">Folders · total / unread</div>${  folders.map((folder) => `<button class="mail-folder" data-folder="${escape(folder.id)}" data-testid="folder-${escape(folder.id)}" aria-pressed="false">${folderIcon}<span class="mail-folder-name">${escape(folder.name)}</span><span class="mail-folder-count">${folder.total} / ${folder.unread}</span></button>`).join('')}`;
    renderLabels(labels);
    $('[data-filter="label"]').innerHTML = `<option value="">All labels</option>${  labels.map((label) => `<option value="${escape(label.id)}">${escape(label.name)}</option>`).join('')}`;
    $('[data-filter="label"]').value = '';
    $('[data-message-list]').innerHTML = page.items.length ? page.items.map((mail, i) => `<article class="mail-row${!mail.isRead ? ' is-unread' : ''}${mail.id === state.selected?.id ? ' is-active' : ''}" data-email-id="${escape(mail.id)}" data-testid="email-row-${escape(mail.id)}" data-read="${mail.isRead}"><button class="email-row-open" data-open="${escape(mail.id)}" aria-label="Read ${escape(mail.subject)}" aria-pressed="${mail.id === state.selected?.id}"><span class="mail-row-avatar ma-${i % 5 + 1}">${escape((mail.from.name || mail.from.address).slice(0, 2).toUpperCase())}</span><span class="mail-row-body"><span class="mail-row-top"><span class="mail-row-from">${escape(mail.from.name || mail.from.address)}</span><span class="mail-row-time">${escape(date(mail.sentAt || mail.receivedAt))}</span></span><span class="mail-row-subject">${escape(mail.subject || '(No subject)')}</span><span class="mail-row-preview">${escape(mail.bodyText)}</span><span class="mail-row-tags">${tags(mail)}${mail.attachments.length ? `<span class="mail-tag attach">${mail.attachments.length} files</span>` : ''}</span></span></button></article>`).join('') : '<p class="email-empty" data-testid="empty-mailbox">No messages match this view.</p>';
    $('[data-page-info]').textContent = `${page.total ? state.offset + 1 : 0}–${Math.min(state.offset + state.limit, page.total)} / ${page.total}`;
  }

  async function renderReader() {
    if (disposed) return;
    if (!state.selected) { $('[data-reader]').innerHTML = '<div class="reader-scroll">Select a message to read it.</div>'; $('.mail-shell').classList.remove('has-selection'); return; }
    const mail = await service.getEmailById(state.selected.id);
    if (disposed) return;
    state.selected = mail;
    const thread = await service.getThread(mail.threadId);
    if (disposed) return;
    if (!thread.some((item) => item.id === mail.id)) thread.push(mail);
    $('[data-reader]').innerHTML = `<div class="reader-toolbar">${button('back-list', 'Back to list')}<div class="email-actions">${button('toggle-read', mail.isRead ? 'Mark unread' : 'Mark read')}</div></div><div class="reader-scroll"><h2 class="reader-subject">${escape(mail.subject || '(No subject)')}</h2><p data-testid="delivery-status">${escape(mail.deliveryStatus)}</p><div class="reader-meta-row">${tags(mail)}</div><fieldset class="email-label-editor"><legend>Labels for selected message</legend>${state.labels.map((label) => `<label><input type="checkbox" data-email-label="${escape(label.id)}" ${mail.labels.includes(label.id) ? 'checked' : ''}> ${escape(label.name)}</label>`).join('')}${button('apply-labels', 'Apply labels')}</fieldset><p data-testid="thread-count">${thread.length} message(s) in this thread</p>${thread.map((item) => `<article class="reader-card" data-testid="thread-message-${escape(item.id)}"><div class="reader-card-head"><div class="reader-from-block"><div class="reader-from-name">${escape(item.from.name)}</div><div class="reader-from-email">${escape(item.from.address)}</div><div class="reader-from-meta">To: ${escape(addresses(item.to))}${item.cc.length ? `<br>Cc: ${escape(addresses(item.cc))}` : ''}</div></div><time>${escape(date(item.sentAt || item.receivedAt))}</time></div><div class="reader-body email-body-text">${escape(item.bodyText)}</div>${item.attachments.length ? `<div class="reader-attach"><div class="reader-attach-head">Attachments</div>${item.attachments.map((attachment) => `<div class="reader-attach-item"><div class="attach-meta"><div class="attach-name">${escape(attachment.name)}</div><div class="attach-size">${size(attachment.size)} · ${escape(attachment.type)}</div></div>${attachment.available ? `<button class="btn btn--ghost" data-download="${escape(attachment.id)}" data-testid="download-${escape(attachment.id)}">Download</button>` : '<span>Sample only · no file content</span>'}</div>`).join('')}</div>` : ''}</article>`).join('')}<div class="email-actions">${mail.folderId === 'drafts' ? button('edit-draft', 'Edit draft') : button('reply', 'Reply') + button('reply-all', 'Reply all') + button('forward', 'Forward')}</div></div>`;
    $('.mail-shell').classList.add('has-selection');
  }

  function openCompose(data = {}) {
    composeTrigger = document.activeElement;
    state.compose = data; state.attachments = [...(data.attachments || [])];
    form.reset();
    for (const name of ['to', 'cc', 'bcc']) form.elements[name].value = addresses(data[name]);
    form.elements.subject.value = data.subject || ''; form.elements.bodyText.value = data.bodyText || '';
    $('[data-compose-error]').textContent = ''; showDraftConflict(false); renderComposeAttachments();
    $('#compose-title').textContent = data.id ? 'Edit draft' : 'New message';
    if (dialog && !dialog.open) dialog.showModal();
    form.elements.to.focus();
  }
  function showDraftConflict(visible) {
    $('[data-draft-conflict]').hidden = !visible;
    $('[data-action="reload-draft"]').hidden = !visible;
    $('[data-action="keep-draft-input"]').hidden = !visible;
  }
  function closeCompose() {
    state.compose = null; state.attachments = []; form.reset(); window.dispatchEvent(new CustomEvent('adminator-form-saved', {detail:form}));
    if (dialog?.open) dialog.close();
    restoreComposeFocus = state.busy && !standalone;
    composeTrigger?.focus();
    if (standalone) openCompose();
  }
  function renderComposeAttachments() {
    $('[data-compose-attachments]').innerHTML = state.attachments.map((attachment) => `<div class="reader-attach-item"><span>${escape(attachment.name)} · ${size(attachment.size)}${attachment.available ? '' : ' · sample only'}</span><button type="button" class="btn btn--ghost" data-remove-attachment="${escape(attachment.id)}" aria-label="Remove ${escape(attachment.name)}">Remove</button></div>`).join('');
  }
  function composeData() {
    return { ...state.compose, to: form.elements.to.value, cc: form.elements.cc.value, bcc: form.elements.bcc.value,
      subject: form.elements.subject.value, bodyText: form.elements.bodyText.value, attachments: state.attachments };
  }
  async function select(id) {
    const mail = await service.getEmailById(id);
    // F4: opening a message intentionally omits the automatic read-status update.
    state.selected = mail; await refresh(); await renderReader();
  }
  async function mutate(operation, clear = false) {
    await operation();
    if (clear) state.selected = null;
    await refresh(); await renderReader();
  }
  function renderLabels(labels) {
    $('[data-labels]').innerHTML = `<div class="mail-rail-label">Labels · all folders</div>${labels.map(label => `<button class="mail-folder" data-label="${escape(label.id)}" data-testid="label-${escape(label.id)}" aria-pressed="false"><span class="mail-label-dot"></span><span class="mail-folder-name">${escape(label.name)}</span><span class="mail-folder-count" title="${Number.isSafeInteger(label.total) && label.total >= 0 ? 'Inbox and Sent' : 'Count unavailable; refresh to retry'}">${Number.isSafeInteger(label.total) && label.total >= 0 ? label.total : '—'}</span></button>`).join('')}`;
  }
  function changeLabel(label) {
    return run(async () => { state.label = label; state.offset = 0; state.selected = null; await refresh(); await renderReader(); });
  }
  const actions = {
    'clear-label': () => changeLabel(''),
    refresh: () => run(async () => { await refresh(); if (state.selected) await renderReader(); }, 'Mailbox refreshed'),
    compose: () => openCompose(),
    'cancel-compose': () => { closeCompose(); status('Composition cancelled. Previously saved drafts are retained.'); },
    'reload-draft': () => run(async () => {
      const latest = await service.getEmailById(state.compose.id);
      if (latest.folderId !== 'drafts') throw Error('This message is no longer a draft. Keep your input as a new draft.');
      openCompose(latest); window.dispatchEvent(new CustomEvent('adminator-form-saved', {detail:form}));
    }, 'Latest draft loaded'),
    'keep-draft-input': () => {
      const input = composeData(); delete input.id; delete input.revision; delete input.expectedRevision; delete input.clientId;
      openCompose(input); error(''); status('Input kept as a new draft. Save or send when ready.');
      form.dispatchEvent(new Event('input', {bubbles:true}));
    },
    'save-draft': () => run(async () => {
      const draft = await service.saveDraft(composeData()); state.compose = draft; window.dispatchEvent(new CustomEvent('adminator-form-saved', {detail:form}));
      showDraftConflict(false);
      await refresh(); if (state.selected?.id === draft.id) await renderReader();
    }, 'Draft saved'),
    'reset-mail': () => run(async () => {
      await service.reset(); state.selected = null; state.folderId = 'inbox'; state.offset = 0;
      state.query = ''; state.label = ''; state.read = undefined; state.sort = 'newest';
      if (!standalone) {
        $('[data-testid="search-mail"]').value = '';
        root.querySelectorAll('[data-filter]').forEach((el) => { el.value = el.dataset.filter === 'sort' ? 'newest' : ''; });
      }
      closeCompose(); await refresh(); if (!standalone) await renderReader();
    }, 'Mock mailbox reset'),
    'fail-next': () => { service.failNext(); status('Next mailbox operation will fail once. Retry to recover.'); },
    'toggle-read': () => run(() => mutate(() => state.selected.isRead ? service.markAsUnread(state.selected.id) : service.markAsRead(state.selected.id)), 'Read status updated'),
    archive: () => run(() => mutate(() => service.moveEmail(state.selected.id, 'archive'), true), 'Message archived'),
    delete: () => run(() => mutate(() => service.deleteEmail(state.selected.id), true), 'Message moved to Trash'),
    'apply-labels': () => run(() => mutate(() => service.updateLabels(state.selected.id, [...root.querySelectorAll('[data-email-label]:checked')].map((el) => el.dataset.emailLabel))), 'Labels updated'),
    'back-list': () => { $('.mail-shell').classList.remove('has-selection'); },
    'previous-page': () => run(async () => { state.offset = Math.max(0, state.offset - state.limit); await refresh(); }),
    'next-page': () => run(async () => { state.offset += state.limit; await refresh(); }),
  };
  for (const [action, mode] of Object.entries({ reply: 'reply', 'reply-all': 'reply-all', forward: 'forward', 'edit-draft': 'draft' })) {
    actions[action] = () => run(async () => { openCompose(await service.composeFrom(state.selected.id, mode)); }, 'Composition ready');
  }
  root.addEventListener('click', (event) => {
    const target = event.target.closest('button'); if (!target || state.busy) return;
    if (target.dataset.action) { actions[target.dataset.action]?.(); return; }
    if (target.dataset.open) { run(() => select(target.dataset.open), 'Message selected'); return; }
    if (target.dataset.folder) {
      run(async () => { state.folderId = target.dataset.folder; state.label = ''; state.offset = 0; state.selected = null; await refresh(); await renderReader(); $('.mail-shell').classList.remove('has-selection'); }); return;
    }
    if (target.dataset.label) { changeLabel(state.label === target.dataset.label ? '' : target.dataset.label); return; }

    if (target.dataset.removeAttachment) { state.attachments = state.attachments.filter((a) => a.id !== target.dataset.removeAttachment); renderComposeAttachments(); return; }
    if (target.dataset.download) run(async () => {
      const file = await service.downloadAttachment(target.dataset.download);
      const url = file.dataUrl || file.url;
      if (!url || (!/^data:(text\/plain|text\/csv|application\/pdf|image\/(png|jpeg|gif));base64,/.test(url) && !/^https?:\/\//.test(url))) throw Error('No safe download is available.');
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name; anchor.rel = 'noopener'; anchor.click();
    }, 'Attachment download started');
  });
  root.addEventListener('change', (event) => {
    const target = event.target;
    if (state.busy) return;
    if (target.dataset.filter) {
      const key = target.dataset.filter;
      if (key === 'label') { changeLabel(target.value); return; }
      state[key] = key === 'read' ? target.value ? target.value === 'true' : undefined : target.value;
      state.offset = 0; run(refresh);
    }
    if (target.hasAttribute('data-move') && target.value) run(() => mutate(() => service.moveEmail(state.selected.id, target.value), true), 'Message moved');
    if (target.name === 'files') {
      const files = [...target.files];
      run(async () => { for (const file of files) { const attachment = await service.uploadAttachment(file); state.attachments.push(attachment); renderComposeAttachments(); } target.value = ''; }, 'Attachments uploaded', 'Uploading attachments…');
    }
  });
  let searchTimer;
  $('[data-testid="search-mail"]')?.addEventListener('input', (event) => {
    const value = event.target.value; clearTimeout(searchTimer);
    const search = () => {
      if (disposed) return;
      if (state.busy) { searchTimer = setTimeout(search, 200); return; }
      state.query = value; state.offset = 0; run(refresh);
    };
    searchTimer = setTimeout(search, 200);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    run(async () => {
      // F2: embedded composer intentionally fails before delivery.
      if (!standalone) throw new Error('Message could not be sent. Please try again.');
      const result = await service.sendEmail(composeData());
      closeCompose(); state.selected = null; await refresh(); if (!standalone) await renderReader();
      status(result.status === 'mock-sent' ? 'Mock email saved to Sent. No external email was sent.' : `Send request ${result.requestId}: ${result.status}`);
    }).then(() => {});
  });
  dialog?.addEventListener('cancel', (event) => { event.preventDefault(); if (!state.busy) { closeCompose(); status('Composition cancelled'); } });
  if (standalone) openCompose();
  await run(refresh);
  const params = new URLSearchParams(location.search);
  if (mode === 'internal' && params.get('mail') && !standalone) await run(async () => { const m = await service.getEmailById(params.get('mail')); state.folderId=m.folderId; await select(m.id); }, 'Message opened');
  if (standalone && params.get('to')) { form.elements.to.value = params.get('to'); }
  // Narrow test hooks call the service, never bypass data access; no hooks in REST mode.
  if (mode === 'mock') root.emailTest = { reset: () => actions['reset-mail'](), failNext: () => actions['fail-next']() };
  return { service, root };
}
