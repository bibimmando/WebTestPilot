"""Run-local coverage and generic planning guidance, without benchmark answers."""
import copy
import hashlib
import json
from urllib.parse import urlsplit


PLANNING_GUIDANCE = """
Prefer page-specific end-to-end checks over repeating the same shared form on every URL.
Review covered_common_checks; completed shared-form cases need not be proposed again.
Where observed controls and permissions permit, vary checks across quantity increase/decrease,
save then inspect saved-list contents/count, add then inspect bag item/quantity, filter apply THEN
clear, and clicked-card label versus destination title. Never invent controls or bypass permissions.
An acknowledgement/toast, a command's success, or a numeric lower bound alone cannot prove the
business outcome. State the qualitative state transition and the evidence needed to establish it.
Freeze expected as explicit numbered criteria when multiple conditions must hold. Ground exact
counts/values in supplied requirements or observed baselines; never invent a benchmark answer.
Include visible preconditions and steps needed to reach them. Missing login, password support,
cart contents, valid reset token or write permission means unplanned with a precise reason.
Place zero-action UI checks of the initial page BEFORE navigation/scroll-changing actions.
Only plan observed same-origin navigation. For later revealed targets describe role/name and state.
Separate state transitions when a later action requires an earlier application's success.
For example, an initially disabled reverse control must not make the forward transition's result
unjudgeable: use separate scenarios and state their observed preconditions. Never click a disabled
control simply to finish a multi-step plan. A stable observed node reference can identify an
unnamed existing control, but it does not establish what the control is supposed to do.
"""


def common_check_key(scenario, initial):
    """Same observed form/constraints and action trace; this is execution dedup, not a pass."""
    if scenario.get('family') != 'input_validation':
        return None
    observation = initial.get('observation') or {}
    controls = observation.get('controls') or []
    by_key = {c.get('key', c.get('element_key')): c for c in controls}
    targets = [by_key.get(s.get('element_key')) for s in scenario['steps']]
    if not targets or any(t is None or not t.get('form_key') for t in targets):
        return None
    forms = {t['form_key'] for t in targets}
    if len(forms) != 1:
        return None
    fields = [c for c in controls if c.get('form_key') in forms]
    signature = [(c.get('type'), c.get('label'), c.get('text'), c.get('required'),
                  c.get('constraints'), c.get('value')) for c in fields]
    # Unlabelled forms are not safely comparable across pages.
    if not any(c.get('label') or c.get('text') for c in fields):
        return None
    steps = [(s['operation'], by_key[s['element_key']].get('type'),
              by_key[s['element_key']].get('label'), s.get('value')) for s in scenario['steps']]
    page = observation.get('page') or {}
    origin = urlsplit(page.get('url', ''))
    data = [origin.scheme, origin.netloc, sorted(signature, key=repr), steps]
    return hashlib.sha256(json.dumps(data, ensure_ascii=False).encode()).hexdigest()


def prepare_plan(plan, initial, covered):
    """Keep recorded proposals accounted for; defer only exact previously completed checks."""
    plan = copy.deepcopy(plan)
    kept, skipped = [], []
    for scenario in plan['scenarios']:
        key = common_check_key(scenario, initial)
        if key and key in covered:
            skipped.append({'scenario_id': scenario['scenario_id'], 'proposal_index': scenario['proposal_index'],
                            'reason': 'shared_form_already_executed', 'coverage_key': key})
        else:
            kept.append(scenario)
    retained = {s['proposal_index'] for s in kept}
    for index in sorted({s['proposal_index'] for s in skipped} - retained):
        plan['unplanned'].append({'proposal_index': index, 'reason': 'same shared-form action trace already judged; deferred, not a pass for this expectation'})
    # Stable partition: only initial-state zero-action UI; other scenario order stays fixed.
    def initial_ui(s):
        label = (s['scenario_id'] + ' ' + s['title']).lower()
        return s['family'] == 'ui' and not s['steps'] and any(
            word in label for word in ('initial', 'first_viewport', '최초', '초기'))
    plan['scenarios'] = [s for s in kept if initial_ui(s)] + [s for s in kept if not initial_ui(s)]
    return plan, skipped


def coverage_report(plan, results, findings):
    """Separate plan/execution/evidence/judgment/replay, without claiming benchmark recall."""
    records = {r['scenario_id']: r for r in results}
    rows = []
    for scenario in (plan or {}).get('scenarios', []):
        rec = records.get(scenario['scenario_id'], {})
        matches = [f for f in findings if f.get('scenario_id') == scenario['scenario_id']]
        rows.append({'scenario_id': scenario['scenario_id'], 'family': scenario['family'],
                     'planned': True, 'execution_status': rec.get('execution_status', 'not_run'),
                     'attempted_steps': rec.get('attempted_step_count', 0),
                     'evidence_available': bool(rec.get('snapshot_ids')) and rec.get('execution_status') == 'completed'
                         and not rec.get('policy_blocked') and (scenario['family'] != 'ui' or bool(rec.get('image'))),
                     'judgments': [{'verdict': f['verdict'], 'status': f['status'],
                                    'reproduction': f.get('reproduction', {}).get('status')} for f in matches],
                     'failure_reason': rec.get('failure_reason')})
    return {'schema_version': 'inspection_coverage/1', 'scenarios': rows,
            'unplanned': (plan or {}).get('unplanned', []), 'ground_truth_used': False}
