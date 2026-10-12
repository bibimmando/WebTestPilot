"""Real localhost browser checks for passive, bounded form evidence; no paid models."""
import asyncio
import json
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.async_api import async_playwright

from .executor import compact_observation
from .preprocessor.collector import PageCollector, MAX_FORM_EVENTS
from .runtime import Runtime
from .staged import _compact_judge_input

SECRET = 'PRIVATE_FORM_VALUE_93427'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        html = '''<!doctype html><html><head><title>Form evidence</title></head><body>
          <form id="native" action="/accepted">
            <label for="email">Email</label><input id="email" type="email" required name="email">
            <label for="choice">Choice</label><select id="choice"><option>A</option><option>B</option></select>
            <button id="send" type="submit">Send</button><button id="reset" type="reset">Reset</button>
          </form>
          <form id="custom" novalidate><label for="customEmail">Custom email</label>
            <input id="customEmail" type="email" required><button id="customSend">Custom send</button>
            <output id="error"></output></form>
          <input id="password" type="password" value="PRIVATE_FORM_VALUE_93427">
          <input id="hidden" type="hidden" value="PRIVATE_FORM_VALUE_93427">
          <a href="/second">Second</a><script>
            window.validationCalls = 0;
            for (const proto of [HTMLInputElement.prototype, HTMLFormElement.prototype]) {
              for (const name of ['checkValidity', 'reportValidity']) {
                const original = proto[name]; proto[name] = function(...args) {
                  window.validationCalls++; return original.apply(this, args);
                };
              }
            }
            document.querySelector('#custom').addEventListener('submit', event => {
              event.preventDefault(); document.querySelector('#error').textContent = 'Custom validation error';
            });
          </script></body></html>'''
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(html.encode())


def size(value):
    return len(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode())


def element(snapshot, name):
    return next(e for e in snapshot['elements'] if e.get('id_attr') == name)


