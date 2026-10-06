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
from .preprocess import classify_response, assign_element_keys
from .evidence import SnapshotAPI

FILE_CAP = 2 * 1024 * 1024
PAGE_CAP = 10 * 1024 * 1024
MAX_ELEMENTS, MAX_LINKS, MAX_TEXT, MAX_TASKS = 300, 1000, 6000, 200

NODES_JS = """() => Array.from(document.querySelectorAll('input,textarea,select,button,a[href],[role=button],[role=link],[role=checkbox],[role=radio],[role=textbox],[role=combobox],[role=switch],[role=tab],[role=menuitem],[role=option],[role=searchbox]')).slice(0, 300)"""

DESCRIBE_JS = r"""(nodes) => {
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
    aria_invalid: attr(el, 'aria-invalid'), css: cssPath(el) };
  if (t === 'select') d.options = Array.from(el.options).slice(0, 100).map(o => ({ text: txt(o.text), value: o.value, selected: o.selected, disabled: o.disabled }));
  if (t === 'button' || (t === 'input' && ['submit','image','button','reset'].includes(ty))) d.button = { default_type: el.type,
    formaction: attr(el, 'formaction'), formmethod: attr(el, 'formmethod'), formnovalidate: el.hasAttribute('formnovalidate') };
  return d; });
const idx = new Map(nodes.map((n, i) => [n, i]));
const fs = forms.map(f => ({ key: formKey(f), id: f.id || null, name: attr(f, 'name'), action: f.action, method: f.method, novalidate: f.noValidate,
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
const links = Array.from(all).slice(0, 1000).map(a => { const z = a.closest('nav,header,footer,main,aside'); return { url: a.href, label: txt(a.innerText || a.getAttribute('aria-label')).slice(0, 200), area: z ? z.tagName.toLowerCase() : 'body', explicit_download: a.hasAttribute('download') }; });
let shadow = 0; document.querySelectorAll('*').forEach(e => { if (e.shadowRoot) shadow++; });
const body = document.body ? (document.body.innerText || '') : '';
return { els, forms: fs, errs, links, link_total: all.length,
  element_total: document.querySelectorAll('input,textarea,select,button,a[href],[role]').length,
  title: document.title, text: body.slice(0, 6000), text_len: body.length,
  headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).slice(0, 100).map(h => ({ level: +h.tagName[1], text: txt(h.textContent).slice(0, 200) })),
  iframes: document.querySelectorAll('iframe,frame').length, shadow, secrets,
  dom_ids: Array.from(document.querySelectorAll('[id]')).slice(0, 1000).map(e => e.id),
  inline_styles: Array.from(document.querySelectorAll('style')).map(s => s.textContent),
  inline_scripts: Array.from(document.querySelectorAll('script:not([src])')).map(s => s.textContent) }; }"""


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
        self._handlers = {"request": self.api.on_request, "response": self._on_response, "requestfailed": self._on_failed, "console": self._on_console,
                          "pageerror": self._on_pageerror, "dialog": self._on_dialog, "popup": self._on_popup,
                          "framenavigated": self._on_nav}
        for ev, h in self._handlers.items():
            page.on(ev, h)
        self._last_url = None

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

    async def snapshot(self, trigger="initial_load", parent_snapshot_id=None, *, action_id=None):
        """현재 페이지를 이동 없이 관찰하여 page_context JSON과 증거를 저장한다."""
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
        data, elements = None, []
        arr = None
        try:
            arr = await asyncio.wait_for(self.page.evaluate_handle(NODES_JS), max(0.1, _left(deadline)))
            data = await asyncio.wait_for(arr.evaluate(DESCRIBE_JS), max(0.1, _left(deadline)))
        except Exception as e:
            errors.append(f"dom:{type(e).__name__}")
            unknown += ["elements", "forms", "links", "text", "title"]
        if data:
            self._secrets.update(s for s in data.pop("secrets") if s)
            for kind, items in (("inline_style", data.pop("inline_styles")), ("inline_script", data.pop("inline_scripts"))):
                for t in items:
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
            self.last_dom_ids = data["dom_ids"]
            for l in self.last_links:
                self._add_secret_url(l["url"])
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
        try:
            env = {"viewport": self.page.viewport_size, "browser_version": self.page.context.browser.version}
        except Exception:
            env = {}
        ctx = {"schema_version": "0.2", "snapshot_id": sid, "parent_snapshot_id": parent_snapshot_id, "trigger": trigger,
               "action_id": action_id or self.api.active_action_id, "content_type": self.content_type, "page_role": self.page_role,
               "navigation": dict(self.navigation), "document_key": hashlib.sha256(urldefrag(self.page.url)[0].encode()).hexdigest(),
               "requested_url": self.requested_url, "final_url": self.page.url, "main_status": self.main_status,
               "redirects": list(self.redirects), "readiness": dict(self.readiness), "env": env,
               "title": data["title"] if data else None, "text": data["text"] if data else None,
               "headings": data["headings"] if data else [], "elements": elements,
               "forms": data["forms"] if data else [], "links": data["links"] if data else [],
               "error_candidates": data["errs"] if data else [], "resources": list(self.resources),
               "events": list(self.events), "provided_expectations": [],
               "quality": {"status": status, "unknown_fields": unknown, "unsupported": unsupported,
                           "truncated": truncated, "collection_errors": errors},
               "artifacts": art}
        out = self._sanitize(ctx)
        assign_element_keys(out)
        self.api.register(out)
        (self.snap_dir / f"{sid}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        record_raw_snapshot(raw_dir, out)
        if arr is not None:
            await arr.dispose()
        self.events, self.resources, self._errors, self._deadline = [], [], [], None
        return out

    async def close(self):
        """리스너를 제거하고 대기 작업을 제한 시간 내 정리한다 (브라우저는 닫지 않음)."""
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
