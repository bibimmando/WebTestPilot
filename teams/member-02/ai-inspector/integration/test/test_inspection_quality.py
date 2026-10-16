import base64
from copy import deepcopy
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from integration.inspection_quality import common_check_key, prepare_plan, coverage_report
from integration.reproduction import reproduce
from integration.target_refresh import refresh_target


class PlanningQualityTest(unittest.TestCase):
    def setUp(self):
        self.initial = {'observation': {'page': {'url': 'http://fixture.test/a'}, 'controls': [
            {'key': 'submit', 'form_key': 'form-1', 'type': 'submit', 'label': 'Newsletter subscribe'},
            {'key': 'email', 'form_key': 'form-1', 'type': 'email', 'label': 'Email', 'required': True}]}}
        self.scenario = {'scenario_id': 'empty', 'proposal_index': 0, 'title': 'Shared empty form',
            'family': 'input_validation', 'expected': 'Empty email is rejected', 'expected_source': 'required UI',
            'steps': [{'operation': 'click', 'element_key': 'submit'}]}

    def test_shared_form_skip_requires_exact_case_and_retains_proposal_accounting(self):
        key = common_check_key(self.scenario, self.initial)
        plan = {'scenarios': [self.scenario], 'unplanned': []}
        filtered, skipped = prepare_plan(plan, self.initial, {key})
        self.assertEqual(filtered['scenarios'], [])
        self.assertEqual(filtered['unplanned'][0]['proposal_index'], 0)
        self.assertEqual(skipped[0]['reason'], 'shared_form_already_executed')
        other = deepcopy(self.scenario)
        other['expected'] = 'A different expected behavior'
        # Same execution is deferred explicitly; a rephrased expectation is never declared passed.
        self.assertEqual(common_check_key(other, self.initial), key)
        other['family'] = 'functional'
        self.assertIsNone(common_check_key(other, self.initial))

    def test_initial_ui_precedes_actions_without_reordering_later_state_ui(self):
        initial_ui = {**self.scenario, 'scenario_id': 'ui_initial', 'family': 'ui', 'steps': []}
        later_ui = {**initial_ui, 'scenario_id': 'opened_menu', 'title': 'Open menu appearance'}
        plan, _ = prepare_plan({'scenarios': [self.scenario, initial_ui, later_ui], 'unplanned': []}, self.initial, set())
        self.assertEqual([s['scenario_id'] for s in plan['scenarios']], ['ui_initial', 'empty', 'opened_menu'])

    def test_coverage_does_not_convert_unknown_execution_into_app_bug(self):
        report = coverage_report({'scenarios': [self.scenario]}, [
            {'scenario_id': 'empty', 'execution_status': 'incomplete', 'failure_reason': 'unknown',
             'snapshot_ids': ['s'], 'policy_blocked': False}], [])
        row = report['scenarios'][0]
        self.assertFalse(row['evidence_available'])
        self.assertEqual(row['judgments'], [])


class TargetRefreshTest(unittest.IsolatedAsyncioTestCase):
    async def test_unique_current_role_name_is_required_and_wrong_link_is_rejected(self):
        locator = SimpleNamespace(count=AsyncMock(return_value=1), is_visible=AsyncMock(return_value=True),
                                  get_attribute=AsyncMock(return_value='/cart'))
        page = SimpleNamespace(url='http://fixture.test/product', get_by_role=lambda *a, **kw: locator)
        detail = {'tag': 'a', 'text': 'Bag', 'href': '/cart', 'locator_status': 'timeout'}
        found = await refresh_target(page, detail)
        self.assertEqual(found['locator_status'], 'verified')
        self.assertEqual(detail['locator_status'], 'timeout')
        locator.count.return_value = 2
        self.assertEqual(await refresh_target(page, detail), detail)
        locator.count.return_value = 1
        locator.get_attribute.return_value = '/wrong'
        self.assertEqual(await refresh_target(page, detail), detail)


class UIReproductionTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM9sAAAAASUVORK5CYII=')
        (self.root / 'original.png').write_bytes(png)
        (self.root / 'replay.png').write_bytes(png)
        self.original = {'path': 'original.png', 'snapshot_id': 'original', 'viewport': {'width': 1280, 'height': 800},
                         'scroll': {'x': 0, 'y': 0}}
        self.replay = {**self.original, 'path': 'replay.png', 'snapshot_id': 'replay'}
        self.snapshot = {'snapshot_id': 'initial', 'final_url': 'http://fixture.test/', 'title': 'Fixture',
                         'text': 'Title', 'elements': []}
        self.finding = {'family': 'ui', 'verdict': 'candidate', 'status': 'candidate',
                        'expected': 'Title visible', 'expected_source': 'Fixture requirements',
                        'actual': 'Title covered', 'snapshot_ids': ['original'], 'action_ids': [],
                        'reproduction': {'status': 'not_attempted'}}
        self.flow = {'flow_id': 'ui-flow', 'findings': {'f': self.finding}, 'reset_eligible': True,
                     '_start': {'method': 'browser_only'}, 'execution_unknown': False,
                     'observation_incomplete': False, 'steps': [], 'actions': 0, 'rounds': 0,
                     'snapshot_ids': ['initial', 'original'], 'initial_snapshot_id': 'initial',
                     'initial_url': 'http://fixture.test/', 'image_refs': {'original': self.original},
                     'attempts': {}, 'replaying': False}
        self.page = SimpleNamespace(viewport_size={'width': 1280, 'height': 800}, wait_for_timeout=AsyncMock())
        self.evidence = SimpleNamespace(take_snapshot=AsyncMock(return_value=self.snapshot),
            snapshots={'initial': self.snapshot, 'original': self.snapshot},
            last_snapshot={'snapshot_id': 'initial'}, collector=SimpleNamespace(ready_selector=None, _sanitize=lambda x: x))
        self.model = SimpleNamespace(complete=AsyncMock(return_value={'role': 'assistant', 'stop_reason': 'tool_use',
            'content': [{'type': 'tool_use', 'id': 'toolu-ui-replay', 'name': 'reproduction_verdict',
                         'input': {'verdict': 'reproduced', 'reason': 'Fixture violation repeated'}}]}), last_usage={})
        self.runtime = SimpleNamespace(quality_checks=True, output=self.root, max_actions=5,
            calls=0, max_calls=5, max_rounds=5, site_requirements='Fixture only', judgment_model=self.model,
            usage=[], handle_tool=AsyncMock(return_value=({'image': self.replay}, [])))

    async def invoke(self):
        with patch('integration.reproduction.restore_start', new=AsyncMock(return_value=None)):
            return await reproduce(self.runtime, self.page, self.evidence, self.flow, 'f')

    async def test_zero_action_ui_can_confirm_only_with_two_actual_images_and_one_replay(self):
        result = await self.invoke()
        self.assertEqual(result['status'], 'reproduced')
        self.assertEqual(self.finding['status'], 'confirmed')
        messages = self.model.complete.call_args.args[1]
        self.assertEqual(sum(b['type'] == 'image' for b in messages[0]['content']), 2)
        self.assertEqual(result['attempts'], 1)
        self.assertEqual(len(self.runtime.usage), 1)
        with self.assertRaises(ValueError):
            await self.invoke()

    async def test_reset_permission_missing_image_and_scroll_mismatch_never_confirm(self):
        for mode in ('permission', 'image', 'scroll', 'state'):
            with self.subTest(mode=mode):
                self.finding['reproduction'] = {'status': 'not_attempted'}
                self.flow['reset_eligible'] = mode != 'permission'
                self.replay['scroll'] = {'x': 0, 'y': 40 if mode == 'scroll' else 0}
                self.original['path'] = 'missing.png' if mode == 'image' else 'original.png'
                self.evidence.snapshots['original'] = {**self.snapshot, 'text': 'Changed' if mode == 'state' else 'Title'}
                result = await self.invoke()
                self.assertNotEqual(result['status'], 'reproduced')
                self.assertEqual(self.finding['status'], 'candidate')
        self.model.complete.assert_not_called()

    async def test_no_replay_budget_does_not_call_model(self):
        self.runtime.max_calls = 0
        result = await self.invoke()
        self.assertEqual(result['reason'], 'reproduction_budget_unavailable')
        self.model.complete.assert_not_called()

    async def test_action_ui_captures_images_after_successful_recorded_replay(self):
        self.finding['action_ids'] = ['original-action']
        self.page.url = self.flow['initial_url']
        self.flow['steps'] = [{'phase': 'inspection', 'action_id': 'original-action', 'execution': 'executed',
                               'operation': 'click', 'element_key': 'button', 'scenario_id': 'ui', 'step_index': 0}]
        self.flow['attempts'] = {'original-action': {'execution': 'executed'}}
        async def handle(name, *args):
            if name == 'act':
                return {'action_id': 'replayed-action', 'after_snapshot_id': 'replayed-after',
                        'execution': 'executed', 'observation_status': 'available'}, []
            self.assertEqual(name, 'observe')
            return {'image': self.replay}, []
        self.runtime.handle_tool.side_effect = handle
        result = await self.invoke()
        self.assertEqual(result['status'], 'reproduced')
        self.assertEqual(result['action_ids'], ['replayed-action'])
        self.assertEqual([call.args[0] for call in self.runtime.handle_tool.call_args_list], ['act', 'observe'])
        self.assertEqual(sum(b['type'] == 'image' for b in self.model.complete.call_args.args[1][0]['content']), 2)

    async def test_not_reproduced_keeps_candidate_instead_of_passing_or_confirming(self):
        self.model.complete.return_value['content'][0]['input'] = {
            'verdict': 'not_reproduced', 'reason': 'The fixture symptom did not repeat.'}
        result = await self.invoke()
        self.assertEqual(result['status'], 'not_reproduced')
        self.assertEqual(self.finding['status'], 'candidate')
