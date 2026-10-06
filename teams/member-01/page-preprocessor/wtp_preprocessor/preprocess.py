import re
import urllib.parse
import xml.etree.ElementTree as ET

_BIN_EXT = re.compile(r"\.(pdf|png|jpe?g|gif|webp|bmp|ico|svg|tiff?|zip|gz|tgz|bz2|xz|7z|rar|tar|exe|dmg|msi|mp3|mp4|avi|mov|wav|docx?|xlsx?|pptx?|csv)$", re.I)
_API_HINT = re.compile(r"(^|/)(api|graphql|rest|v\d+)(/|$)", re.I)


def _check_url(u):
    p = urllib.parse.urlsplit(u)
    if p.scheme.lower() not in ('http', 'https') or not p.hostname:
        return None
    if p.username is not None or p.password is not None:
        return None
    return p


def classify_link(url, current_url, dom_ids=(), explicit_download=False, hash_policy='conservative'):
    from .crawl import normalize_url
    if hash_policy not in ('conservative', 'strip_routes', 'preserve_all'):
        raise ValueError('invalid hash_policy')
    raw = urllib.parse.urljoin(current_url, url)
    if _check_url(raw) is None:
        raise ValueError('invalid url')
    target = normalize_url(raw)
    if _check_url(target) is None:
        raise ValueError('invalid url')
    tp = urllib.parse.urlsplit(target)
    cp = urllib.parse.urlsplit(current_url)
    same_doc = (tp.scheme, tp.netloc, tp.path or '/', tp.query) == (cp.scheme, cp.netloc, cp.path or '/', cp.query)
    same_origin = (tp.scheme, tp.netloc) == (cp.scheme, cp.netloc)
    frag = tp.fragment
    doc = urllib.parse.urlunsplit((tp.scheme, tp.netloc, tp.path, tp.query, ''))
    hints = []
    fragment_kind, alias, kind, reason = None, None, 'page', 'page'
    queue = target
    if frag:
        is_route = frag.startswith('/') or frag.startswith('!')
        if is_route:
            fragment_kind = 'route'
            if hash_policy == 'strip_routes':
                queue = doc
                reason = 'route_stripped'
            else:
                kind, reason = 'hash_route', 'route_preserved'
        elif hash_policy == 'preserve_all':
            fragment_kind, kind, reason = 'preserved', 'hash_route', 'fragment_preserved'
        elif same_doc and (urllib.parse.unquote(frag) in set(dom_ids) or re.fullmatch(r'[A-Za-z_][\w:.-]{0,127}', urllib.parse.unquote(frag))):
            fragment_kind = 'anchor'
            alias, kind, queue = doc, 'anchor', None
            reason = 'same_document_anchor' + ('_dom' if frag in set(dom_ids) else '')
        else:
            fragment_kind, kind, reason = 'unknown', 'hash_route', 'ambiguous_fragment_kept'
    path = tp.path.lower()
    name = path.rsplit('/', 1)[-1]
    if _API_HINT.search(path):
        hints.append('api_path')
        if kind == 'page':
            kind = 'api_candidate'
    if 'sitemap' in name:
        hints.append('sitemap_path')
    if kind not in ('anchor',):
        if _BIN_EXT.search(path):
            kind, reason = 'file_candidate', 'binary_extension'
        elif path.endswith('.json'):
            kind, reason = 'api_candidate', 'json_extension'
        elif path.endswith('.xml'):
            kind = 'sitemap_candidate' if 'sitemap' in name else 'file_candidate'
            reason = 'xml_extension'
    if explicit_download:
        hints.append('explicit_download')
        kind = 'file_candidate'
        reason = 'explicit_download'
        if not same_origin:
            queue = None
        else:
            hints.append('same_origin_caller_policy')
            queue = None
    return {'target_url': target, 'queue_url': queue, 'kind': kind, 'fragment_kind': fragment_kind,
            'anchor_alias': alias, 'target_document': doc, 'hints': hints, 'reason': reason}


def classify_response(status, content_type, url):
    ct = (content_type or '').split(';', 1)[0].strip().lower()
    is_error = not isinstance(status, int) or status >= 400
    if ct in ('text/html', 'application/xhtml+xml'):
        role = 'html_page'
    elif ct == 'application/json' or ct.endswith('+json'):
        role = 'json'
    elif ct in ('application/xml', 'text/xml') or ct.endswith('+xml'):
        role = 'sitemap' if 'sitemap' in urllib.parse.urlsplit(url or '').path.lower() else 'xml'
    elif ct == 'application/pdf' or ct.startswith('image/') or ct in ('application/zip', 'application/gzip', 'application/x-tar', 'application/x-7z-compressed', 'application/x-rar-compressed', 'application/octet-stream'):
        role = 'file'
    elif not ct:
        role = 'unknown'
    else:
        role = 'other'
    return {'content_type': ct, 'page_role': role, 'callback_eligible': role == 'html_page', 'is_error': is_error}


