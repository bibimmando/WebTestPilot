"""Page evidence collector for the functional testing preprocessor.

Raw evidence policy: files under output/raw/<URL_ID> (HTML, CSS, JS, rendered DOM, screenshot)
may contain sensitive page content. They are LOCAL-ONLY and must not be shared or exported.
Snapshot JSON under output/snapshots is sanitized: URL-redacted and known-secret-redacted.
Cookies and header values are never stored. No bug verdicts are produced, only facts and UI states.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit, urldefrag

from .crawl import normalize_url, redact_text, redact_url, _SENSITIVE_KEY
from .preprocess import classify_response, assign_element_keys, compact_validation, build_action_context
from .evidence import SnapshotAPI

FILE_CAP = 2 * 1024 * 1024
PAGE_CAP = 10 * 1024 * 1024
MAX_ELEMENTS, MAX_LINKS, MAX_TEXT, MAX_TASKS = 300, 1000, 6000, 200
MAX_FORM_EVENTS = 200

# Read state without checkValidity()/reportValidity(), which would create events or UI.
VALIDATION_JS = r"""el => {
  if (!['input', 'select', 'textarea'].includes(el.tagName.toLowerCase()) || !el.validity) return null;
  const names = {valid:'valid', valueMissing:'value_missing', typeMismatch:'type_mismatch',
    patternMismatch:'pattern_mismatch', tooLong:'too_long', tooShort:'too_short',
    rangeUnderflow:'range_underflow', rangeOverflow:'range_overflow', stepMismatch:'step_mismatch',
    badInput:'bad_input', customError:'custom_error'};
  const validity = Object.fromEntries(Object.entries(names).map(([native, key]) => [key, !!el.validity[native]]));
  const sensitive = ['password', 'hidden'].includes(el.type) || /^(cc-|one-time-code)/.test(el.autocomplete || '');
  let message = sensitive ? null : String(el.validationMessage || '');
  if (message && el.value) message = message.split(String(el.value)).join('[REDACTED]');
  return {will_validate: !!el.willValidate, validity, message: message === null ? null : message.slice(0, 200)};
}"""

FORM_HOOK_JS = r"""(() => {
  if (window !== window.top) return;
  const slot = __SLOT__, binding = __BINDING__;
  if (window[slot]?.installed) return;
  const readValidation = __VALIDATION__;
  const documentId = String(performance.timeOrigin) + '-' + Math.random().toString(36).slice(2);
  const refs = new WeakMap(); let nextRef = 0;
  const state = {installed:true, document_id:documentId, action_id:null, seq:0,
    sent:0, dropped:0, delivery_errors:0, pending:0};
  state.ref = el => { if (!el) return null; if (!refs.has(el)) refs.set(el, documentId + ':' + (++nextRef)); return refs.get(el); };
  const listen = event => {
    const el = event.target;
    if (!el || !['INPUT', 'SELECT', 'TEXTAREA', 'FORM'].includes(el.tagName)) return;
    state.seq++;
    if (state.sent >= __CAP__) { state.dropped++; return; }
    state.sent++; state.pending++;
    const form = el.tagName === 'FORM' ? el : el.form;
    const payload = {type:event.type, document_id:documentId, seq:state.seq,
      timestamp_ms:performance.timeOrigin + performance.now(), action_id:state.action_id,
      target_ref:state.ref(el), form_ref:state.ref(form), submitter_ref:state.ref(event.submitter),
      target_tag:el.tagName.toLowerCase(), is_trusted:event.isTrusted,
      default_prevented_at_capture:event.defaultPrevented, validation:readValidation(el)};
    try { Promise.resolve(window[binding](payload)).catch(() => { state.delivery_errors++; })
      .finally(() => { state.pending--; }); }
    catch (_) { state.delivery_errors++; state.pending--; }
  };
  const types = ['input', 'change', 'invalid', 'submit', 'reset'];
  types.forEach(type => document.addEventListener(type, listen, {capture:true, passive:true}));
  state.takeStatus = () => {
    const status = {listener_installed:state.installed, document_id:documentId,
      last_emitted_sequence:state.seq, dropped_events:state.dropped,
      delivery_errors:state.delivery_errors, pending_deliveries:state.pending};
    state.sent = state.dropped = state.delivery_errors = 0; return status;
  };
  state.stop = () => { types.forEach(type => document.removeEventListener(type, listen, true)); state.installed = false; };
  window[slot] = state;
})()"""

NODES_JS = """() => Array.from(document.querySelectorAll('input,textarea,select,button,a[href],[role=button],[role=link],[role=checkbox],[role=radio],[role=textbox],[role=combobox],[role=switch],[role=tab],[role=menuitem],[role=option],[role=searchbox]')).slice(0, 300)"""

DESCRIBE_JS = r"""(nodes) => {
const readValidation = __VALIDATION__, formEvents = window[__FORM_SLOT__];
const secrets = Array.from(document.querySelectorAll('input[type=password],input[type=hidden]')).map(e => e.value).filter(Boolean), txt = s => (s || '').replace(/\s+/g, ' ').trim();
const byIds = ids => txt((ids || '').split(/\s+/).map(i => { const e = i && document.getElementById(i); return e ? e.textContent : ''; }).join(' '));
const esc = s => (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/[^\w-]/g, c => '\\' + c);
const cssPath = el => { const parts = []; let n = el;
  while (n && n.nodeType === 1 && n !== document.documentElement) {
    if (n.id && document.querySelectorAll('#' + esc(n.id)).length === 1) { parts.unshift('#' + esc(n.id)); break; }
    let i = 1, s = n; while ((s = s.previousElementSibling)) if (s.tagName === n.tagName) i++;
    parts.unshift(n.tagName.toLowerCase() + ':nth-of-type(' + i + ')'); n = n.parentElement; }
  return parts.join(' > '); };
const label = el => {
  if (el.getAttribute('aria-labelledby')) return [byIds(el.getAttribute('aria-labelledby')), 'aria-labelledby'];
  if (el.getAttribute('aria-label')) return [txt(el.getAttribute('aria-label')), 'aria-label'];
  if (el.id) { const l = document.querySelector('label[for="' + esc(el.id) + '"]'); if (l) return [txt(l.textContent), 'for']; }
  const w = el.closest('label'); if (w) return [txt(w.textContent), 'wrapping'];
  if (el.getAttribute('placeholder')) return [txt(el.getAttribute('placeholder')), 'placeholder'];
  return [null, null]; };
const implicit = el => { const t = el.tagName.toLowerCase(), ty = (el.type || '').toLowerCase();
  if (t === 'input' && ty === 'hidden') return null;
  if (t === 'a') return 'link'; if (t === 'button') return 'button'; if (t === 'textarea') return 'textbox';
  if (t === 'select') return el.multiple ? 'listbox' : 'combobox';
  if (t === 'input') return ({checkbox:'checkbox', radio:'radio', button:'button', submit:'button', reset:'button', image:'button', range:'slider', number:'spinbutton', search:'searchbox', hidden:null})[ty] ?? 'textbox';
  return null; };
const attr = (el, a) => el.hasAttribute(a) ? el.getAttribute(a) : null;
const forms = Array.from(document.forms), formKey = f => f ? (f.id || 'form#' + forms.indexOf(f)) : null;
const vw = innerWidth, vh = innerHeight;
const els = nodes.map((el, i) => {
  const t = el.tagName.toLowerCase(), ty = (el.type || '').toLowerCase(), cs = getComputedStyle(el), r = el.getBoundingClientRect();
  const [lt, ls] = label(el), isVal = 'value' in el && t !== 'button' && t !== 'a';
  const v = isVal ? String(el.value || '') : '';
  if ((ty === 'password' || ty === 'hidden') && v) secrets.push(v);
  const d = { index: i, tag: t, type: t === 'input' || t === 'button' ? ty : null, role: el.getAttribute('role') || implicit(el),
    name_attr: attr(el, 'name'), id_attr: el.id || null, testid: attr(el, 'data-testid'),
    id_unique: !!el.id && document.querySelectorAll('#' + esc(el.id)).length === 1,
    testid_unique: el.hasAttribute('data-testid') && document.querySelectorAll('[data-testid="' + esc(el.getAttribute('data-testid')) + '"]').length === 1,
    text: txt(el.innerText || el.textContent).slice(0, 200), label: lt, label_source: ls,
    required: !!el.required, pattern: attr(el, 'pattern'), min: attr(el, 'min'), max: attr(el, 'max'),
    minlength: attr(el, 'minlength'), maxlength: attr(el, 'maxlength'), step: attr(el, 'step'),
    value_present: isVal ? v.length > 0 : null, value_length: isVal ? v.length : null,
    checked: 'checked' in el && (ty === 'checkbox' || ty === 'radio') ? el.checked : null,
    disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', readonly: !!el.readOnly,
    radio_group: ty === 'radio' ? attr(el, 'name') : null, form: formKey(el.form || null),
    href: t === 'a' ? el.href : null,
    visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
    in_viewport: r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw,
    bbox: { x: r.x, y: r.y, width: r.width, height: r.height },
    computed: { display: cs.display, visibility: cs.visibility, opacity: cs.opacity, pointer_events: cs.pointerEvents },
    described_by: el.getAttribute('aria-describedby') ? byIds(el.getAttribute('aria-describedby')) : null,
    aria_invalid: attr(el, 'aria-invalid'), css: cssPath(el),
    validation: readValidation(el), observed_ref: formEvents?.ref(el) || null };
  if (['password', 'hidden'].includes(ty) || /^(cc-|one-time-code)/.test(el.autocomplete || '')) {
    d.value_present = d.value_length = null;
  }
  if (t === 'select') d.options = Array.from(el.options).slice(0, 100).map(o => ({ text: txt(o.text), value: o.value, selected: o.selected, disabled: o.disabled }));
  if (t === 'button' || (t === 'input' && ['submit','image','button','reset'].includes(ty))) d.button = { default_type: el.type,
    formaction: attr(el, 'formaction'), formmethod: attr(el, 'formmethod'), formnovalidate: el.hasAttribute('formnovalidate') };
  return d; });
const idx = new Map(nodes.map((n, i) => [n, i]));
const fs = forms.map(f => ({ key: formKey(f), id: f.id || null, name: attr(f, 'name'), action: f.action, method: f.method, novalidate: f.noValidate,
  observed_ref: formEvents?.ref(f) || null,
  fields: Array.from(f.elements).map(e => idx.has(e) ? idx.get(e) : null).filter(x => x !== null),
  submitters: Array.from(f.elements).filter(e => e.type === 'submit' || e.type === 'image').map(e => idx.has(e) ? idx.get(e) : null) }));
const errs = []; const seen = new Set();
const addErr = (e, source) => { if (seen.has(e)) return; seen.add(e); const cs = getComputedStyle(e);
  errs.push({ text: txt(e.textContent).slice(0, 300), source, role: e.getAttribute('role'), aria_live: e.getAttribute('aria-live'),
    visible: cs.display !== 'none' && cs.visibility !== 'hidden' && e.getClientRects().length > 0 }); };
document.querySelectorAll('[role=alert],[aria-live]').forEach(e => addErr(e, 'aria'));
document.querySelectorAll('[aria-invalid=true]').forEach(e => (e.getAttribute('aria-describedby') || '').split(/\s+/).forEach(id => { const d = id && document.getElementById(id); if (d) addErr(d, 'aria-invalid-describedby'); }));
document.querySelectorAll('[class*=error],[class*=invalid]').forEach(e => { if (errs.length < 100) addErr(e, 'heuristic_class'); });
const all = document.querySelectorAll('a[href]');
const links = Array.from(all).slice(0, 1000).map(a => { const z = a.closest('nav,header,footer,main,aside'); return { url: a.href, element_index: idx.has(a) ? idx.get(a) : null, label: txt(a.innerText || a.getAttribute('aria-label')).slice(0, 200), area: z ? z.tagName.toLowerCase() : 'body', explicit_download: a.hasAttribute('download') }; });
let shadow = 0; document.querySelectorAll('*').forEach(e => { if (e.shadowRoot) shadow++; });
const body = document.body ? (document.body.innerText || '') : '';
return { els, forms: fs, errs, links, link_total: all.length,
  form_event_collection: formEvents?.takeStatus() || {listener_installed:false},
  element_total: document.querySelectorAll('input,textarea,select,button,a[href],[role]').length,
  title: document.title, text: body.slice(0, 6000), text_len: body.length,
  headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).slice(0, 100).map(h => ({ level: +h.tagName[1], text: txt(h.textContent).slice(0, 200) })),
  iframes: document.querySelectorAll('iframe,frame').length, shadow, secrets,
  dom_ids: Array.from(document.querySelectorAll('[id]')).slice(0, 1000).map(e => e.id),
  inline_styles: Array.from(document.querySelectorAll('style')).map(s => s.textContent),
  inline_scripts: Array.from(document.querySelectorAll('script:not([src])')).map(s => s.textContent) }; }""".replace('__VALIDATION__', VALIDATION_JS)


def resolve_locator(page, spec):
    """명세(spec)를 실제 Playwright 전략의 Locator로 변환한다 (.first 사용 금지)."""
    s = spec.get("strategy")
    base = page.locator(spec["scope"]) if spec.get("scope") else page
    if s == "testid":
        return base.get_by_test_id(spec["value"])
    if s == "role":
        kw = {"exact": bool(spec.get("exact", True))}
        if spec.get("name") is not None:
            kw["name"] = spec["name"]
        return base.get_by_role(spec["role"], **kw)
    if s == "label":
        return base.get_by_label(spec["text"], exact=bool(spec.get("exact", True)))
    if s == "css":
        return base.locator(spec["selector"])
    raise ValueError(f"unsupported strategy: {s}")


def _left(deadline):
    """남은 데드라인 시간(초)을 0 이상으로 반환한다."""
    return max(0.0, deadline - time.monotonic())


def raw_page_directory(raw_root: Path, normalized_url: str) -> Path:
    '''정규화된 URL의 SHA-256 해시(64자리 hex)로 페이지 원본 디렉터리를 만들고 반환한다.'''
    digest = hashlib.sha256(normalized_url.encode('utf-8')).hexdigest()
    directory = raw_root / digest
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def record_raw_snapshot(directory: Path, snapshot: dict) -> None:
    '''page.json 인덱스에 스냅샷 항목을 추가하거나 같은 snapshot_id 항목을 교체해 원자적으로 저장한다.

    기존 인덱스가 손상되었거나 형태가 맞지 않으면 기존 기록을 지우지 않고 ValueError를 발생시킨다.
    snapshot은 이미 정제된 값만 담고 있어야 한다.
    '''
    index_path = directory / 'page.json'
    snapshot_id = snapshot['snapshot_id']

    if index_path.exists():
        try:
            index = json.loads(index_path.read_text(encoding='utf-8'))
        except ValueError as exc:
            raise ValueError(f'page.json을 읽을 수 없습니다(손상된 JSON): {index_path}') from exc
        if (
            not isinstance(index, dict)
            or index.get('schema_version') != 'raw_page/1'
            or index.get('page_id') != directory.name
            or not isinstance(index.get('snapshots'), list)
            or not all(isinstance(e, dict) and 'snapshot_id' in e for e in index['snapshots'])
        ):
            raise ValueError(f'page.json 형식이 올바르지 않습니다: {index_path}')
        if 'requested_url' not in index:
            index['requested_url'] = snapshot.get('requested_url')
    else:
        index = {
            'schema_version': 'raw_page/1',
            'page_id': directory.name,
            'requested_url': snapshot.get('requested_url'),
            'snapshots': [],
        }

    entry = {
        'snapshot_id': snapshot_id,
        'trigger': snapshot.get('trigger'),
        'final_url': snapshot.get('final_url'),
        'title': snapshot.get('title'),
        'parent_snapshot_id': snapshot.get('parent_snapshot_id'),
        'action_id': snapshot.get('action_id'),
        'artifacts': snapshot.get('artifacts', {}),
        'snapshot_ref': f'snapshots/{snapshot_id}.json',
        'ai_input_ref': snapshot.get('ai_input_ref'),
    }

    snapshots = index['snapshots']
    for i, existing in enumerate(snapshots):
        if existing['snapshot_id'] == snapshot_id:
            snapshots[i] = entry
            break
    else:
        snapshots.append(entry)

    tmp_path = directory / f'{uuid.uuid4().hex}.tmp'
    try:
        tmp_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding='utf-8')
        tmp_path.replace(index_path)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise

class PageCollector:
    def __init__(self, page, output_dir, timeout=15, ready_selector=None, summary_budget=None):
        """수집기를 초기화하고 네비게이션 전에 이벤트 리스너를 한 번만 등록한다."""
        self.page, self.timeout, self.ready_selector = page, float(timeout), ready_selector
        self.out = Path(output_dir).resolve()
        self.raw, self.snap_dir = self.out / "raw", self.out / "snapshots"
        self.raw.mkdir(parents=True, exist_ok=True)
        self._page_raw_dir = None
        self.snap_dir.mkdir(parents=True, exist_ok=True)
        (self.raw / "README.txt").write_text("LOCAL-ONLY raw evidence. May contain sensitive content. Do not share.\n", encoding="utf-8")
        self._secrets: set[str] = set()
        self._counter = 0
        self._sem = asyncio.Semaphore(4)
        self._initial_html = None
        self._initial_response = None
        self._document_epoch = 0
        self.summary_budget = summary_budget
        self._deadline = None
        self.last_links, self.navigation_history, self.popup_urls = [], [], []
        self.last_dom_ids = []
        self._reset()
        self.api = SnapshotAPI(self)
        self.current_action_id = None
        self._form_events, self._form_refs, self._form_seen = [], {}, {}
        self._form_dropped, self._form_hook_error, self._closed = 0, None, False
        # One binding/init script per Page, reused after a collector is closed.
        self._form_channel = getattr(page, '_wtp_form_evidence_channel', None)
        if self._form_channel is None:
            suffix = uuid.uuid4().hex[:12]
            self._form_channel = {'owner': None, 'binding': '_wtp_form_' + suffix,
                                  'slot': '__wtp_form_' + suffix, 'bound': False, 'init_added': False}
            page._wtp_form_evidence_channel = self._form_channel
        self._handlers = {"request": self.api.on_request, "response": self._on_response, "requestfailed": self._on_failed, "console": self._on_console,
                          "pageerror": self._on_pageerror, "dialog": self._on_dialog, "popup": self._on_popup,
                          "framenavigated": self._on_nav}
        for ev, h in self._handlers.items():
            page.on(ev, h)
        self._last_url = None

    async def _ensure_form_events(self, deadline):
        channel = self._form_channel
        try:
            if channel['owner'] not in (None, self):
                raise RuntimeError('another collector owns this page')
            channel['owner'] = self
            if not channel['bound']:
                def receive(source, payload):
                    owner = channel['owner']
                    if owner is not None and owner._is_main(source.get('frame')):
                        owner._on_form_event(payload)
                await asyncio.wait_for(self.page.expose_binding(channel['binding'], receive), max(.1, _left(deadline)))
                channel['bound'] = True
            script = FORM_HOOK_JS.replace('__SLOT__', json.dumps(channel['slot'])).replace(
                '__BINDING__', json.dumps(channel['binding'])).replace('__VALIDATION__', VALIDATION_JS).replace('__CAP__', str(MAX_FORM_EVENTS))
            if not channel['init_added']:
                await asyncio.wait_for(self.page.add_init_script(script=script), max(.1, _left(deadline)))
                channel['init_added'] = True
            await asyncio.wait_for(self.page.evaluate(script), max(.1, _left(deadline)))
            self._form_hook_error = None
        except Exception as exc:
            self._form_hook_error = type(exc).__name__

    async def set_action_context(self, action_id):
        try:
            await asyncio.wait_for(self.page.evaluate('(x) => { const s = window[x.slot]; if (s) s.action_id = x.action_id; }',
                {'slot': self._form_channel['slot'], 'action_id': action_id}), min(self.timeout, 2))
        except Exception as exc:
            self._form_hook_error = type(exc).__name__

    def _on_form_event(self, payload):
        if self._closed or not isinstance(payload, dict) or payload.get('type') not in ('input', 'change', 'invalid', 'submit', 'reset'):
            return
        doc, seq = payload.get('document_id'), payload.get('seq')
        if not isinstance(doc, str) or len(doc) > 100 or not isinstance(seq, int) or isinstance(seq, bool) or seq < 1:
            return
        token = (doc, seq)
        if token in self._form_seen:
            return
        self._form_seen[token] = True
        if len(self._form_seen) > MAX_FORM_EVENTS * 2:
            self._form_seen.pop(next(iter(self._form_seen)))
        if len(self._form_events) >= MAX_FORM_EVENTS:
            self._form_dropped += 1
            return
        aid = payload.get('action_id')
        aid = aid if isinstance(aid, str) and aid in self.api._used_ids else None
        meta = self.api.event_meta('form_event')
        meta.update(action_id=aid, association='temporal', association_status='unattributed' if aid is None else
                    'active' if aid == self.api.active_action_id else 'delayed_delivery')
        event = {'type': payload['type'], 'document_id': doc, 'seq': seq}
        for field in ('target_ref', 'form_ref', 'submitter_ref'):
            value = payload.get(field)
            if isinstance(value, str) and value.startswith(doc + ':') and len(value) <= 130:
                event[field] = value
        for field in ('is_trusted', 'default_prevented_at_capture'):
            if isinstance(payload.get(field), bool):
                event[field] = payload[field]
        if payload.get('target_tag') in ('input', 'select', 'textarea', 'form'):
            event['target_tag'] = payload['target_tag']
        stamp = payload.get('timestamp_ms')
        if isinstance(stamp, (int, float)) and not isinstance(stamp, bool) and 0 <= stamp < 1e16:
            event['timestamp_ms'] = stamp
        if isinstance(payload.get('validation'), dict):
            event['validation'] = compact_validation(payload['validation'])
        for field in ('target_ref', 'form_ref', 'submitter_ref'):
            ref = self._form_refs.get(event.get(field))
            if ref:
                event[field.replace('_ref', '_key')] = ref['key']
                if field == 'target_ref':
                    event['target_snapshot_id'] = ref['snapshot_id']
        self._form_events.append(self._sanitize({**event, **meta}))

    def _reset(self):
        """네비게이션 단위 이벤트/리소스/작업 컬렉션을 초기화한다."""
        self.events, self.resources, self.redirects, self._tasks = [], [], [], set()
        self._saved_total, self._errors, self._task_overflow = 0, [], 0
        self.main_status, self.requested_url, self.main_url = None, None, None
        self.content_type, self.page_role = None, "unknown"
        self.navigation = {"kind": "document"}
        self._document_response_seen = False
        self.readiness = {"status": "not_run"}

    def _add_secret_url(self, url):
        """URL 쿼리 값을 비공개 비밀 집합에 추가한다."""
        try:
            parts = urlsplit(url)
            for query in (parts.query, parts.fragment):
                for k, v in parse_qsl(query, keep_blank_values=False):
                    if v and _SENSITIVE_KEY.search(k):
                        self._secrets.add(v)
        except Exception:
            pass

    def _sanitize(self, obj):
        """내보낼 데이터의 모든 문자열을 URL/비밀 값 기준으로 재귀적으로 마스킹한다."""
        if isinstance(obj, dict):
            return {k: self._sanitize(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [self._sanitize(v) for v in obj]
        if isinstance(obj, str):
            s = redact_url(obj) if "://" in obj and " " not in obj.strip() else obj
            return redact_text(s, secrets=tuple(sorted(self._secrets, key=len, reverse=True)))
        return obj

    def _raw_directory(self, url=None):
        if self._page_raw_dir is None:
            self._page_raw_dir = raw_page_directory(self.raw, normalize_url(self.requested_url or url or self.page.url))
        return self._page_raw_dir

    def _write_raw(self, kind, ext, data: bytes, *, directory=None):
        """원시 증거 파일을 고유 이름으로 저장하고 절대 경로를 반환한다."""
        self._counter += 1
        h = hashlib.sha256(data).hexdigest()[:10]
        p = (directory or self._raw_directory()) / f"{self._counter:04d}_{kind}_{h}.{ext}"
        p.write_bytes(data)
        return str(p)

    def _spawn(self, coro):
        """제한된 개수의 백그라운드 작업을 시작한다."""
        if len(self._tasks) >= MAX_TASKS:
            self._task_overflow += 1
            coro.close()
            return
        t = asyncio.ensure_future(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    def _is_main(self, frame):
        """프레임이 메인 프레임인지 안전하게 확인한다."""
        try:
            return frame == self.page.main_frame
        except Exception:
            return False

    def _on_response(self, resp):
        """응답 이벤트: 메타데이터 기록 및 본문 저장 작업을 예약한다."""
        req = resp.request
        rtype, url, st = req.resource_type, resp.url, resp.status
        meta = self.api.event_meta("response", req)
        meta.pop("kind", None)
        meta["origin_action_id"] = meta["action_id"]
        self._add_secret_url(url)
        try:
            frame = req.frame
        except Exception:
            frame = None
        if rtype == "document" and self._is_main(frame):
            self._document_response_seen = True
            self.main_status, self.main_url = st, url
            self.content_type = resp.headers.get("content-type")
            self.page_role = classify_response(st, self.content_type, url)["page_role"]
            chain, r = [], req.redirected_from
            while r is not None:
                chain.insert(0, r.url)
                self._add_secret_url(r.url)
                r = r.redirected_from
            hops = chain + [url]
            for a, b in zip(hops, hops[1:]):
                self.redirects.append({"from": a, "to": b})
                self.navigation_history.append({"from": a, "to": b, "kind": "redirect", "action_id": meta["action_id"]})
            self.resources.append({"kind": "main_document", "url": url, "status": st, "content_type": self.content_type, **meta})
            if st not in (301, 302, 303, 307, 308):
                self._document_epoch += 1
                self._initial_response = self._initial_html = None
                ext = "html" if self.page_role == "html_page" else "json" if self.page_role == "json" else "xml" if self.page_role in ("xml", "sitemap") else "txt"
                self._spawn(self._save_body(resp, "initial_response", ext, initial=True, meta=meta, epoch=self._document_epoch, directory=self._raw_directory(url)))
        elif rtype in ("stylesheet", "script") and 200 <= st < 300:
            self._spawn(self._save_body(resp, rtype, "css" if rtype == "stylesheet" else "js", meta=meta, directory=self._raw_directory(url)))
        elif rtype in ("fetch", "xhr"):
            self.resources.append({"kind": rtype, "url": url, "status": st, "method": req.method, **meta})
        if st >= 400 and rtype not in ("fetch", "xhr"):
            self.resources.append({"kind": rtype, "url": url, "status": st, "note": "http_status_evidence", **meta})

    async def _save_body(self, resp, kind, ext, initial=False, meta=None, epoch=None, directory=None):
        """크기 제한을 지키며 응답 본문을 원시 파일로 저장한다."""
        rec = {"kind": kind, "url": resp.url, "status": resp.status, "saved": False}
        rec.update(meta or {})
        self.resources.append(rec)
        async with self._sem:
            try:
                cl = resp.headers.get("content-length")
                n = int(cl) if cl and cl.isdigit() else None
                if n is not None and (n > FILE_CAP or self._saved_total + n > PAGE_CAP):
                    rec["skipped"] = "size_cap_content_length"
                    return
                body = await resp.body()
                if len(body) > FILE_CAP or self._saved_total + len(body) > PAGE_CAP:
                    rec["skipped"] = "size_cap_after_read"
                    return
                self._saved_total += len(body)
                path = self._write_raw(kind, ext, body, directory=directory)
                rec.update(saved=True, path=path, bytes=len(body))
                if initial and epoch == self._document_epoch:
                    self._initial_response = path
                    if self.page_role == "html_page":
                        self._initial_html = path
            except Exception as e:
                rec["error"] = type(e).__name__
                self._errors.append(f"body:{kind}:{type(e).__name__}")

    def _on_failed(self, req):
        """요청 실패를 증거 메타데이터로 기록한다 (버그 판정 아님)."""
        self._add_secret_url(req.url)
        self.events.append({"type": "requestfailed", "url": req.url, "resource_type": req.resource_type,
                            "failure": req.failure, "note": "may_be_policy_induced", **self.api.event_meta("requestfailed", req)})

    def _on_console(self, msg):
        """콘솔 메시지를 기록한다."""
        self.events.append({"type": "console", "level": msg.type, "text": msg.text[:2000], **self.api.event_meta("console")})

    def _on_pageerror(self, err):
        """페이지 오류를 기록한다."""
        self.events.append({"type": "pageerror", "text": str(err)[:2000], **self.api.event_meta("pageerror")})

    def _on_dialog(self, dialog):
        """대화상자를 교착 방지를 위해 dismiss하고 정책을 기록한다."""
        self.events.append({"type": "dialog", "dialog_type": dialog.type, "message": dialog.message[:500],
                            "policy": "auto_dismissed", **self.api.event_meta("dialog")})
        self._spawn(dialog.dismiss())

    def _on_popup(self, popup):
        """팝업 URL을 관찰만 한다 (라우팅 정책은 러너 책임)."""
        self.popup_urls.append(popup.url)
        self._add_secret_url(popup.url)
        self.events.append({"type": "popup", "url": popup.url, "policy": "observed_only", **self.api.event_meta("popup")})

    def _on_nav(self, frame):
        """메인 프레임 이동을 실제 URL로 기록한다."""
        if self._is_main(frame):
            if self._last_url and self._last_url != frame.url:
                if urldefrag(self._last_url)[0] == urldefrag(frame.url)[0]:
                    self.navigation = {"kind":"same_document", "inherited_from": self.api.last_snapshot["snapshot_id"] if self.api.last_snapshot else None}
                    self.readiness = {"status":"heuristic_unverified", "method":"same_document_event"}
                self.navigation_history.append({"from": self._last_url, "to": frame.url, "kind": "navigation", "action_id": self.api.active_action_id})
            self._last_url = frame.url
            self._add_secret_url(frame.url)

    async def open_page(self, url):
        """승인된 URL로만 이동하고 준비 상태를 제한 시간 내에 확인한다."""
        try:
            same_document = urldefrag(normalize_url(url))[0] == urldefrag(normalize_url(self.page.url))[0] and urlsplit(url).fragment != urlsplit(self.page.url).fragment
        except ValueError:
            same_document = False
        previous = {key: getattr(self, key) for key in ("_initial_html", "_initial_response", "main_status", "main_url", "content_type", "page_role")}
        prior_sid = self.api.last_snapshot["snapshot_id"] if self.api.last_snapshot else None
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._reset()
        self._initial_html = None
        self._initial_response = None
        self._document_epoch += 1
        self._last_url = None
        self.last_links = []
        self.last_dom_ids = []
        self.navigation_history = []
        self.popup_urls = []
        self._deadline = time.monotonic() + self.timeout
        self.requested_url = url
        self._page_raw_dir = raw_page_directory(self.raw, normalize_url(url))
        self._add_secret_url(url)
        await self._ensure_form_events(self._deadline)
        try:
            await self.page.goto(url, timeout=max(1, _left(self._deadline) * 1000), wait_until="domcontentloaded")
        except Exception as e:
            self._errors.append(f"goto:{type(e).__name__}:{str(e)[:200]}")
            self.readiness = {"status": "goto_failed"}
            return False
        if same_document and not self._document_response_seen:
            for key, value in previous.items():
                setattr(self, key, value)
            self.navigation = {"kind": "same_document", "inherited_from": prior_sid}
        try:
            if self.ready_selector:
                await self.page.wait_for_selector(self.ready_selector, timeout=max(1, _left(self._deadline) * 500))
                self.readiness = {"status": "ready_selector_found", "selector": self.ready_selector}
            else:
                await self.page.wait_for_timeout(min(1000, _left(self._deadline) * 200))
                self.readiness = {"status": "heuristic_unverified", "method": "short_settle"}
        except Exception as e:
            self.readiness = {"status": "ready_timeout", "error": type(e).__name__}
        return True

    async def _drain(self, deadline):
        """남은 시간 내에 대기 중인 응답 읽기 작업을 기다리고 미완료 수를 반환한다."""
        pending = [t for t in self._tasks if not t.done()]
        if pending and _left(deadline) > 0:
            _, pend = await asyncio.wait(pending, timeout=_left(deadline))
            return len(pend)
        return len(pending)

    async def _locator_for(self, d, handle, deadline):
        """후보 전략을 실제 개수와 노드 동일성으로 검증해 고유 locator를 고른다."""
        cands = []
        if d.get("testid"):
            cands.append({"strategy": "testid", "value": d["testid"]})
        if d.get("role") and (d.get("label") or d.get("text")):
            cands.append({"strategy": "role", "role": d["role"], "name": d.get("label") or d["text"], "exact": True})
        if d.get("label"):
            cands.append({"strategy": "label", "text": d["label"], "exact": True})
        if d.get("css"):
            cands.append({"strategy": "css", "selector": d["css"]})
        for spec in cands:
            if _left(deadline) < 0.2:
                return None, "deadline"
            try:
                loc = resolve_locator(self.page, spec)
                if await asyncio.wait_for(loc.count(), _left(deadline)) != 1:
                    continue
                h = await loc.element_handle(timeout=max(1, min(1000, _left(deadline) * 1000)))
                if await h.evaluate("(node, expected) => node === expected", handle):
                    return spec, "verified"
            except Exception:
                continue
        return None, "no_unique_locator"

    async def snapshot(self, trigger="initial_load", parent_snapshot_id=None, *, action_id=None, light=False):
        """현재 페이지를 이동 없이 관찰하여 page_context JSON과 증거를 저장한다.

        light=True(명시적 opt-in)는 full-page PNG, rendered DOM, inline 소스 저장만 건너뛴다.
        DOM 수집, locator 검증, events/resources, quality, ai_input은 동일하다."""
        started = time.perf_counter()
        if parent_snapshot_id is not None:
            self.api._check_sid(parent_snapshot_id)
        if trigger == "initial_load" and self._deadline:
            deadline = self._deadline
        else:
            deadline = time.monotonic() + self.timeout
        sid = f"{trigger}-{uuid.uuid4().hex[:12]}"
        raw_dir = self._raw_directory()
        errors, unknown, truncated = list(self._errors), [], {}
        unsupported = {"closed_shadow_root": "undetectable"}
        art = {"raw_page_dir": str(raw_dir), "initial_html": self._initial_html, "initial_response": self._initial_response, "rendered_dom": None, "screenshot": None}
        if light:
            art["skipped_reason"] = "mid_action_light"
        data, elements = None, []
        arr = None
        try:
            if self._form_channel['owner'] is not self or not self._form_channel['init_added']:
                await self._ensure_form_events(deadline)
            arr = await asyncio.wait_for(self.page.evaluate_handle(NODES_JS), max(0.1, _left(deadline)))
            describe = DESCRIBE_JS.replace('__FORM_SLOT__', json.dumps(self._form_channel['slot']))
            data = await asyncio.wait_for(arr.evaluate(describe), max(0.1, _left(deadline)))
        except Exception as e:
            errors.append(f"dom:{type(e).__name__}")
            unknown += ["elements", "forms", "links", "text", "title"]
        if data:
            self._secrets.update(s for s in data.pop("secrets") if s)
            for kind, items in (("inline_style", data.pop("inline_styles")), ("inline_script", data.pop("inline_scripts"))):
                for t in ([] if light else items):
                    b = (t or "").encode()
                    if b and len(b) <= FILE_CAP and self._saved_total + len(b) <= PAGE_CAP:
                        self._saved_total += len(b)
                        self.resources.append({"kind": kind, "path": self._write_raw(kind, "css" if "style" in kind else "js", b, directory=raw_dir)})
                    elif b:
                        truncated[kind] = "size_cap"
            handles = []
            try:
                props = await arr.get_properties()
                handles = [props[str(i)].as_element() for i in range(len(data["els"]))]
            except Exception as e:
                errors.append(f"handles:{type(e).__name__}")
            for d in data["els"]:
                d["element_id"] = f"{sid}-e{d['index']}"
                h = handles[d["index"]] if d["index"] < len(handles) else None
                d["locator"], d["locator_status"] = (await self._locator_for(d, h, deadline)) if h else (None, "no_handle")
                if d["tag"] == "input" and d.get("type") in ("password", "hidden"):
                    d["value_note"] = "value_never_exported"
                elements.append(d)
            for f in data["forms"]:
                f["fields"] = [f"{sid}-e{i}" for i in f["fields"]]
                f["submitters"] = [f"{sid}-e{i}" if i is not None else None for i in f["submitters"]]
            if data["element_total"] > MAX_ELEMENTS:
                truncated["elements"] = {"limit": MAX_ELEMENTS}
            if data["link_total"] > MAX_LINKS:
                truncated["links"] = {"limit": MAX_LINKS, "total": data["link_total"]}
            if data["text_len"] > MAX_TEXT:
                truncated["text"] = {"limit": MAX_TEXT, "total": data["text_len"]}
            unsupported.update(iframes=data["iframes"], open_shadow_roots=data["shadow"])
            self.last_links = list(data["links"])
            for link in self.last_links:
                index = link.pop('element_index', None)
                if index is not None:
                    link['element_id'] = f'{sid}-e{index}'
            self.last_dom_ids = data["dom_ids"]
            for l in self.last_links:
                self._add_secret_url(l["url"])
        if not light:
            try:
                html = await asyncio.wait_for(self.page.content(), max(0.1, _left(deadline)))
                art["rendered_dom"] = self._write_raw("rendered_dom", "html", html.encode(), directory=raw_dir)
            except Exception as e:
                errors.append(f"rendered_dom:{type(e).__name__}")
            try:
                shot = raw_dir / f"{sid}.png"
                await self.page.screenshot(path=str(shot), full_page=True, caret="initial", timeout=max(1, _left(deadline) * 1000))
                art["screenshot"] = str(shot)
            except Exception as e:
                errors.append(f"screenshot:{type(e).__name__}")
        left = await self._drain(deadline)
        if left:
            errors.append(f"drain_timeout:{left}_pending")
        if self._task_overflow:
            truncated["response_tasks"] = {"dropped": self._task_overflow}
        art["initial_html"] = self._initial_html
        art["initial_response"] = self._initial_response
        errors.extend(e for e in self._errors if e not in errors)
        if art["initial_response"] is None:
            unknown.append("artifacts.initial_response")
        if self.main_status is None:
            unknown.append("main_status")
        status = "failed" if data is None else ("partial" if errors or unknown else "complete")
        form_status = dict(data.get('form_event_collection') or {}) if data else {'listener_installed': False}
        form_status.update(scope='main_document', capacity=MAX_FORM_EVENTS, association='temporal',
                           coverage='since_listener_installation', hook_error=self._form_hook_error)
        form_status['dropped_events'] = form_status.get('dropped_events', 0) + self._form_dropped
        doc = form_status.get('document_id')
        form_status['last_received_sequence'] = max((seq for generation, seq in self._form_seen if generation == doc), default=0)
        form_status['sequence_tail_missing'] = form_status.get('last_emitted_sequence', 0) > form_status['last_received_sequence']
        form_status['status'] = 'unavailable' if not form_status.get('listener_installed') or self._form_hook_error else (
            'partial' if form_status['dropped_events'] or form_status.get('delivery_errors') or form_status.get('pending_deliveries') or form_status['sequence_tail_missing'] else 'available')
        form_events = list(self._form_events)
        try:
            env = {"viewport": self.page.viewport_size, "browser_version": self.page.context.browser.version}
        except Exception:
            env = {}
        ctx = {"schema_version": "0.2", "snapshot_id": sid, "parent_snapshot_id": parent_snapshot_id, "trigger": trigger,
               "action_id": action_id or self.api.active_action_id,
               "action_target_key": self.api.active_target_key,
               "content_type": self.content_type, "page_role": self.page_role,
               "navigation": dict(self.navigation), "document_key": hashlib.sha256(urldefrag(self.page.url)[0].encode()).hexdigest(),
               "requested_url": self.requested_url, "final_url": self.page.url, "main_status": self.main_status,
               "redirects": list(self.redirects), "readiness": dict(self.readiness), "env": env,
               "title": data["title"] if data else None, "text": data["text"] if data else None,
               "headings": data["headings"] if data else [], "elements": elements,
               "forms": data["forms"] if data else [], "links": data["links"] if data else [],
               "error_candidates": data["errs"] if data else [], "resources": list(self.resources),
               "events": list(self.events) + form_events, "form_event_collection": form_status,
               "provided_expectations": [],
               "quality": {"status": status, "unknown_fields": unknown, "unsupported": unsupported,
                           "truncated": truncated, "collection_errors": errors},
               "artifacts": art, "capture_mode": "light" if light else "full",
               "timing": {"capture_s": round(time.perf_counter() - started, 4)}}
        out = self._sanitize(ctx)
        assign_element_keys(out)
        for item in out['elements'] + out['forms']:
            if item.get('observed_ref'):
                self._form_refs[item['observed_ref']] = {'key': item.get('element_key') or item.get('form_key'), 'snapshot_id': sid}
        while len(self._form_refs) > 4000:
            self._form_refs.pop(next(iter(self._form_refs)))
        for event in out['events']:
            if event.get('kind') != 'form_event':
                continue
            for field in ('target_ref', 'form_ref', 'submitter_ref'):
                ref = self._form_refs.get(event.get(field))
                if ref and not event.get(field.replace('_ref', '_key')):
                    event[field.replace('_ref', '_key')] = ref['key']
                    if field == 'target_ref':
                        event['target_snapshot_id'] = ref['snapshot_id']
            event['target_reference_status'] = 'resolved' if event.get('target_key') else 'unresolved'
        out['action_context'] = build_action_context(out)
        self.api.register(out)
        (self.snap_dir / f"{sid}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        record_raw_snapshot(raw_dir, out)
        if arr is not None:
            await arr.dispose()
        self.events, self.resources, self._errors, self._deadline = [], [], [], None
        self._form_events, self._form_dropped = [], 0
        return out

    async def close(self):
        """리스너를 제거하고 대기 작업을 제한 시간 내 정리한다 (브라우저는 닫지 않음)."""
        self._closed = True
        if self._form_channel['owner'] is self:
            self._form_channel['owner'] = None
            try:
                await asyncio.wait_for(self.page.evaluate('(slot) => window[slot]?.stop()', self._form_channel['slot']), min(self.timeout, 2))
            except Exception:
                pass
        for ev, h in self._handlers.items():
            try:
                self.page.remove_listener(ev, h)
            except Exception:
                pass
        await self._drain(time.monotonic() + min(self.timeout, 5))
        for t in list(self._tasks):
            t.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
