"""Site-independent plan boundaries and frozen semantic target checks."""
import copy
from urllib.parse import urljoin

from .plan_contract import PLANNING_TOOL, validate_plan


IDENTITY_SCHEMA = {'type': 'object', 'properties': {
    'role': {'type': 'string', 'minLength': 1},
    'name': {'type': 'string', 'minLength': 1},
    'href': {'type': 'string', 'minLength': 1}},
    'required': ['role'], 'anyOf': [{'required': ['name']}, {'required': ['href']}],
    'additionalProperties': False}


def planning_tool(initial):
    """Constrain navigation at generation time; later targets need checkable identity."""
    from .plan_contract import observed_urls
    definition = copy.deepcopy(PLANNING_TOOL)
    branches = definition['input_schema']['properties']['scenarios']['items']['properties']['steps']['items']['oneOf']
    urls = sorted(observed_urls(initial))
    for branch in branches:
        if branch['properties']['operation']['const'] == 'navigate':
            branch['properties']['url']['enum'] = urls or ['__no_observed_navigation__']
        else:
            branch['properties']['target_identity'] = copy.deepcopy(IDENTITY_SCHEMA)
            branch['anyOf'] = [{'required': ['element_key']},
                               {'required': ['target_description', 'target_identity']}]
    return definition


def isolate_plan(args, proposals, initial, max_actions):
    """Keep a valid prefix and initial UI; never guess dependencies after a rejected case.

    Each scenario remains atomic. Whole-response accounting/duplicate/budget errors still fail.
    Internal target constraints stay in a sidecar so test_plan/2 stays unchanged.
    """
    raw = copy.deepcopy(args)
    identities = {}
    for sc in raw['scenarios']:
        identities[sc['scenario_id']] = [step.pop('target_identity', None) for step in sc['steps']]
    ids = [s['scenario_id'] for s in raw['scenarios']]
    if len(ids) != len(set(ids)):
        raise ValueError('duplicate scenario_id')
    count = len(proposals['proposed_checks'])
    accounted = {s['proposal_index'] for s in raw['scenarios']}
    unplanned = [u['proposal_index'] for u in raw['unplanned']]
    if (any(i < 0 or i >= count for i in accounted | set(unplanned)) or
            len(unplanned) != len(set(unplanned)) or accounted & set(unplanned) or
            accounted | set(unplanned) != set(range(count))):
        raise ValueError('proposals must be accounted for exactly once (or by multiple scenarios)')
    kept, rejected, blocked = [], [], False
    used = 0
    for sc in raw['scenarios']:
        reason = None
        initial_ui = sc['family'] == 'ui' and not sc['steps']
        try:
            standalone = {'scenarios': [sc], 'unplanned': [
                {'proposal_index': i, 'reason': 'other scenario'} for i in range(count)
                if i != sc['proposal_index']]}
            validate_plan(standalone, proposals, initial, max_actions)
            if blocked and not initial_ui:
                reason = 'dependency_unknown_after_rejected_scenario'
            elif used + len(sc['steps']) > max_actions:
                reason = 'remaining_plan_action_budget_exceeded'
        except ValueError as exc:
            reason = str(exc)
        if reason:
            blocked = True
            rejected.append({'scenario_id': sc['scenario_id'], 'proposal_index': sc['proposal_index'], 'reason': reason})
        else:
            kept.append(sc)
            used += len(sc['steps'])
    # Initial-state UI is moved before any mutation, including earlier valid scenarios.
    kept = [s for s in kept if s['family'] == 'ui' and not s['steps']] + [
        s for s in kept if s['family'] != 'ui' or s['steps']]
    retained = {s['proposal_index'] for s in kept}
    raw['scenarios'] = kept
    for idx in sorted({s['proposal_index'] for s in rejected} - retained):
        raw['unplanned'].append({'proposal_index': idx, 'reason': '; '.join(
            r['reason'] for r in rejected if r['proposal_index'] == idx)})
    return validate_plan(raw, proposals, initial, max_actions), identities, rejected


def controls(initial):
    observation = initial.get('observation') or {}
    result = {c.get('key', c.get('element_key')): c for c in observation.get('controls') or []}
    supplement = initial.get('supplement') or {}
    for c in [*((supplement.get('action_context') or {}).get('controls') or []),
              *(supplement.get('target_controls') or [])]:
        result[c['key']] = {**result.get(c['key'], {}), **c}
    return result


def identity(control, page_url):
    tag = control.get('tag')
    role = control.get('role') or {'a': 'link', 'button': 'button', 'input': 'textbox'}.get(tag)
    name = (control.get('locator') or {}).get('name') or control.get('name') or control.get('label') or control.get('text')
    href = control.get('href')
    result = {k: v for k, v in {'role': role, 'name': name.strip() if isinstance(name, str) else None,
                               'href': urljoin(page_url, href) if href else None}.items() if v}
    if not result.get('name') and not result.get('href') and control.get('observed_ref'):
        result['observed_ref'] = control['observed_ref']
    return result


def bind_targets(plan, initial, supplied):
    observed = controls(initial)
    page_url = initial['observation']['page']['url']
    return {sc['scenario_id']: [
        identity(observed[step['element_key']], page_url) if step.get('element_key') in observed
        else (supplied.get(sc['scenario_id']) or [None] * len(sc['steps']))[i]
        for i, step in enumerate(sc['steps'])] for sc in plan['scenarios']}


def check_target(expected, selected_key, current):
    """Require a unique current match before dispatch; never validate the app's outcome here."""
    if not expected or not expected.get('role') or not (expected.get('name') or expected.get('href') or expected.get('observed_ref')):
        raise ValueError('planned target has no checkable identity; replan with role/name or href')
    page_url = (current.get('page') or {}).get('url', '')
    def matches(control):
        actual = identity(control, page_url)
        fields = ('role', 'href') if expected.get('href') else ('role', 'name') if expected.get('name') else ('role', 'observed_ref')
        return all(actual.get(k) == (urljoin(page_url, expected[k]) if k == 'href' else expected[k]) for k in fields)
    candidates = [c.get('key', c.get('element_key')) for c in current['controls'] if matches(c)]
    equivalent_links = expected.get('role') == 'link' and expected.get('href')
    if selected_key not in candidates or (len(candidates) != 1 and not equivalent_links):
        raise ValueError('planned target mismatch or ambiguous identity; selected key does not uniquely match frozen target')
    return {'status': 'matched', 'identity': copy.deepcopy(expected), 'selected_key': selected_key,
            'equivalent_target_count': len(candidates)}