def parse_sitemap(body, base_url, max_bytes=1048576, max_urls=1000):
    from .crawl import normalize_url
    for v in (max_bytes, max_urls):
        if isinstance(v, bool) or not isinstance(v, int) or v <= 0:
            raise ValueError('limits must be positive int')
    res = {'urls': [], 'dropped': 0, 'truncated': False, 'is_index': False, 'errors': []}
    data = body.encode('utf-8') if isinstance(body, str) else bytes(body)
    if len(data) > max_bytes:
        res['errors'].append('too_large')
        return res
    low = data.replace(b'\x00', b'').lower()
    if b'<!doctype' in low or b'<!entity' in low:
        res['errors'].append('dtd_rejected')
        return res
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        res['errors'].append('malformed_xml')
        return res
    tag = root.tag.rsplit('}', 1)[-1]
    if tag == 'sitemapindex':
        res['is_index'] = True
        res['errors'].append('index_not_expanded')
        return res
    if tag != 'urlset':
        res['errors'].append('not_urlset')
        return res
    seen = set()
    for el in root:
        if el.tag.rsplit('}', 1)[-1] != 'url':
            continue
        loc = next((c for c in el if c.tag.rsplit('}', 1)[-1] == 'loc'), None)
        text = (loc.text or '').strip() if loc is not None else ''
        if not text:
            res['dropped'] += 1
            continue
        try:
            u = normalize_url(urllib.parse.urljoin(base_url, text))
        except ValueError:
            u = None
        if not u or _check_url(u) is None:
            res['dropped'] += 1
            continue
        if u in seen:
            res['dropped'] += 1
            continue
        if len(res['urls']) >= max_urls:
            res['truncated'] = True
            res['dropped'] += 1
            continue
        seen.add(u)
        res['urls'].append(u)
    return res


import hashlib
import json
import copy
import urllib.parse


def _identity_hash(parts):
    raw = json.dumps(parts, sort_keys=True, default=str)
    return 'e:' + hashlib.sha256(raw.encode('utf-8')).hexdigest()[:20]


def _doc_scope(snapshot):
    if snapshot.get('document_key'):
        return snapshot['document_key']
    url = snapshot.get('final_url') or snapshot.get('requested_url') or ''
    return urllib.parse.urldefrag(url)[0]


def _form_basis(form, scope, forms):
    for attr in ('id', 'name'):
        v = form.get(attr)
        if v and sum(1 for f in forms if f.get(attr) == v) == 1:
            return ['form', scope, attr, v], 'strong'
    return ['form', scope, 'position', form.get('css'), forms.index(form)], 'weak'


def _elem_basis(el, scope):
    loc = el.get('locator') or {}
    form = el.get('form_key')
    if el.get('testid') and el.get('testid_unique') is True:
        return ['el', scope, 'testid', el['testid']], 'strong'
    if el.get('id_attr') and el.get('id_unique') is True:
        return ['el', scope, 'id', el['id_attr']], 'strong'
    if loc.get('strategy') in ('role', 'label') and el.get('locator_status') == 'verified':
        canon = {k: loc.get(k) for k in sorted(loc) if k != 'value'}
        return ['el', scope, 'loc', canon, form], 'medium'
    return ['el', scope, 'css', el.get('css') or loc.get('css'), el.get('tag'), el.get('index')], 'weak'


