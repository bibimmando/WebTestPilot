"""Small, selected observations. Screenshots are explicitly opt-in."""
import hashlib
import json
from datetime import datetime, timezone
from playwright_helpers import locator, safe_url


def now():
    return datetime.now(timezone.utc).isoformat()


class EvidenceCollector:
    def __init__(self, context):
        self.events = []
        context.on('request', lambda r: self.add('request', url=safe_url(r.url), method=r.method))
        context.on('response', lambda r: self.add('response', url=safe_url(r.url), status=r.status))
        context.on('requestfailed', lambda r: self.add('requestfailed', url=safe_url(r.url)))
        context.on('page', self.attach)

    def add(self, kind, **data):
        self.events.append({'time': now(), 'kind': kind, **data})

    def attach(self, page):
        page.on('console', lambda m: self.add('console', level=m.type, text='[OMITTED]'))
        page.on('pageerror', lambda e: self.add('pageerror', error_type=type(e).__name__))
        page.on('framenavigated', lambda f: self.add('navigation', url=safe_url(f.url)))


async def snapshot(page, specs, out, tag, options):
    data = {'time': now(), 'url': safe_url(page.url), 'elements': []}
    for spec in specs:
        target = locator(page, spec)
        count = await target.count()
        item = {'locator': spec, 'count': count}
        if count == 1:
            visible = await target.is_visible()
            item.update(visible=visible, enabled=await target.is_enabled(),
                        box=await target.bounding_box() if visible else None)
            item['dom'] = await target.evaluate('''el => {
              const s = getComputedStyle(el), v = el.validity;
              return {tag:el.tagName, type:el.getAttribute('type'),
                required:el.hasAttribute('required'), disabled:el.hasAttribute('disabled'),
                hidden:el.hidden ?? null, willValidate:el.willValidate ?? null,
                ariaInvalid:el.getAttribute('aria-invalid'),
                ariaRequired:el.getAttribute('aria-required'),
                ariaDescribedby:el.getAttribute('aria-describedby'),
                valueLength: typeof el.value === 'string' ? el.value.length : null,
                validity:v ? Object.fromEntries(['valid','valueMissing','typeMismatch',
                  'patternMismatch','tooLong','tooShort','rangeUnderflow','rangeOverflow',
                  'stepMismatch','badInput','customError'].map(k=>[k,v[k]])) : null,
                style:Object.fromEntries(['display','visibility','opacity','pointerEvents',
                  'overflow','position','zIndex','contain','color','backgroundColor','fontSize']
                  .map(k=>[k,s[k]]))};
            }''')
        data['elements'].append(item)
    path = out / f'{tag}.json'
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    artifacts = [artifact(path, out, 'dom-state')]
    if options.get('screenshot', False):
        path = out / f'{tag}.png'
        masks = [page.locator(s) for s in options.get('mask_selectors', [])]
        masks.append(page.locator('input,textarea,[contenteditable=true]'))
        await page.screenshot(path=str(path), full_page=True, mask=masks)
        artifacts.append(artifact(path, out, 'screenshot'))
    return artifacts


def artifact(path, out, kind):
    return {'id': path.name, 'kind': kind, 'path': str(path.relative_to(out)),
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'time': now()}
