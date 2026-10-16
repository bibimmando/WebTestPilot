"""Recover only a unique current semantic target; no guessed selector or action retry."""
import copy


async def refresh_target(page, detail):
    if not detail or detail.get('locator_status') == 'verified':
        return detail
    role = detail.get('role') or {'a': 'link', 'button': 'button'}.get(detail.get('tag'))
    name = detail.get('label') or detail.get('text')
    if role not in ('link', 'button', 'textbox', 'combobox') or not isinstance(name, str) or not name.strip():
        return detail
    try:
        locator = page.get_by_role(role, name=name.strip(), exact=True)
        if await locator.count() != 1 or not await locator.is_visible():
            return detail
        if role == 'link' and detail.get('href'):
            from urllib.parse import urljoin
            href = await locator.get_attribute('href', timeout=1000)
            if not href or urljoin(page.url, href) != urljoin(page.url, detail['href']):
                return detail
        result = copy.deepcopy(detail)
        result.update(locator={'strategy': 'role', 'role': role, 'name': name.strip(), 'exact': True},
                      locator_status='verified', locator_recovery='unique_observed_role_name')
        return result
    except Exception:
        return detail