def assign_element_keys(snapshot):
    scope = _doc_scope(snapshot)
    forms = snapshot.get('forms') or []
    form_map = {}
    for f in forms:
        basis, stab = _form_basis(f, scope, forms)
        f['form_key'] = _identity_hash(basis)
        f['form_key_stability'] = stab
        if f.get('key') is not None:
            form_map[f['key']] = f['form_key']
    elements = snapshot.get('elements') or []
    by_id = {}
    for el in elements:
        fid = el.get('form')
        if fid in form_map:
            el['form_key'] = form_map[fid]
        basis, stab = _elem_basis(el, scope)
        el['key_basis'] = basis[2]
        el['stability'] = stab
        el['element_key'] = _identity_hash(basis)
        by_id[el.get('element_id')] = el
    counts = {}
    for el in elements:
        counts[el['element_key']] = counts.get(el['element_key'], 0) + 1
    seen = {}
    for el in elements:
        k = el['element_key']
        if counts[k] > 1:
            n = seen.get(k, 0)
            seen[k] = n + 1
            el['stability'] = 'weak'
            el['key_basis'] = 'duplicate_ordinal'
            el['element_key'] = _identity_hash([k, 'dup', n])
    for f in forms:
        for name in ('fields', 'submitters'):
            ids = f.get(name) or []
            keys, missing = [], 0
            for i in ids:
                if i in by_id:
                    keys.append(by_id[i]['element_key'])
                else:
                    missing += 1
            stem = 'field' if name == 'fields' else 'submitter'
            f[stem + '_keys'] = keys
            f[stem + '_missing_count'] = missing


def get_by_element_key(snapshot, key):
    for el in snapshot.get('elements') or []:
        if el.get('element_key') == key:
            return copy.deepcopy(el)
    return None


_FIELDS = ('visible', 'in_viewport', 'disabled', 'readonly', 'checked', 'value_present',
           'value_length', 'aria_invalid', 'text', 'label', 'href')


def _cap(v):
    return v[:200] if isinstance(v, str) else v


def _props(el):
    p = {f: _cap(el.get(f)) for f in _FIELDS}
    comp = el.get('computed') or {}
    for c in ('display', 'visibility', 'opacity', 'pointer_events'):
        p['computed.' + c] = comp.get(c)
    bb = el.get('bbox') or {}
    for b in ('x', 'y', 'width', 'height'):
        p['bbox.' + b] = bb.get(b)
    opts = el.get('options')
    if opts is not None:
        p['selected_options'] = [{'text': _cap(o.get('text')), 'selected': o.get('selected')} for o in opts]
    return p


def _partial(s):
    q = s.get('quality') or {}
    return bool((q.get('truncated') or {}).get('elements') or 'elements' in (q.get('unknown_fields') or []) or q.get('status') == 'failed')


def diff_snapshots(before, after):
    b, a = copy.deepcopy(before), copy.deepcopy(after)
    assign_element_keys(b)
    assign_element_keys(a)
    bm = {e['element_key']: e for e in b.get('elements') or []}
    am = {e['element_key']: e for e in a.get('elements') or []}
    scope_changed = _doc_scope(b) != _doc_scope(a)
    bp, ap = _partial(b), _partial(a)
    added, removed, changed, uncertain = [], [], [], []
    for k, e in am.items():
        if k not in bm:
            if bp:
                uncertain.append({'element_key': k, 'reason': 'before_incomplete'})
            else:
                added.append({'element_key': k, 'element_id': e.get('element_id'), 'uncertain': e['stability'] == 'weak'})
    for k, e in bm.items():
        if k not in am:
            if ap:
                uncertain.append({'element_key': k, 'reason': 'after_incomplete'})
            else:
                removed.append({'element_key': k, 'element_id': e.get('element_id'), 'uncertain': e['stability'] == 'weak'})
    for k in bm:
        if k not in am:
            continue
        e1, e2 = bm[k], am[k]
        if 'weak' in (e1['stability'], e2['stability']):
            uncertain.append({'element_key': k, 'reason': 'weak_identity'})
            continue
        p1, p2 = _props(e1), _props(e2)
        diffs = {f: {'before': p1[f], 'after': p2.get(f)} for f in p1 if p1[f] != p2.get(f)}
        for f in p2:
            if f not in p1:
                diffs[f] = {'before': None, 'after': p2[f]}
        if diffs and len(changed) < 300:
            changed.append({'element_key': k, 'before_element_id': e1.get('element_id'),
                            'after_element_id': e2.get('element_id'), 'changes': diffs})
    return {
        'before_snapshot_id': b.get('snapshot_id'),
        'after_snapshot_id': a.get('snapshot_id'),
        'added': added, 'removed': removed, 'changed': changed,
        'changed_truncated': len(changed) >= 300,
        'url_changed': b.get('final_url') != a.get('final_url'),
        'document_scope_changed': scope_changed,
        'status_changed': b.get('main_status') != a.get('main_status'),
        'error_candidates_changed': [
            [{k: _cap(e.get(k)) for k in ('text','visible','source','role')} for e in s.get('error_candidates',[])[:20]]
            for s in (b,a)
        ] if b.get('error_candidates') != a.get('error_candidates') else None,
        'uncertain': uncertain,
        'comparison_limited': bp or ap,
        'limits': {'before_partial': bp, 'after_partial': ap},
        'note': 'observed changes only; not a causal verdict',
    }


