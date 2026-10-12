"""Local regressions for reset, links and cancellable HTTP; no paid model calls."""
import asyncio
import json
import os
import pathlib
import select
import socket
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
from playwright.async_api import async_playwright
from .preprocessor import crawl
from .preprocessor.collector import PageCollector
from . import models
from .mcp import MCPBridge, LocalMCPClient
from .runtime import Runtime
from .test_integration import response


class Handler(BaseHTTPRequestHandler):
    count = 10
    resets = 0
    bad_reset = False
    stream_started = threading.Event()
    stream_closed = threading.Event()
    def log_message(self, *args): pass

    def send(self, content, mime='text/html', status=200):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.end_headers()
        self.wfile.write(content.encode())

    def do_GET(self):
        if self.path == '/robots.txt':
            return self.send('User-agent: *\nAllow: /\n', 'text/plain')
        if self.path == '/mail':
            content = '<a href="/good">Good</a><a href="mailto:a@example.com">Contact</a><a href="tel:123">Phone</a>'
        elif self.path == '/routing':
            content = '<a id="go" href="/good" onclick="event.preventDefault();location.href=\'/wrong\'">Good</a>'
        elif self.path in ('/load', '/server'):
            content = '''<script>localStorage.visit=String(Number(localStorage.visit||0)+1);
            sessionStorage.visit=String(Number(sessionStorage.visit||0)+1)</script>
            <output id="visits"></output><button id="continue">Continue</button>
            <script>document.querySelector('#visits').textContent='Visits: '+localStorage.visit+'/'+sessionStorage.visit</script>'''
            if self.path == '/server':
                content += f'<output id="count">Count: {Handler.count}</output>'
                content += '''<script>document.querySelector('#continue').onclick=async()=>{
                const r=await fetch('/add',{method:'POST'}); const d=await r.json();
                document.querySelector('#count').textContent='Count: '+d.count;}</script>'''
        else:
            content = 'Good destination' if self.path == '/good' else 'Wrong destination'
        self.send('<!doctype html><html><body>'+content+'</body></html>')

    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length', '0')))
        if self.path == '/_reset':
            Handler.resets += 1
            Handler.count = 0
            return self.send(json.dumps({'ok': not Handler.bad_reset, 'users': 2, 'orders': 2}), 'application/json')
        if self.path == '/add':
            Handler.count += 1
            return self.send(json.dumps({'count': Handler.count}), 'application/json')
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        Handler.stream_started.set()
        try:
            for _ in range(50):
                self.wfile.write(b'data: {"choices":[{"delta":{"content":"x"}}]}\n\n')
                self.wfile.flush()
                if select.select([self.connection], [], [], 0)[0] and self.connection.recv(1, socket.MSG_PEEK) == b'':
                    Handler.stream_closed.set()
                    break
                time.sleep(.05)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            Handler.stream_closed.set()


def make_flow(snap, url):
    return {'flow_id': 'link-probe', 'initial_url': url, 'execution_unknown': False,
            'observation_incomplete': False, 'actions': 0, 'snapshot_ids': [snap['snapshot_id']],
            'replaying': False, 'steps': [], 'attempts': {}, 'corrections': {},
            'pending_correction': None, 'correction_failed': False, 'status': 'running'}


from .test_staged import ReplayModel


