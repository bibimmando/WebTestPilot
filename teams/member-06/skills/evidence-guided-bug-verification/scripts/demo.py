"""Real local-browser checks against intentionally synthetic pages."""
import argparse
import asyncio
import copy
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from reproduce import ROOT, run


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        required = '' if self.path == '/bug' else 'required'
        content = f'''<!doctype html><html lang="en"><title>Validation fixture</title>
        <label for="email">Email (required)</label><form>
        <input id="email" type="email" {required}>
        <button>Submit</button></form><p id="success" hidden>Saved</p>
        <script>document.querySelector('form').addEventListener('submit', e => {{
          e.preventDefault(); document.querySelector('#success').hidden=false;
        }});</script></html>'''.encode()
        self.send_response(200)
        self.send_header('Content-Type','text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, *_):
        pass


async def demo(out):
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    candidate = json.loads((ROOT/'examples/bug_candidate.json').read_text(encoding='utf-8'))
    candidate['authorization']['origins'] = [base]
    reports = []
    try:
        for case in ('bug','normal','automation-error'):
            c = copy.deepcopy(candidate)
            c['id'] = case
            c['url'] = base + ('/bug' if case == 'bug' else '/normal')
            if case == 'normal':
                c['scenario'] = [{'action':'click','locator':{'role':'button','name':'Submit'}},
                                 {'action':'observe'}]
            elif case == 'automation-error':
                c['scenario'] = [{'action':'click','locator':{'css':'#missing'}}]
            record = await run(c, out/case)
            if record['execution_status'] != ('ERROR' if case == 'automation-error' else 'COMPLETED'):
                raise AssertionError(f'{case}: unexpected execution status {record}')
            initial = json.loads((out/case/'initial.json').read_text())
            email = initial['elements'][0]['dom']
            assert email['valueLength'] == 0
            assert email['validity']['valueMissing'] == (case != 'bug')
            assert 'judgment' not in record
            if case != 'automation-error':
                last = json.loads((out/case/'step-001.json').read_text())
                assert last['elements'][1]['visible'] == (case == 'bug')
            reports.append({'case':case,'execution_status':record['execution_status'],
                            'record':f'{case}/execution.json'})
        # Scope violations must fail before browser creation/output side effects.
        c = copy.deepcopy(candidate)
        c['url'] = 'https://outside.invalid/'
        try:
            await run(c, out/'must-not-exist')
            raise AssertionError('Scope violation accepted')
        except ValueError:
            assert not (out/'must-not-exist').exists()
    finally:
        server.shutdown()
        server.server_close()
    (out/'checks.json').write_text(json.dumps({'mode':'actual','cases':reports,
          'scope_rejection':'passed','fixture':'synthetic local HTML, real Chromium execution'},indent=2))
    print(json.dumps(reports))


if __name__ == '__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('--out',required=True)
    args=ap.parse_args()
    asyncio.run(demo(Path(args.out)))