import json
import copy


def _ai_bytes(obj):
    return len(json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))


def _s(v, n):
    if v is None:
        return None
    return str(v)[:n]


def build_ai_input(snapshot, budget=None):
    try:
        from .crawl import redact_text, redact_url
    except ImportError:
        redact_text = redact_url = None
    rt = (lambda v, n: _s(redact_text(str(v)), n) if v is not None else None) if redact_text else _s
    ru = (lambda v: _s(redact_url(str(v)), 300) if v else None) if redact_url else (lambda v: _s(v, 300))
    b = {'max_bytes': 12288, 'max_controls': 60, 'max_links': 30, 'text_chars': 1000, 'max_errors': 10}
    for k, v in (budget or {}).items():
        if k not in b or not isinstance(v, int) or isinstance(v, bool) or v < 0:
            raise ValueError('bad budget %s' % k)
        b[k] = v
    if b['max_bytes'] < 2048:
        raise ValueError('max_bytes must be >= 2048')
    src_bytes = _ai_bytes(snapshot)
    els = snapshot.get('elements') or []
    if any(isinstance(e, dict) and 'element_key' not in e for e in els):
        snap = copy.deepcopy(snapshot)
        r = assign_element_keys(snap)
        snap = r if isinstance(r, dict) else snap
        els = snap.get('elements') or []
    else:
        snap = snapshot
    sid = _s(snap.get('snapshot_id'), 100)
    q = snap.get('quality') or {}
    rd = snap.get('readiness') or {}
    lst = lambda v: [_s(x, 80) for x in (v or [])[:20]] if isinstance(v, (list, tuple)) else []
    quality = {'status': _s(q.get('status'), 40) or 'unknown', 'known_fields': lst(q.get('known_fields')),
               'unknown_fields': lst(q.get('unknown_fields')), 'truncated': lst(list(q.get('truncated') or {})),
               'unsupported': lst([k for k,v in (q.get('unsupported') or {}).items() if v]), 'collection_errors': lst(q.get('collection_errors'))}
    src_trunc = bool(quality['truncated']) or bool(snap.get('truncated'))
    readiness = {k: _s(rd.get(k), 100) for k in ('status', 'method', 'selector')}
    controls = []
    for e in els:
        if not isinstance(e, dict):
            continue
        if e.get('tag') not in ('input', 'textarea', 'select', 'button') and e.get('role') not in ('button', 'textbox', 'checkbox', 'radio', 'searchbox', 'combobox', 'listbox', 'switch', 'slider', 'spinbutton', 'tab', 'menuitem', 'option'):
            continue
        c = {'key': _s(e.get('element_key'), 60), 'stability': _s(e.get('stability'), 30)}
        for f in ('tag', 'type', 'role'):
            c[f] = _s(e.get(f), 40)
        c['label'] = rt(e.get('label'), 100)
        c['text'] = rt(e.get('text'), 100)
        c['form_key'] = _s(e.get('form_key'), 60)
        c['aria_invalid'] = _s(e.get('aria_invalid'), 20)
        c['described_by'] = rt(e.get('described_by'), 200)
        for f in ('visible', 'hidden', 'disabled', 'checked', 'readonly', 'required'):
            c[f] = e.get(f) if isinstance(e.get(f), bool) else None
        c['hidden'] = not e['visible'] if isinstance(e.get('visible'), bool) else None
        c['value_present'] = e.get('value_present')
        c['value_length'] = e.get('value_length')
        cons = {f: _s(e.get(f), 100) for f in ('pattern', 'min', 'max', 'minlength', 'maxlength', 'step') if e.get(f) is not None}
        if cons:
            c['constraints'] = cons
        loc = e.get('locator')
        if isinstance(loc, dict) and e.get('locator_status') == 'verified':
            fields = ('strategy','role','name','exact','text','value','selector','scope')
            if any(isinstance(loc.get(k),str) and len(loc[k]) > 150 for k in fields):
                c['locator_truncated'] = True
            else:
                c['locator'] = {k:loc[k] for k in fields if k in loc}
                c['locator_verified'] = True
        if c['tag'] == 'select' and isinstance(e.get('options'), list):
            c['selected_options'] = [rt(o.get('text'), 100) for o in e['options'][:20] if isinstance(o, dict) and o.get('selected')]
        c['_submit'] = bool(e.get('is_submitter')) or c['type'] == 'submit' or (c['tag'] == 'button' and c['type'] in (None, 'submit'))
        controls.append(c)
    order = sorted(range(len(controls)), key=lambda i: (not controls[i]['form_key'], not controls[i]['required'], not controls[i]['visible'], i))
    controls = [controls[i] for i in order]
    hidden_count = sum(1 for c in controls if c['hidden'] or not c['visible'])
    om = {'controls': max(0, len(controls) - b['max_controls']), 'links': 0, 'errors': 0, 'forms': 0, 'text_chars': 0, 'feature_candidates': 0, 'missing_refs': 0}
    controls = controls[:b['max_controls']]
    forms = []
    for f in snap.get('forms') or []:
        if isinstance(f, dict):
            forms.append({'form_key': _s(f.get('form_key'), 60), 'action_url': ru(f.get('action')), 'method': _s(f.get('method'), 10),
                          'novalidate': bool(f.get('novalidate')), 'field_keys': [str(x) for x in (f.get('field_keys') or [])][:200],
                          'submitter_keys': [str(x) for x in (f.get('submitter_keys') or [])][:50]})
    links, raw_links = [], snap.get('links') or []
    for l in raw_links[:b['max_links']]:
        if isinstance(l, dict):
            links.append({'url': ru(l.get('url') or l.get('href')), 'label': rt(l.get('label') or l.get('text'), 100), 'area': _s(l.get('area'), 30), 'relation': _s(l.get('relation') or l.get('rel'), 30)})
    om['links'] = max(0, len(raw_links) - len(links))
    errs, seen = [], set()
    evs = [dict(e,kind='console_error' if e.get('type')=='console' else e.get('type')) for e in snap.get('events') or [] if isinstance(e, dict) and (e.get('type') in ('pageerror','requestfailed') or e.get('type')=='console' and e.get('level')=='error')]
    evs += [dict(r, kind='http_error') for r in snap.get('resources') or [] if isinstance(r, dict) and isinstance(r.get('status'), int) and r['status'] >= 400]
    evs += [dict(e, kind='dom_error_candidate', action_id=snap.get('action_id')) for e in snap.get('error_candidates') or [] if isinstance(e,dict)]
    for e in evs:
        k = e.get('event_id') or (e.get('kind'), e.get('url'), e.get('status'),e.get('text'),e.get('source'))
        if k in seen:
            continue
        seen.add(k)
        errs.append({'kind': e.get('kind'), 'event_id': _s(e.get('event_id'), 60), 'url': ru(e.get('url')), 'status': e.get('status') if isinstance(e.get('status'), int) else None,
                     'text': rt(e.get('text') or e.get('message'), 200), 'action_id': _s(e.get('action_id'), 60),
                     'visible': e.get('visible') if isinstance(e.get('visible'),bool) else None,
                     'source': _s(e.get('source'),80)})
    om['errors'] = max(0, len(errs) - b['max_errors'])
    errs = errs[:b['max_errors']]
    body = str(snap.get('text') or snap.get('body_text') or '')
    om['text_chars'] = max(0, len(body) - b['text_chars'])
    body = rt(body, b['text_chars']) or ''
    page_url = ru(snap.get('final_url') or snap.get('requested_url'))
    pag = [l for l in links if l['url'] and any(t in l['url'].lower() for t in ('page=', 'offset=', 'p='))]
    out = {'schema_version': 'ai_input/1', 'content_trust': 'untrusted_page_data', 'full_ref': {'snapshot_id': sid},
           'page': {'url': page_url, 'title': rt(snap.get('title'), 200), 'snapshot_id': sid, 'parent_snapshot_id': _s(snap.get('parent_snapshot_id'), 100),
                    'action_id': _s(snap.get('action_id'), 100), 'page_role': _s(snap.get('page_role'), 40) or 'unknown',
                    'http_status': snap.get('main_status') if isinstance(snap.get('main_status'), int) else None},
           'quality': quality, 'readiness': readiness, 'controls': controls, 'hidden_control_count': hidden_count, 'forms': forms, 'links': links,
           'errors': errs, 'untrusted_text': body, 'feature_candidates': [], 'test_families': {}, 'warnings': [], 'omitted': om, 'source_truncated': src_trunc}
    complete = quality['status'] == 'complete' and not src_trunc and not quality['unknown_fields']
    if readiness['status'] != 'ready_selector_found':
        out['warnings'].append('readiness_unverified')
    if (q.get('unsupported') or {}).get('iframes') or (q.get('unsupported') or {}).get('open_shadow_roots'):
        complete = False
        out['warnings'].append('unsupported_regions')

    def refresh():
        keys = {c['key'] for c in out['controls']}
        miss = 0
        for f in out['forms']:
            for fk in ('field_keys', 'submitter_keys'):
                kept = [k for k in f[fk] if k in keys]
                miss += len(f[fk]) - len(kept)
                f[fk] = kept
        om['missing_refs'] += miss
        if not out.get('_feat_dropped'):
            fc = []
            for f in out['forms']:
                fcs = [c for c in out['controls'] if c['form_key'] == f['form_key']]
                if any(c['type'] == 'password' for c in fcs) and f['submitter_keys']:
                    fc.append({'kind': 'login_form_candidate', 'basis': 'password+submitter same form', 'evidence_keys': [c['key'] for c in fcs][:10], 'uncertainty': 'password forms can serve other purposes'})
                elif f['field_keys']:
                    fc.append({'kind': 'form_candidate', 'basis': 'form with fields', 'evidence_keys': f['field_keys'][:10], 'uncertainty': 'purpose unverified'})
            s = [c['key'] for c in out['controls'] if c['type'] == 'search' or c['role'] == 'searchbox']
            if s:
                fc.append({'kind': 'search_candidate', 'basis': 'search type/role', 'evidence_keys': s[:10], 'uncertainty': 'behavior unverified'})
            if any(l in out['links'] for l in pag):
                fc.append({'kind': 'pagination_candidate', 'basis': 'page query links', 'evidence_keys': [], 'uncertainty': 'behavior unverified'})
            out['feature_candidates'] = fc[:20]
        ev = {'functional': [c['key'] for c in out['controls'] if c['tag']=='button' or c['role']=='button' or c['_submit']],
              'input_validation': [c['key'] for c in out['controls'] if c['tag'] in ('input','select','textarea') and c['type'] not in ('hidden','submit','button','reset','image')],
              'routing': [], 'ui': [c['key'] for c in out['controls'] if c['visible']]}
        pos = {'routing': bool(out['links']) or bool(raw_links)}
        for n, ks in ev.items():
            has = bool(ks) or pos.get(n, False)
            out['test_families'][n] = {'availability': 'available' if has else ('none_observed' if complete and not om['controls'] else 'unknown'), 'evidence_keys': ks[:10], 'ai_tested': False}

    def fit():
        out['sizes'] = {'source_json_bytes': src_bytes, 'ai_input_bytes': 0, 'budget_bytes': b['max_bytes']}
        for _ in range(10):
            n = _ai_bytes(out)
            if n == out['sizes']['ai_input_bytes']:
                return n
            out['sizes']['ai_input_bytes'] = n
        return n
    refresh()
    while True:
        tmp = {k: v for k, v in out.items() if k != '_feat_dropped'}
        out.pop('_feat_dropped', None)
        out.clear(); out.update(tmp)
        for c in out['controls']:
            c.pop('_submit', None) if False else None
        if fit() <= b['max_bytes']:
            break
        if 'budget_truncated' not in out['warnings']:
            out['warnings'].append('budget_truncated')
        if out['links']:
            out['links'].pop(); om['links'] += 1
        elif out['untrusted_text']:
            cut = max(0, len(out['untrusted_text']) // 2 - 50)
            om['text_chars'] += len(out['untrusted_text']) - cut
            out['untrusted_text'] = out['untrusted_text'][:cut]
        elif out['controls']:
            nr = [i for i, c in enumerate(out['controls']) if not c['required']]
            out['controls'].pop(nr[-1] if nr else -1); om['controls'] += 1
        elif out['forms']:
            out['forms'].pop(); om['forms'] += 1
        elif out['errors']:
            out['errors'].pop(); om['errors'] += 1
        elif out['feature_candidates']:
            om['feature_candidates'] += len(out['feature_candidates'])
            out['feature_candidates'] = []
            out['_feat_dropped'] = True
            refresh()
            out.pop('_feat_dropped', None)
            out['feature_candidates'] = []
            for f in out['test_families'].values():
                f['details_omitted'] = True
            if fit() <= b['max_bytes']:
                break
            raise ValueError('irreducible core exceeds max_bytes')
        else:
            raise ValueError('irreducible core exceeds max_bytes')
        refresh()
    for c in out['controls']:
        c.pop('_submit', None)
    fit()
    return out
