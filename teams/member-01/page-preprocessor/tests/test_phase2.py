import asyncio, contextlib, copy, importlib, inspect, json, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import pytest

def find(name):
    if name == 'PageCollector':
        from wtp_preprocessor.collector import PageCollector
        return PageCollector
    if name == 'crawl':
        from wtp_preprocessor.crawl import crawl
        return crawl
    from wtp_preprocessor import preprocess
    return getattr(preprocess, name)

def jsize(o):
    return len(json.dumps(o, separators=(',', ':'), ensure_ascii=False).encode('utf-8'))

SECRET = 'SENTINEL_SECRET_VALUE_42'

def el(eid, i, **kw):
    d = dict(element_id=eid, index=i, tag='input', type='text', id_attr=None, id_unique=False, testid=None,
             testid_unique=False, locator={'strategy':'css','selector':'input:nth-of-type(%d)' % (i+1)}, locator_status='verified', form=None,
             visible=True, disabled=False, value=SECRET, value_present=True, value_length=len(SECRET), name='f%d' % i)
    d.update(kw)
    return d

def snap(elements, forms=(), truncated=None):
    return dict(final_url='http://127.0.0.1/', requested_url='http://127.0.0.1/', main_status=200, page_role='html_page',
                quality=dict(status='complete' if not truncated else 'partial', truncated=truncated or {}, unknown_fields=[]),
                elements=elements, forms=list(forms), links=[], errors=[], text='')

# ---------- pure ----------
def test_classify_link():
    cl = find('classify_link')
    cur = 'http://h.test/doc'
    r = cl('http://h.test/doc#sec', cur, dom_ids=('sec',))
    assert r['target_url'].endswith('/doc#sec') and r['queue_url'] is None and r['anchor_alias']
    for frag in ('#/route', '#!r'):
        r = cl('http://h.test/doc' + frag, cur)
        assert r['queue_url'] and r['queue_url'].endswith(frag)
    r = cl('http://h.test/other#x', cur)
    assert r['queue_url'] is not None
    r = cl('http://h.test/p?b=2&a=1&a=1', cur)
    assert 'b=2&a=1&a=1' in r['queue_url']
    for k in ('kind', 'fragment_kind', 'hints', 'reason'):
        assert k in r
    for bad in ('javascript:alert(1)', 'data:text/html,x', 'http://u:p@h.test/'):
        with pytest.raises(ValueError):
            cl(bad, cur)

def test_classify_response():
    cr = find('classify_response')
    r = cr(200, 'text/html; charset=utf-8', 'http://h/x.json')
    assert r['page_role'] == 'html_page' and r['callback_eligible']
    r = cr(404, 'text/html', 'http://h/missing')
    assert r['is_error'] and r['callback_eligible'] and r['page_role'] == 'html_page'
    r = cr(200, 'application/json', 'http://h/api')
    assert r['page_role'] == 'json' and not r['callback_eligible']
    assert cr(200, 'application/pdf', 'http://h/f.pdf')['page_role'] == 'file'

def test_parse_sitemap():
    ps = find('parse_sitemap')
    body = b'<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + b''.join(
        b'<url><loc>/p%d</loc></url>' % i for i in range(20)) + b'</urlset>'
    r = ps(body, 'http://h.test/', max_urls=5)
    assert len(r['urls']) == 5 and r['truncated'] and not r['is_index']
    assert all(u.startswith('http://h.test/') for u in r['urls'])
    evil = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "a">]><urlset><url><loc>&e;</loc></url></urlset>'
    for b in (evil.encode(), evil.encode('utf-16')):
        r = ps(b, 'http://h.test/')
        assert r['errors'] and not r['urls']
    assert ps(b'<urlset><url>', 'http://h.test/')['errors']
    assert ps(b'<urlset>' + b' ' * 3000 + b'</urlset>', 'http://h.test/', max_bytes=1000)['errors']
    idx = b'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>http://h.test/s2.xml</loc></sitemap></sitemapindex>'
    r = ps(idx, 'http://h.test/')
    assert r['is_index'] and not r['urls']

def _keyed(order, ids):
    els = [el(ids[0], 0, id_attr='user', id_unique=True, form='F'), el(ids[1], 1, testid='pw', testid_unique=True, type='password', form='F'),
           el(ids[2], 2, tag='button', type='submit', form='F'), el(ids[3], 3, id_attr='dup', id_unique=False)]
    s = snap([els[i] for i in order], forms=[dict(key='F', id='login', name=None, fields=ids[:2], submitters=[ids[2]])])
    find('assign_element_keys')(s)
    return s

