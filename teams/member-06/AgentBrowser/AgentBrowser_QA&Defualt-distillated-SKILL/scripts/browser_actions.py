"""Small Playwright adapter; observations and actions never assign verdicts."""
from urllib.parse import urlsplit, urlunsplit

def origin(url):
    p = urlsplit(url)
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
        raise ValueError('Expected HTTP(S) URL without credentials')
    host = '[' + p.hostname + ']' if ':' in p.hostname else p.hostname
    port = p.port
    return p.scheme + '://' + host + (f':{port}' if port and port != (443 if p.scheme == 'https' else 80) else '')

def safe_url(url):
    p = urlsplit(url)
    return urlunsplit((p.scheme, p.netloc.rsplit('@', 1)[-1], p.path, 'REDACTED' if p.query else '', 'REDACTED' if p.fragment else ''))

def locator(page, spec):
    return page.locator(spec['css']) if 'css' in spec else page.get_by_role(spec['role'], name=spec['name'], exact=True)

async def perform(page, step, allowed):
    action = step['action']
    if action == 'goto':
        if origin(step['url']) not in allowed:
            raise ValueError('URL outside authorized scope')
        await page.goto(step['url'], wait_until='domcontentloaded')
    elif action in ('back', 'forward'):
        await getattr(page, 'go_' + action)(wait_until='domcontentloaded')
    elif action == 'wait_for_url':
        await page.wait_for_url(step['url'], wait_until='domcontentloaded')
    elif action == 'observe':
        pass
    else:
        target = locator(page, step['locator'])
        if action == 'wait_for_selector':
            await target.wait_for(state=step.get('state', 'visible'))
        elif action in ('click', 'check', 'uncheck'):
            await getattr(target, action)()
        elif action in ('fill', 'press', 'select_option'):
            await getattr(target, action)(step['value'])
        else:
            raise ValueError('Unsupported action')
