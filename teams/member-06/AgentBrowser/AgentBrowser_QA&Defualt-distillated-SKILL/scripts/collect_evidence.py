import json
from datetime import datetime, timezone
from browser_actions import locator, safe_url

def now():
    return datetime.now(timezone.utc).isoformat()

async def collect(page, specs, out, label, options=None):
    options = options or {}
    data = {'url': safe_url(page.url), 'observed_at': now(), 'elements': []}
    for spec in specs:
        row = {'locator': spec}
        try:
            target = locator(page, spec)
            row.update(count=await target.count(), visible=await target.is_visible())
            if row['count'] == 1:
                row['dom'] = await target.evaluate('''e => ({tag:e.tagName, disabled:!!e.disabled,
                  required:!!e.required, hidden:e.hidden, valueLength:typeof e.value==='string'?e.value.length:null,
                  validity:e.validity?{valid:e.validity.valid,valueMissing:e.validity.valueMissing,
                    typeMismatch:e.validity.typeMismatch,rangeUnderflow:e.validity.rangeUnderflow,
                    rangeOverflow:e.validity.rangeOverflow}:null,
                  display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility,
                  opacity:getComputedStyle(e).opacity})''')
                row['bounds'] = await target.bounding_box()
        except Exception as exc:
            row['error_type'] = type(exc).__name__
        data['elements'].append(row)
    path = out / (label + '.json')
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    artifacts = [{'id':label, 'path':path.name, 'type':'observation', 'candidate_ids':[]}]
    if options.get('screenshots'):
        path = out / (label + '.png')
        try:
            await page.screenshot(path=str(path), mask=[page.locator(s) for s in options.get('mask_selectors', [])])
            artifacts.append({'id':label+'-screen', 'path':path.name, 'type':'screenshot', 'candidate_ids':[]})
        except Exception as exc:
            data['screenshot_error'] = type(exc).__name__
            (out / (label + '.json')).write_text(json.dumps(data, indent=2), encoding='utf-8')
    return artifacts