def test_element_keys_stable():
    a = _keyed([0, 1, 2, 3], ['a1', 'a2', 'a3', 'a4'])
    b = _keyed([3, 2, 1, 0], ['z9', 'z8', 'z7', 'z6'])
    ka = {e['element_id']: e['element_key'] for e in a['elements']}
    kb = {e['element_id']: e['element_key'] for e in b['elements']}
    assert ka['a1'] == kb['z9'] and ka['a2'] == kb['z8']
    assert ka['a4'] != ka['a1']
    f = a['forms'][0]
    assert f['form_key'] and len(f['field_keys']) == 2 and len(f['submitter_keys']) == 1
    assert all(e.get('form_key') == f['form_key'] for e in a['elements'] if e['form'] == 'F')
    g = find('get_by_element_key')
    got = g(a, ka['a1'])
    got['tag'] = 'mutated'
    assert g(a, ka['a1'])['tag'] == 'input'

def test_diff_snapshots():
    a = _keyed([0, 1, 2, 3], ['a1', 'a2', 'a3', 'a4'])
    b = copy.deepcopy(a)
    for e in b['elements']:
        if e['element_id'] == 'a1':
            e['disabled'] = True
            e['value'] = SECRET + 'X'
    d = find('diff_snapshots')(a, b)
    assert SECRET not in json.dumps(d)
    ch = d['changed']
    assert any('disabled' in c['changes'] for c in ch)
    assert all('value' not in c['changes'] for c in ch)
    c = copy.deepcopy(a)
    c['elements'] = c['elements'][:1]
    c['quality'] = dict(status='partial', truncated={'elements': 3}, unknown_fields=[])
    d2 = find('diff_snapshots')(a, c)
    assert d2.get('uncertain') and not d2.get('removed')

def test_build_ai_input_budget_and_safety():
    els = [el('e%d' % i, i, id_attr='id%d' % i, id_unique=True, label='L' * 500, unknownz='?' * 900) for i in range(200)]
    s = snap(els, truncated={'elements': 50})
    s['links'] = [dict(href='http://h/q?%d=%s' % (i, 'x' * 300), text='t') for i in range(200)]
    find('assign_element_keys')(s)
    ai = find('build_ai_input')(s)
    assert ai['schema_version'] == 'ai_input/1' and ai['content_trust'] == 'untrusted_page_data'
    assert jsize(ai) <= 12 * 1024 and ai['sizes']['ai_input_bytes'] == jsize(ai)
    assert set(['functional', 'input_validation', 'routing', 'ui']) <= set(ai['test_families'])
    for f in ai['test_families'].values():
        assert f['availability'] in ('available', 'unknown', 'none_observed') and f['ai_tested'] is False
    assert ai['quality']['truncated'] and SECRET not in json.dumps(ai)
    keys = {e['element_key'] for e in s['elements']}
    assert ai['controls'] and all(c['key'] in keys for c in ai['controls'])
    assert ai['omitted']
    small = find('build_ai_input')(s, budget=dict(max_bytes=2048, max_controls=0, max_links=0, text_chars=0, max_errors=0))
    assert jsize(small) <= 2048 and small['controls'] == []


def test_dom_errors_and_state_are_preserved_in_summary():
    s = _keyed([0,1,2,3],['a','b','c','d'])
    s['elements'][0].update(aria_invalid='true',described_by='Please enter a username',value_present=True,value_length=6)
    s['error_candidates'] = [{'text':'Bad username','visible':True,'source':'aria'}, {'text':'Hidden warning','visible':False,'source':'aria'}]
    s['events'] = [{'type':'console','level':'error','text':'client failed','event_id':'ev-1','action_id':'act-1'}]
    ai=find('build_ai_input')(s)
    control=next(c for c in ai['controls'] if c['key']==s['elements'][0]['element_key'])
    assert control['value_present'] is True and control['value_length']==6
    assert control['aria_invalid']=='true' and control['locator_verified']
    assert {'Bad username','Hidden warning','client failed'} <= {e['text'] for e in ai['errors']}
    assert ai['page']['url']==s['final_url'] and ai['page']['http_status']==200
    assert any(f['kind']=='login_form_candidate' for f in ai['feature_candidates'])


def test_request_origin_does_not_follow_active_action(tmp_path):
    from wtp_preprocessor.evidence import SnapshotAPI
    class Collector:
        out=tmp_path
    class Request: pass
    api=SnapshotAPI(Collector()); request=Request()
    api.active_action_id='old'; api.on_request(request)
    api.active_action_id='new'
    assert api.event_meta('response',request)['action_id']=='old'
    assert api.event_meta('response',Request())['action_id'] is None
    assert api.event_meta('console')['action_id']=='new'

