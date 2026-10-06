import asyncio, json, threading, logging
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import pytest
import time

from wtp_preprocessor.crawl import normalize_url, same_origin, URLQueue, RobotsPolicy, crawl

logging.getLogger('asyncio').setLevel(logging.CRITICAL)
SECRET = 'SENTINEL_SECRET_42'

ROOT = '''<html><head><title>Root</title></head><body>
<a href="/a">A</a><a href="/b">B one</a><a href="/b">B two</a>
<a href="http://example.test/x">Ext</a><a href="/blocked">Blocked</a>
<a href="/redirect">Redir</a><a href="/?q=1&q=2">Q</a></body></html>'''
FORM = '''<html><head><title>Form</title><link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/missing.css"><script src="/app.js"></script></head><body>
<span id="lbl">Email label</span>
<form id="f" action="/submit"><input id="em" type="email" required pattern=".+@x" aria-labelledby="lbl">
<select id="sel"><option value="1">One</option><option value="2" selected>Two</option></select>
<input id="cb" type="checkbox" checked aria-label="Agree">
<input type="password" value="''' + SECRET + '''"><input type="hidden" name="tok" value="''' + SECRET + '''">
<button>Send</button></form>
<input id="ext" form="f" name="outside" aria-label="Outside">
<div role="alert" hidden>Hidden error</div>
<button>Dup</button><button>Dup</button>
<button id="rev" onclick="document.getElementById('later').hidden=false">Reveal</button>
<a id="later" href="/later" hidden>Later</a>
<script>console.error('boom ''' + SECRET + ''' /x?token=''' + SECRET + '''');
setTimeout(()=>{throw new Error('jsfail')},0);
document.addEventListener('DOMContentLoaded',()=>{window.__muts=0;new MutationObserver(m=>{window.__muts+=m.length}).observe(document.documentElement,{subtree:true,attributes:true,childList:true,characterData:true});});</script>
</body></html>'''
PAGES = {'/': ROOT, '/a': '<a href="/">root</a><a href="/b">b</a>', '/b': '<p>plain b</p>',
         '/later': '<p>later</p>', '/blocked': '<p>no</p>', '/form': FORM}


class State:
    # 테스트 서버 상태 보관
    def __init__(self):
        self.requests = []; self.robots_status = 200
        self.robots = 'User-agent: *\nAllow: /blocked/ok\nDisallow: /blocked\nDisallow: /*.pdf$\n'