async def browser_checks(base, output):
    async with async_playwright() as pw:
        profile = output/'profile'
        context = await pw.chromium.launch_persistent_context(str(profile), headless=True,
            args=['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], service_workers='block')
        port = (profile/'DevToolsActivePort').read_text().splitlines()[0]
        client = await asyncio.to_thread(LocalMCPClient, 'node', [str(ROOT/'.tools/playwright-mcp/node_modules/@playwright/mcp/cli.js'),
            '--cdp-endpoint', f'http://127.0.0.1:{port}', '--output-dir', str(output/'mcp'), '--snapshot-mode', 'none'], timeout=20)
        page, bridge = context.pages[0], MCPBridge(client)
        collector = PageCollector(page, output/'links')
        try:
            runtime = Runtime(None, bridge, output/'links')
            await collector.open_page(base+'/mail')
            initial = await collector.snapshot()
            result = await runtime.act({'snapshot_id': initial['snapshot_id'], 'operation': 'navigate', 'url': base+'/good'},
                'navigate-good', page, collector.api, make_flow(initial, page.url))
            assert result['execution'] == 'executed' and page.url == base+'/good', result
            print('PASS valid MCP navigation with mailto/tel links present')

            await collector.open_page(base+'/routing')
            initial = await collector.snapshot()
            ai = collector.api.get_ai_input(initial['snapshot_id'])
            anchor = next(c for c in ai['controls'] if c['tag'] == 'a')
            assert ai['links'][0]['element_key'] == anchor['key']
            assert anchor['key'] in ai['test_families']['routing']['evidence_keys']
            result = await runtime.act({'snapshot_id': initial['snapshot_id'], 'operation': 'click', 'element_key': anchor['key']},
                'click-link', page, collector.api, make_flow(initial, page.url))
            assert result['driver'] == 'mcp' and result['execution'] == 'executed' and page.url == base+'/wrong', result
            print('PASS AI link key -> real MCP click -> onclick route, not direct href navigation')
        finally:
            await collector.close()
        try:
            await page.evaluate('localStorage.clear(); sessionStorage.clear()')
            runtime = Runtime(ReplayModel(), bridge, output/'browser', browser_state_reset=True)
            summary = await crawl(base+'/load', output/'browser', max_pages=1, max_runtime=45,
                page_callback=runtime.inspect_page, before_page=runtime.prepare_page, shared_page=page)
            assert not summary['callback_errors'], summary
            flow = runtime.flows[0]
            finding = next(iter(flow['findings'].values()))
            replay = finding['reproduction']
            if replay.get('initial_condition') != 'observed_match':
                from .reset import observed_start
                a = observed_start(json.loads((output/'browser/snapshots'/(flow['initial_snapshot_id']+'.json')).read_text(encoding='utf-8')))
                b = observed_start(json.loads((output/'browser/snapshots'/(replay['snapshot_ids'][0]+'.json')).read_text(encoding='utf-8')))
                raise AssertionError({k: [a[k], b[k]] for k in a if a[k] != b[k]})
            assert 'Visits: 1/1' in runtime.model.judge_input['replay'][-1]['after']['supplement']['untrusted_text']
            await page.reload()
            assert await page.locator('#visits').inner_text() == 'Visits: 2/2'
            print('PASS pre-load browser state restored once; initial Visits: 1/1 stays 1/1 on replay')

            Handler.resets, Handler.count = 0, 10
            runtime = Runtime(ReplayModel(), bridge, output/'maison', maison_reset=True, allow_writes=True,
                              site_requirements='local reset regression requirement')
            summary = await crawl(base+'/server', output/'maison', max_pages=1, max_runtime=45,
                page_callback=runtime.inspect_page, before_page=runtime.prepare_page, shared_page=page)
            assert not summary['callback_errors'], summary
            finding = next(iter(runtime.flows[0]['findings'].values()))
            replay = finding['reproduction']
            assert Handler.resets == 2 and Handler.count == 1, (Handler.resets, Handler.count, replay)
            assert replay['server_reset'] is True and replay['initial_condition'] == 'observed_match', replay
            assert runtime.model.judge_input['site_requirements'] == 'local reset regression requirement'
            assert runtime.model.judge_input['original'][0]['execution'] == 'executed'
            print('PASS Maison server seed + browser storage reset before initial inspection and one replay')

            Handler.bad_reset = True
            runtime = Runtime(ReplayModel(), bridge, output/'bad-reset', maison_reset=True)
            summary = await crawl(base+'/server', output/'bad-reset', max_pages=1, max_runtime=30,
                page_callback=runtime.inspect_page, before_page=runtime.prepare_page, shared_page=page,
                allowed_methods=('GET', 'HEAD', 'OPTIONS'))
            assert summary['callback_errors'][0]['error'] == 'preparation_failed' and not runtime.flows, summary
            print('PASS failed reset prevents inspection; control POST is separate from app read-only policy')
        finally:
            Handler.bad_reset = False
            await asyncio.to_thread(client.close)
            await context.close()


def http_checks(base):
    old_url, old_key = models.TIMELY_URL, os.environ.get('TIMELYGPT_API_KEY')
    models.TIMELY_URL = base+'/stream'
    os.environ['TIMELYGPT_API_KEY'] = 'local-probe-only'
    try:
        Handler.stream_closed.clear(); Handler.stream_started.clear()
        async def deadline():
            try:
                await models.HTTPModel(timeout=1.5).complete('', [{'role': 'user', 'content': 'local probe'}], [])
            except models.ModelError as exc:
                assert str(exc) == 'provider request timed out'
            else:
                raise AssertionError('trickling SSE escaped total deadline')
        t0 = time.monotonic()
        asyncio.run(deadline())
        elapsed = time.monotonic()-t0
        assert elapsed < 2.2 and Handler.stream_started.is_set(), elapsed
        assert Handler.stream_closed.wait(1), 'HTTP stream was not closed'
        print(f'PASS model total deadline: {elapsed:.3f}s; active HTTP connection closed')

        Handler.stream_closed.clear(); Handler.stream_started.clear()
        async def cancel():
            task = asyncio.create_task(models.HTTPModel(timeout=5).complete('', [{'role': 'user', 'content': 'local probe'}], []))
            while not Handler.stream_started.is_set():
                await asyncio.sleep(.01)
            task.cancel()
            try: await task
            except asyncio.CancelledError: pass
            else: raise AssertionError('cancellation swallowed')
        t0 = time.monotonic()
        asyncio.run(asyncio.wait_for(cancel(), 2))
        elapsed = time.monotonic()-t0
        assert elapsed < 1 and Handler.stream_closed.wait(1), elapsed
        print(f'PASS overall cancellation: {elapsed:.3f}s; no lingering model thread')
    finally:
        models.TIMELY_URL = old_url
        if old_key is None: os.environ.pop('TIMELYGPT_API_KEY', None)
        else: os.environ['TIMELYGPT_API_KEY'] = old_key


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    try:
        with tempfile.TemporaryDirectory(dir=ROOT/'.tools', prefix='integration-regressions-') as directory:
            asyncio.run(browser_checks(base, pathlib.Path(directory)))
            http_checks(base)
    finally:
        server.shutdown(); server.server_close()


if __name__ == '__main__': main()