# ---------- browser fixture ----------
PAGES = {
    '/': '<html><body><a href="/doc2#sec">d</a><a href="/#/route">r</a><a href="/#sec">s</a><a href="/api.json">j</a>'
         '<a href="/sitemap.xml">sm</a><a href="/file.pdf">f</a><a href="/missing">m</a><a href="/q?b=2&a=1">q</a>'
         '<h2 id="sec">S</h2><form id="login"><input id="u" name="u"><input type="password" id="p" name="p">'
         '<button type="submit" id="go">Go</button></form><button id="rev" onclick="var a=document.createElement(\'a\');'
         'a.href=\'/fresh\';a.textContent=\'fresh\';document.body.appendChild(a)">reveal</button></body></html>',
    '/doc2': '<html><body><h1 id="sec">doc2</h1></body></html>', '/q': '<html><body>q</body></html>',
    '/child': '<html><body>child</body></html>', '/fresh': '<html><body>fresh</body></html>',
}
PAGES['/'] += '<input type="checkbox" id="flag"><div role="alert" hidden>Hidden validation error</div>'

class H(BaseHTTPRequestHandler):
    log = []
    def log_message(self, *a): pass
    def _send(self, code, ctype, body, head=False, length=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(length if length is not None else len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)
    def _route(self, head):
        H.log.append((self.command, self.path))
        p = self.path.split('?')[0]
        if p in PAGES:
            return self._send(200, 'text/html; charset=utf-8', PAGES[p].encode(), head)
        if p == '/api.json':
            return self._send(200, 'application/json; charset=utf-8', b'{"ok":true}', head)
        if p == '/late':
            import time
            time.sleep(1.5)
            return self._send(200,'application/json',b'{"ok":true}',head)
        if p == '/sitemap.xml':
            b = ('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://%s/child</loc></url>'
                 '<url><loc>http://%s/private/x</loc></url></urlset>' % ((self.headers['Host'],) * 2)).encode()
            return self._send(200, 'application/xml; charset=utf-8', b, head)
        if p == '/robots.txt':
            return self._send(200, 'text/plain; charset=utf-8', b'User-agent: *\nDisallow: /private\n', head)
        if p == '/file.pdf':
            return self._send(200, 'application/pdf', b'' if head else b'%PDF', head, length=50_000_000 if head else 4)
        self._send(404, 'text/html; charset=utf-8', b'<html><body>not found</body></html>', head)
    def do_GET(self): self._route(False)
    def do_HEAD(self): self._route(True)

@pytest.fixture
def server():
    H.log = []
    srv = ThreadingHTTPServer(('127.0.0.1', 0), H)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        yield 'http://127.0.0.1:%d' % srv.server_address[1]
    finally:
        srv.shutdown(); srv.server_close(); t.join(5)

async def _browser(pw):
    try:
        return await pw.chromium.launch()
    except Exception as e:
        if "Executable doesn't exist" in str(e):
            pytest.skip('chromium missing')
        raise

def test_collector_snapshot_and_actions(server, tmp_path):
    from playwright.async_api import async_playwright
    PC = find('PageCollector')
    async def run():
        async with async_playwright() as pw:
            b = await _browser(pw)
            page = await b.new_page()
            c = PC(page, tmp_path, timeout=3, summary_budget={'max_bytes': 4096})
            await c.open_page(server + '/missing')
            s404 = await c.snapshot()
            assert s404['main_status'] == 404 and s404['page_role'] == 'html_page'
            assert s404['artifacts']['initial_response'] and s404['artifacts']['initial_html']
            await c.open_page(server + '/')
            s1 = await c.snapshot()
            assert s1['schema_version'] == '0.2' and 'content_type' in s1
            assert all('element_key' in e for e in s1['elements']) and s1['forms'][0]['form_key']
            api = c.api
            ai = api.get_ai_input(s1['snapshot_id'])
            assert jsize(ai) <= 4096 and (tmp_path/s1['ai_input_ref']).is_file()
            assert any(f['kind']=='login_form_candidate' for f in ai['feature_candidates'])
            ai['x'] = 1
            assert 'x' not in api.get_ai_input(s1['snapshot_id'])
            with pytest.raises(Exception):
                api.get_ai_input('nope')
            await page.evaluate("location.hash='sec'")
            s2 = await c.snapshot()
            assert s2['navigation']['kind'] == 'same_document' and s2['main_status'] == s1['main_status']
            assert await page.evaluate('document.querySelectorAll("[data-element-id],[data-pw-id]").length') == 0
            key = next(e['element_key'] for e in s1['elements'] if e.get('id_attr') == 'rev')
            async with api.action('a1', 'click', key):
                await page.click('#rev')
            rec = json.loads((tmp_path / 'actions' / 'a1.json').read_text())
            assert rec['status'] == 'completed' and 'event_ids' in rec and 'resource_ids' in rec
            with pytest.raises(ZeroDivisionError):
                async with api.action('a2', 'click', key):
                    1 / 0
            assert api.active_action_id is None and api.records[-1]['status'] == 'failed'
            async with api.action('a3', 'click', key):
                with pytest.raises(RuntimeError):
                    async with api.action('a4', 'click', key):
                        pass
                assert api.active_action_id == 'a3'
            ran = []
            for bad in ('../x', 'a1','newline\n'):
                with pytest.raises(Exception):
                    async with api.action(bad, 'click', key):
                        ran.append(bad)
            assert ran == [] and isinstance(api.records[0], dict)
            async with api.action('check','check') as checked:
                await page.check('#flag')
            assert any('checked' in e['changes'] for e in checked['diff']['changed'])
            await page.evaluate("() => { window.priorRequest=fetch('/late'); }")
            async with api.action('new-request-window','wait') as delayed:
                await page.wait_for_timeout(1700)
            after=api.snapshots[delayed['after_snapshot_id']]
            late=next(r for r in after['resources'] if r.get('url','').endswith('/late'))
            assert late['origin_action_id'] is None
            with pytest.raises(asyncio.CancelledError):
                async with api.action('cancelled','wait'):
                    raise asyncio.CancelledError()
            assert api.records[-1]['status']=='cancelled' and api.active_action_id is None
            await c.close()
            await b.close()
    asyncio.run(run())

def test_crawl_fixture(server, tmp_path):
    crawl = find('crawl')
    seen = []
    async def cb(*args, **kw):
        api = next(a for a in list(args) + list(kw.values()) if hasattr(a, 'action'))
        page = next(a for a in list(args) + list(kw.values()) if hasattr(a, 'click'))
        seen.append(page.url)
        if page.url.rstrip('/') == server:
            snap0 = await api.snapshot() if hasattr(api, 'snapshot') else None
            async with api.action('rev1', 'click', None):
                await page.click('#rev')
    def go():
        r = crawl(server + '/', str(tmp_path), max_pages=20, max_runtime=60, page_delay=0, page_callback=cb)
        if inspect.iscoroutine(r):
            r = asyncio.run(r)
        return r
    from playwright.async_api import Error as PWError
    try:
        go()
    except PWError as e:
        if "Executable doesn't exist" in str(e):
            pytest.skip('chromium missing')
        raise
    gets = [p for m, p in H.log if m == 'GET']
    assert '/child' in gets and not any(p.startswith('/private') for _, p in H.log)
    assert ('HEAD', '/file.pdf') in H.log and ('GET', '/file.pdf') not in H.log
    assert ('HEAD', '/doc2') not in H.log and gets.count('/') >= 1
    assert not any(u.endswith('/api.json') for u in seen)
    assert any(u.endswith('/fresh') for u in seen) or '/fresh' in gets
    blob = '\n'.join(p.read_text(errors='ignore') for p in tmp_path.rglob('*.json'))
    assert 'not_run' in blob and 'after_action' in blob and 'rev1' in blob
    assert (tmp_path / 'actions').exists() or 'actions' in blob


def test_failed_action_still_enqueues_actual_private_url(server, tmp_path):
    async def callback(page,snapshot,api):
        if page.url == server+'/':
            async with api.action('failed-link','click'):
                await page.evaluate("document.body.insertAdjacentHTML('beforeend','<a href=\"/fresh?token=ALPHA_SENTINEL\">private link</a>')")
                raise RuntimeError('operator failure')
        return {'test_status':'not_run'}
    asyncio.run(find('crawl')(server+'/',tmp_path,max_pages=20,max_runtime=60,page_delay=0,page_callback=callback))
    assert ('GET','/fresh?token=ALPHA_SENTINEL') in H.log
    graph=json.loads((tmp_path/'graph.json').read_text(encoding='utf-8'))
    assert 'ALPHA_SENTINEL' not in json.dumps(graph)
    root=next(n for n in graph['nodes'] if n['url']==server+'/')
    assert root['callback_status']=='error' and len(root['snapshots'])>=3
    assert any(e.get('action_id')=='failed-link' for e in graph['edges'])