@pytest.fixture
def server():
    # 로컬 HTTP 서버 기동
    st = State()
    class H(BaseHTTPRequestHandler):
        # 로그 억제
        def log_message(self, *a): pass
        # GET 처리
        def do_GET(self):
            p = self.path.split('?')[0]; st.requests.append(self.path)
            if p == '/robots.txt':
                self.send_response(st.robots_status); self.end_headers()
                if st.robots_status == 200: self.wfile.write(st.robots.encode())
                return
            if p == '/redirect':
                self.send_response(302); self.send_header('Location', '/b'); self.end_headers(); return
            if p in ('/hop1', '/hop2', '/external-redirect'):
                location = {'/hop1': '/hop2', '/hop2': '/blocked', '/external-redirect': f'http://localhost:{self.server.server_port}/outside'}[p]
                self.send_response(302); self.send_header('Location', location); self.end_headers(); return
            types = {'/style.css': ('text/css', 'body{color:red}'), '/app.js': ('application/javascript', 'window.ok=1')}
            if p in types:
                self.send_response(200); self.send_header('Content-Type', types[p][0]); self.end_headers(); self.wfile.write(types[p][1].encode()); return
            body = PAGES.get(p)
            if body is None:
                self.send_response(404); self.end_headers(); return
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers(); self.wfile.write(body.encode())
    srv = ThreadingHTTPServer(('127.0.0.1', 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    st.base = f'http://127.0.0.1:{srv.server_address[1]}'
    yield st
    srv.shutdown(); srv.server_close()


# 크로미움 실행 또는 실행파일 부재시만 skip
async def launch(pw):
    try:
        return await pw.chromium.launch(headless=True)
    except Exception as e:
        if "Executable doesn't exist" in str(e): pytest.skip('chromium missing')
        raise


# URL 정규화 및 출처 비교 검증
def test_url_helpers():
    assert normalize_url('/p?b=2&b=1#h', 'http://h.test/x') .startswith('http://h.test/p?b=2&b=1')
    assert same_origin('http://h.test/a', 'http://h.test/b')
    assert not same_origin('http://h.test/a', 'http://example.test/a')
    with pytest.raises(ValueError): normalize_url('javascript:alert(1)')


# 큐 FIFO 및 중복 URL 다른 엣지 유지 검증
def test_queue_fifo_edges():
    q = URLQueue('http://h.test/')
    assert q.pop() == 'http://h.test/'
    assert q.enqueue('http://h.test/a', source='http://h.test/', label='A1')
    q.enqueue('http://h.test/b', source='http://h.test/')
    assert not q.enqueue('http://h.test/a', source='http://h.test/', label='A2')
    assert q.pop() == 'http://h.test/a' and q.pop() == 'http://h.test/b'
    labels = {e['label'] for e in q.export()['edges']}
    assert {'A1', 'A2'} <= labels
    assert all(n['test_status'] == 'not_run' for n in q.export()['nodes'])


# robots 규칙/상태코드별 정책 검증
def test_robots(server):
    from playwright.async_api import async_playwright
    async def run():
        async with async_playwright() as pw:
            rc = await pw.request.new_context()
            try:
                pol = RobotsPolicy(retries=1, base_delay=0)
                b = server.base
                assert (await pol.check(b + '/blocked', rc))[1] == 'excluded_robots'
                assert (await pol.check(b + '/blocked/ok', rc))[0]
                assert (await pol.check(b + '/guide.pdf', rc))[1] == 'excluded_robots'
                assert (await pol.check(b + '/a', rc))[1] == 'allowed'
                for code, exp in ((404, 'allowed_no_robots'),):
                    server.robots_status = code
                    assert (await RobotsPolicy(base_delay=0).check(b + '/a', rc))[1] == exp
                server.robots_status = 503; n = len(server.requests)
                ok, r = await RobotsPolicy(retries=1, base_delay=0).check(b + '/a', rc)
                assert not ok and r.startswith('deferred_robots')
                assert server.requests[n:].count('/robots.txt') >= 2
                server.robots_status = 403; n = len(server.requests)
                ok, r = await RobotsPolicy(retries=2, base_delay=0).check(b + '/a', rc)
                assert not ok and server.requests[n:].count('/robots.txt') == 1
            finally:
                await rc.dispose()
    asyncio.run(run())


# 수집기 스냅샷 폼/상태/리소스/보안 검증
def test_collector_snapshot(server, tmp_path):
    from playwright.async_api import async_playwright
    from wtp_preprocessor.collector import PageCollector
    async def run():
        async with async_playwright() as pw:
            br = await launch(pw)
            try:
                page = await br.new_page()
                col = PageCollector(page, tmp_path, timeout=3)
                await col.open_page(server.base + '/form')
                s = await col.snapshot()
                assert s['quality']['status']
                els = s['elements']
                def find(pred): return [e for e in els if pred(e)]
                em = find(lambda e: 'Email label' in json.dumps(e))
                assert em and json.dumps(em[0]).count('required')
                assert find(lambda e: 'Outside' in json.dumps(e) and e.get('form'))
                assert find(lambda e: 'Agree' in json.dumps(e) and e.get('checked') is True)
                sel = find(lambda e: e.get('options'))
                assert any(o.get('selected') for o in sel[0]['options'] if 'Two' in json.dumps(o))
                dups = find(lambda e: 'Dup' in json.dumps(e) and e.get('locator'))
                assert len(dups) >= 2 and dups[0]['locator'] != dups[1]['locator']
                assert all('locator_status' in e for e in dups)
                assert 'Hidden error' in json.dumps(s['error_candidates'])
                res = json.dumps(s['resources'])
                assert 'style.css' in res and 'app.js' in res and 'missing.css' in res
                ev = json.dumps(s['events'])
                assert 'jsfail' in ev or 'boom' in ev
                assert await page.evaluate('window.__muts') == 0
                assert SECRET not in json.dumps(s)
                assert s['artifacts']['initial_html'] and s['artifacts']['rendered_dom'] and s['artifacts']['screenshot']
                original = Path(s['artifacts']['initial_html']).read_bytes()
                assert b'Email label' in original
                form_dir = Path(s['artifacts']['raw_page_dir'])
                import hashlib
                assert form_dir == tmp_path / 'raw' / hashlib.sha256(normalize_url(server.base + '/form').encode()).hexdigest()
                assert all(Path(path).parent == form_dir for key, path in s['artifacts'].items() if path and key != 'raw_page_dir')
                assert all(Path(r['path']).parent == form_dir for r in s['resources'] if r.get('path'))
                assert list(form_dir.glob('*.css')) and list(form_dir.glob('*.js')) and list(form_dir.glob('*.png'))
                saved = list((tmp_path / 'snapshots').glob('*.json'))
                assert saved and all(SECRET not in p.read_text('utf-8') for p in saved)
                await page.click('#rev')
                s2 = await col.snapshot('after_action', s['snapshot_id'])
                assert s2['parent_snapshot_id'] == s['snapshot_id']
                assert s2['artifacts']['initial_html'] == s['artifacts']['initial_html']
                assert any(l['url'].endswith('/later') for l in col.last_links)
                from wtp_preprocessor.collector import record_raw_snapshot
                record_raw_snapshot(form_dir, s2)
                index = json.loads((form_dir / 'page.json').read_text('utf-8'))
                assert [e['snapshot_id'] for e in index['snapshots']] == [s['snapshot_id'], s2['snapshot_id']]
                assert SECRET not in json.dumps(index)
                assert all((tmp_path / e['snapshot_ref']).is_file() and (tmp_path / e['ai_input_ref']).is_file() for e in index['snapshots'])
                # A delayed response keeps the directory captured before the next visit.
                from types import SimpleNamespace
                started, release = asyncio.Event(), asyncio.Event()
                async def delayed_body():
                    started.set()
                    await release.wait()
                    return b'/* delayed first-page stylesheet */'
                response = SimpleNamespace(url=server.base + '/style.css', status=200, headers={}, body=delayed_body)
                late = asyncio.create_task(col._save_body(response, 'stylesheet', 'css', directory=form_dir))
                await started.wait()
                await col.open_page(server.base + '/b')
                release.set()
                await late
                s3 = await col.snapshot()
                assert s3['artifacts']['initial_html'] != s['artifacts']['initial_html']
                assert b'plain b' in Path(s3['artifacts']['initial_html']).read_bytes()
                assert 'Email label' not in json.dumps(s3['elements'])
                b_dir = Path(s3['artifacts']['raw_page_dir'])
                assert b_dir != form_dir and b_dir.parent == form_dir.parent
                assert json.loads((b_dir / 'page.json').read_text('utf-8'))['snapshots'][0]['snapshot_id'] == s3['snapshot_id']
                assert any(b'delayed first-page stylesheet' in p.read_bytes() for p in form_dir.glob('*.css'))
                assert not list(b_dir.glob('*.css'))
                assert {p.name for p in (tmp_path / 'raw').iterdir() if p.is_file()} == {'README.txt'}
                await col.close()
            finally:
                await br.close()
    asyncio.run(run())


# 크롤 그래프/범위/robots/리다이렉트 검증
def test_crawl_graph(server, tmp_path):
    s = asyncio.run(crawl(server.base + '/', tmp_path, max_pages=10, max_runtime=60, page_delay=0, collection_timeout=3))
    g = json.loads((tmp_path / 'graph.json').read_text('utf-8'))
    st = {n['url'].split('?')[0].replace(server.base, ''): n for n in g['nodes'] if server.base in n['url']}
    assert st['/a']['status'] in ('collected', 'visited')
    assert st['/blocked']['status'] not in ('collected', 'visited')
    assert any('example.test' in n['url'] and n['status'] == 'out_of_scope' for n in g['nodes'])
    assert all(n['test_status'] == 'not_run' for n in g['nodes'])
    assert any(e['discovered_by'] == 'redirect' and e['observed_navigation'] for e in g['edges'])
    assert '/blocked' not in server.requests
    assert not any('example.test' in r for r in server.requests)
    assert s['pages_visited'] >= 3 and 'termination_reason' in s
    assert (tmp_path / 'urls.jsonl').exists() and (tmp_path / 'run_summary.json').exists()


# 콜백이 새 링크와 테스트 상태 반영 검증
def test_crawl_callback(server, tmp_path):
    async def cb(page, snap, take):
        if '/form' not in page.url: return {'test_status': 'passed'}
        await page.click('#rev')
        await page.evaluate("document.body.insertAdjacentHTML('beforeend', '<a href=\"/new-action-link\">New link</a>')")
        s2 = await take('after_action', snap['snapshot_id'])
        assert s2['parent_snapshot_id'] == snap['snapshot_id']
        return {'test_status': 'passed', 'snapshots': [s2],
                'discovered_urls': [{'url': server.base + '/later', 'label': 'Later', 'action_id': 'act1'}]}
    asyncio.run(crawl(server.base + '/form', tmp_path, max_pages=3, max_runtime=60, page_delay=0, collection_timeout=3, page_callback=cb))
    g = json.loads((tmp_path / 'graph.json').read_text('utf-8'))
    assert any(n['url'].endswith('/later') for n in g['nodes'])
    assert any(e.get('action_id') == 'act1' for e in g['edges'])
    assert any(n['url'].endswith('/new-action-link') for n in g['nodes'])
    assert any(n['test_status'] == 'passed' for n in g['nodes'])


# max_pages 제한 시 대기열 기록 검증
def test_max_pages_pending(server, tmp_path):
    s = asyncio.run(crawl(server.base + '/', tmp_path, max_pages=1, max_runtime=60, page_delay=0, collection_timeout=3))
    assert s['pages_visited'] == 1 and s['pending_count'] > 0
    assert s['termination_reason'] == 'max_pages'
    g = json.loads((tmp_path / 'graph.json').read_text('utf-8'))
    assert g['pending']


@pytest.mark.parametrize('path,forbidden', [('/hop1', '/blocked'), ('/external-redirect', '/outside')])
def test_redirect_destination_never_requested(server, tmp_path, path, forbidden):
    calls = []
    async def callback(*args):
        calls.append(True)
        return {'test_status': 'passed'}
    asyncio.run(crawl(server.base + path, tmp_path, max_pages=5, max_runtime=15,
                      page_delay=0, collection_timeout=3, page_callback=callback))
    assert forbidden not in server.requests
    assert not calls
    graph = json.loads((tmp_path / 'graph.json').read_text('utf-8'))
    assert all(n['test_status'] == 'not_run' for n in graph['nodes'])
    assert any(e['discovered_by'] == 'blocked_redirect' and not e['observed_navigation'] for e in graph['edges'])


def test_sensitive_queries_preserve_ordinary_values():
    from wtp_preprocessor.crawl import redact_url
    clean = redact_url('https://x.test/?page=2&tok%65n=PRIVATE_123&x=1&x=2#auth=HASH_SECRET')
    assert 'PRIVATE_123' not in clean and 'HASH_SECRET' not in clean
    assert 'page=2' in clean and 'x=1&x=2' in clean


def test_runtime_bounds_robots_retries(server, tmp_path):
    server.robots_status = 503
    start = time.monotonic()
    summary = asyncio.run(crawl(server.base + '/', tmp_path, max_runtime=1.5, collection_timeout=3))
    assert summary['termination_reason'] == 'max_runtime'
    assert summary['pending_count'] == 1
    assert '/' not in server.requests
    assert time.monotonic() - start < 5


def test_callback_failure_is_not_pass(server, tmp_path):
    async def callback(*args):
        raise RuntimeError('fixture failure')
    summary = asyncio.run(crawl(server.base + '/b', tmp_path, max_pages=1,
                               max_runtime=10, page_delay=0, page_callback=callback))
    graph = json.loads((tmp_path / 'graph.json').read_text('utf-8'))
    node = next(n for n in graph['nodes'] if n['url'].endswith('/b'))
    assert node['callback_status'] == 'error' and node['test_status'] == 'not_run'
    assert summary['test_completed_pages'] == 0
    assert summary['termination_reason'] == 'queue_empty'