async def check(root, origin):
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page()
        collector = PageCollector(page, root, timeout=10)
        api = collector.api
        runtime = Runtime(None, None, root)
        try:
            assert await collector.open_page(origin)
            initial = await collector.snapshot(light=True)
            assert initial['form_event_collection']['listener_installed']
            email_key = element(initial, 'email')['element_key']
            assert element(initial, 'email')['validation']['validity']['value_missing']
            for bad in ('', 'unknown'):
                try:
                    api.get_action_context(bad)
                except ValueError:
                    pass
                else:
                    raise AssertionError('Unknown action-context snapshot must be rejected')

            async def act(aid, name, kind, perform):
                key = element(api.last_snapshot, name)['element_key']
                async with api.action(aid, kind, key, light=True) as record:
                    await perform()
                after = api.snapshots[record['after_snapshot_id']]
                events = [e for e in after['events'] if e.get('kind') == 'form_event']
                assert all(e['action_id'] == aid for e in events), (aid, events)
                assert all(e['association'] == 'temporal' for e in events)
                assert size(after['action_context']) <= 8192
                return after, events, record

            invalid, events, _ = await act('fill-invalid', 'email', 'fill', lambda: page.locator('#email').fill(SECRET))
            assert any(e['type'] == 'input' and e['is_trusted'] for e in events)
            assert element(invalid, 'email')['validation']['validity']['type_mismatch']
            blocked, events, record = await act('submit-invalid', 'send', 'click', lambda: page.locator('#send').click())
            assert [e['type'] for e in events].count('invalid') == 1
            assert not any(e['type'] == 'submit' for e in events)
            assert events[0]['target_key'] == email_key and events[0]['form_key']
            assert element(blocked, 'email')['validation']['message']
            assert not any(r.get('kind') == 'main_document' for r in blocked['resources'])

            # Global AI trimming cannot remove the acted-on form's separate evidence.
            collector.summary_budget = {'max_bytes': 2048, 'max_controls': 0, 'max_links': 0, 'text_chars': 0}
            empty, _, _ = await act('fill-empty', 'email', 'fill', lambda: page.locator('#email').fill(''))
            assert api.get_ai_input(empty['snapshot_id'])['controls'] == []
            assert size(api.get_ai_input(empty['snapshot_id'])) <= 2048
            assert any(c['key'] == email_key and c['validation']['validity']['value_missing'] for c in api.get_action_context()['controls'])
            assert collector.last_links and len(empty['links']) == 1
            current = compact_observation(runtime, api)
            assert any(c['key'] == email_key and c['validation']['validity']['value_missing'] for c in current['controls'])
            collector.summary_budget = None
            _, events, _ = await act('submit-empty', 'send', 'click', lambda: page.locator('#send').click())
            assert [e['type'] for e in events].count('invalid') == 1
            _, events, _ = await act('select-choice', 'choice', 'select', lambda: page.locator('#choice').select_option(label='B'))
            assert {e['type'] for e in events} == {'input', 'change'}
            _, events, _ = await act('reset-form', 'reset', 'click', lambda: page.locator('#reset').click())
            assert [e['type'] for e in events].count('reset') == 1

            await act('fill-custom', 'customEmail', 'fill', lambda: page.locator('#customEmail').fill(SECRET))
            custom, events, _ = await act('submit-custom', 'customSend', 'click', lambda: page.locator('#customSend').click())
            assert [e['type'] for e in events].count('submit') == 1
            assert not any(e['type'] == 'invalid' for e in events)
            assert 'Custom validation error' in custom['text']
            assert next(f for f in custom['forms'] if f.get('id') == 'custom')['novalidate']

            await act('fill-valid', 'email', 'fill', lambda: page.locator('#email').fill('valid@example.test'))
            valid, events, _ = await act('submit-valid', 'send', 'click', lambda: page.locator('#send').click())
            assert [e['type'] for e in events].count('submit') == 1
            assert '/accepted' in valid['final_url']
            assert any(r.get('kind') == 'main_document' for r in valid['resources'])
            assert all(e['document_id'] != valid['form_event_collection']['document_id'] for e in events)
            assert all(e['target_reference_status'] == 'resolved' for e in events)
            _, events, _ = await act('fill-after-navigation', 'email', 'fill', lambda: page.locator('#email').fill('bad'))
            assert [e['type'] for e in events].count('input') == 1
            await page.reload(wait_until='domcontentloaded')
            await collector.snapshot(light=True)
            _, events, _ = await act('fill-after-reload', 'email', 'fill', lambda: page.locator('#email').fill('bad'))
            assert [e['type'] for e in events].count('input') == 1
            assert await page.evaluate('window.validationCalls') == 0

            # Check that independent judgment receives the same preserved facts.
            rec = {'scenario_id': 'native-invalid', 'snapshot_ids': [blocked['snapshot_id']], 'steps': [],
                   'start_snapshot_id': blocked['snapshot_id'], 'end_snapshot_id': blocked['snapshot_id']}
            judge = _compact_judge_input(runtime, api, {'flow_id': 'fixture', 'initial_url': origin}, [rec], [])
            ctx = judge['observations'][blocked['snapshot_id']]['supplement']['action_context']
            assert any(e['type'] == 'invalid' for e in ctx['form_events'])
            assert any(c.get('validation', {}).get('validity', {}).get('type_mismatch') for c in ctx['controls'])
            assert SECRET not in json.dumps(judge)
            assert SECRET not in json.dumps(api.snapshots)
            assert collector.api.active_action_id is None and collector.api.active_target_key is None
            for filename in ('snapshots', 'ai_inputs', 'actions'):
                assert all(SECRET not in p.read_text(encoding='utf-8') for p in (Path(root) / filename).glob('*.json'))

            # Bound event floods and report losses explicitly.
            await page.evaluate('() => { for (let i = 0; i < 250; i++) document.querySelector("#email").dispatchEvent(new Event("input", {bubbles:true})); }')
            overflow = await collector.snapshot(light=True)
            assert len([e for e in overflow['events'] if e.get('kind') == 'form_event']) <= MAX_FORM_EVENTS
            assert overflow['form_event_collection']['dropped_events'] >= 50
            assert overflow['form_event_collection']['status'] == 'partial'
            assert overflow['action_context']['omitted']['form_events']
            assert size(overflow['action_context']) <= 8192
            await collector.close()
            replacement = PageCollector(page, Path(root) / 'reused', timeout=10)
            try:
                await replacement.snapshot(light=True)
                key = element(replacement.api.last_snapshot, 'email')['element_key']
                async with replacement.api.action('reused-page', 'fill', key, light=True):
                    await page.locator('#email').fill('new')
                events = [e for e in replacement.api.last_snapshot['events'] if e.get('kind') == 'form_event']
                assert [e['type'] for e in events].count('input') == 1
            finally:
                await replacement.close()
        finally:
            await collector.close()
            await browser.close()


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    root = Path(__file__).resolve().parent.parent / '.tools' / 'form-evidence-20261012' / 'checks'
    root.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(dir=root) as directory:
            asyncio.run(check(directory, 'http://127.0.0.1:%d/' % server.server_port))
        print('Form evidence browser checks passed (native/custom/navigation/budgets/privacy/AI inputs).')
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
