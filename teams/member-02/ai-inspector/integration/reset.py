"""Program-owned initial conditions; reset endpoints are never selected by the model."""
import asyncio
import json
from urllib.parse import urlsplit, urlunsplit

import httpx
from .preprocessor.crawl import normalize_url, same_origin


def origin(url):
    p = urlsplit(normalize_url(url))
    return urlunsplit((p.scheme, p.netloc, '', '', ''))


async def maison_start(page, url):
    """Fresh anonymous browser and the documented Maison server seed, before app code runs."""
    target = origin(url)
    await page.goto('about:blank')
    await page.context.clear_cookies()
    cdp = await page.context.new_cdp_session(page)
    try:
        await cdp.send('Storage.clearDataForOrigin', {'origin': target, 'storageTypes': 'all'})
    finally:
        await cdp.detach()
    async def reset():
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(target + '/_reset')
            response.raise_for_status()
            data = response.json()
            if (not isinstance(data, dict) or data.get('ok') is not True or
                    any(type(data.get(k)) is not int or data[k] < 0 for k in ('users', 'orders'))):
                raise ValueError('unexpected Maison reset response')
            return {'method': 'POST', 'path': '/_reset', 'http_status': response.status_code,
                    **{k: data[k] for k in ('ok', 'users', 'orders')}}
    try:
        receipt = await asyncio.wait_for(reset(), 15)
    except (httpx.HTTPError, ValueError, TimeoutError):
        raise RuntimeError('Maison reset failed; inspection must not start') from None
    return {'url': normalize_url(url), 'method': 'maison_seed', 'receipt': receipt}


async def browser_start(page, url):
    # ponytail: cookies/localStorage/sessionStorage only; use a server reset contract for stateful apps.
    session = await page.evaluate('() => Object.fromEntries(Object.entries(sessionStorage))') if same_origin(page.url, url) else {}
    return {'url': normalize_url(url), 'method': 'browser_only', 'viewport': page.viewport_size,
            'storage': await page.context.storage_state(), 'session': session}


async def restore_start(page, start):
    """Restore pre-load state without executing the app first or leaving a persistent init script."""
    if start.get('viewport'):
        await page.set_viewport_size(start['viewport'])
    if start['method'] == 'maison_seed':
        restored = await maison_start(page, start['url'])
        local, session, receipt = {}, {}, restored['receipt']
    else:
        await page.goto('about:blank')
        await page.context.clear_cookies()
        if start['storage']['cookies']:
            await page.context.add_cookies(start['storage']['cookies'])
        target = origin(start['url'])
        items = next((o.get('localStorage', []) for o in start['storage']['origins'] if o['origin'] == target), [])
        local, session, receipt = {x['name']: x['value'] for x in items}, start['session'], None
    cleanup = await preload_storage(page, start['url'], local, session)
    try:
        await page.goto(start['url'], wait_until='domcontentloaded')
    finally:
        await cleanup()
    return receipt


async def preload_storage(page, url, local=None, session=None):
    """Return cleanup for a temporary script that runs before the application's scripts."""
    state = {'origin': origin(url), 'local': local or {}, 'session': session or {}}
    source = '''(() => { const s = %s; if (location.origin !== s.origin) return;
        localStorage.clear(); for (const [k,v] of Object.entries(s.local)) localStorage.setItem(k,v);
        sessionStorage.clear(); for (const [k,v] of Object.entries(s.session)) sessionStorage.setItem(k,v);
    })();''' % json.dumps(state, ensure_ascii=True)
    cdp = await page.context.new_cdp_session(page)
    try:
        await cdp.send('Page.enable')
        script = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', {'source': source}))['identifier']
    except BaseException:
        await cdp.detach()
        raise
    async def cleanup():
        try:
            await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {'identifier': script})
        finally:
            await cdp.detach()
    return cleanup


def observed_start(snapshot):
    """Conservative visible baseline check; not a proof of all hidden server state."""
    fields = ('element_key', 'tag', 'type', 'role', 'text', 'label', 'href', 'visible',
              'disabled', 'checked', 'value_present', 'value_length', 'aria_invalid')
    return {'url': snapshot.get('final_url'), 'title': snapshot.get('title'), 'text': snapshot.get('text'),
            'elements': [{k: e.get(k) for k in fields} for e in snapshot.get('elements', [])]}
