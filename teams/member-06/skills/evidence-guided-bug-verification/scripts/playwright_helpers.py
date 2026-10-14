"""Declarative actions only; no application verdicts."""
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode


def origin(url):
    p = urlsplit(url)
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
        raise ValueError('Expected HTTP(S) URL without credentials')
    default = 443 if p.scheme == 'https' else 80
    host = f'[{p.hostname}]' if ':' in p.hostname else p.hostname
    return f'{p.scheme}://{host}' + (f':{p.port}' if p.port and p.port != default else '')


def safe_url(url):
    p = urlsplit(url)
    host = p.netloc.rsplit('@', 1)[-1]
    return urlunsplit((p.scheme, host, p.path,
                      urlencode([(k, '[REDACTED]') for k, _ in parse_qsl(p.query, keep_blank_values=True)]),
                      '[REDACTED]' if p.fragment else ''))


def locator(page, spec):
    if 'css' in spec:
        return page.locator(spec['css'])
    return page.get_by_role(spec['role'], name=spec['name'], exact=True)


async def perform(page, step, allowed):
    action = step['action']
    if action == 'goto':
        if origin(step['url']) not in allowed:
            raise ValueError('Navigation outside authorized origins')
        await page.goto(step['url'], wait_until='domcontentloaded')
    elif action in ('back', 'forward'):
        await getattr(page, 'go_' + action)(wait_until='domcontentloaded')
    elif action == 'wait_for_url':
        await page.wait_for_url(step['url'], wait_until='domcontentloaded')
    elif action == 'observe':
        return
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
