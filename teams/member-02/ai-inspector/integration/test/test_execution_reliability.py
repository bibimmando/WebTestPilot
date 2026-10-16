from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock

from integration.campaign_state import CampaignState
from integration.execution_reliability import planning_tool, isolate_plan, bind_targets, check_target
from integration.plan_contract import validate_plan
from integration.staged import _call


class ReliabilityTest(unittest.TestCase):
    def setUp(self):
        self.initial = {'observation': {'page': {'url': 'https://example.test/item', 'snapshot_id': 'start'},
            'links': [], 'controls': [{'key': 'bag', 'tag': 'a', 'href': '/basket'},
                {'key': 'close', 'tag': 'button', 'text': 'Close notification'}]}}
        self.scenario = {'scenario_id': 'open_bag', 'proposal_index': 0, 'title': 'Open basket',
            'family': 'routing', 'expected': 'Basket opens', 'expected_source': 'observed basket link',
            'steps': [{'operation': 'click', 'element_key': 'bag'}]}
        self.proposals = {'page_summary': 'Example', 'proposed_checks': ['Open basket'], 'open_questions': []}

    def test_href_in_observed_controls_is_allowed_but_guessed_and_foreign_urls_are_not(self):
        sc = deepcopy(self.scenario)
        sc['steps'] = [{'operation': 'navigate', 'url': 'https://example.test/basket'}]
        validate_plan({'scenarios': [sc], 'unplanned': []}, self.proposals, self.initial, 4)
        enum = planning_tool(self.initial)['input_schema']['properties']['scenarios']['items']['properties']['steps']['items']['oneOf'][-1]['properties']['url']['enum']
        self.assertEqual(enum, ['https://example.test/basket'])
        for url in ('https://example.test/guessed', 'https://foreign.test/basket'):
            sc['steps'][0]['url'] = url
            with self.assertRaises(ValueError):
                validate_plan({'scenarios': [sc], 'unplanned': []}, self.proposals, self.initial, 4)

    def test_atomic_rejection_keeps_valid_prefix_and_initial_ui_but_blocks_unknown_dependencies(self):
        bad = {**deepcopy(self.scenario), 'scenario_id': 'bad', 'proposal_index': 1,
               'steps': [{'operation': 'navigate', 'url': 'https://example.test/guessed'}]}
        dependent = {**self.scenario, 'scenario_id': 'dependent', 'proposal_index': 2}
        ui = {**self.scenario, 'scenario_id': 'ui', 'proposal_index': 3, 'family': 'ui', 'steps': []}
        proposals = {**self.proposals, 'proposed_checks': ['a', 'b', 'c', 'd']}
        plan, _, rejects = isolate_plan({'scenarios': [self.scenario, bad, dependent, ui], 'unplanned': []},
                                       proposals, self.initial, 6)
        self.assertEqual([s['scenario_id'] for s in plan['scenarios']], ['ui', 'open_bag'])
        self.assertEqual(len(rejects), 2)
        self.assertIn('dependency_unknown', rejects[1]['reason'])
        self.assertEqual({u['proposal_index'] for u in plan['unplanned']}, {1, 2})

    def test_unnamed_link_cannot_be_replaced_by_toast_close_or_wrong_href(self):
        bound = bind_targets({'scenarios': [self.scenario]}, self.initial, {})['open_bag'][0]
        current = {'page': self.initial['observation']['page'], 'controls': self.initial['observation']['controls']}
        self.assertEqual(check_target(bound, 'bag', current)['status'], 'matched')
        with self.assertRaises(ValueError):
            check_target(bound, 'close', current)
        current['controls'] = [{'key': 'bag', 'tag': 'a', 'href': '/other'}]
        with self.assertRaises(ValueError):
            check_target(bound, 'bag', current)

    def test_rebound_key_needs_unique_semantic_identity_and_no_app_outcome_requirement(self):
        bound = {'role': 'button', 'name': 'Increase'}
        current = {'page': {}, 'controls': [{'key': 'new', 'tag': 'button', 'text': 'Increase'}]}
        check_target(bound, 'new', current)  # Its application handler may still be broken.
        current['controls'].append({'key': 'duplicate', 'tag': 'button', 'text': 'Increase'})
        with self.assertRaises(ValueError):
            check_target(bound, 'new', current)

    def test_unnamed_control_requires_same_actual_node_not_same_css_position(self):
        bound = {'role': 'button', 'observed_ref': 'document-a:19'}
        current = {'page': {}, 'controls': [{'key': 'rebound', 'tag': 'button', 'observed_ref': 'document-a:19'}]}
        check_target(bound, 'rebound', current)
        current['controls'][0]['observed_ref'] = 'document-b:19'
        with self.assertRaises(ValueError):
            check_target(bound, 'rebound', current)

    def test_campaign_persists_across_runtime_instances_and_refuses_scope_or_concurrency_mix(self):
        with TemporaryDirectory() as root:
            path = Path(root) / 'campaign.json'
            ledger = CampaignState(path, 'https://example.test/a', 'spec', False)
            runtime = SimpleNamespace()
            ledger.attach(runtime)
            runtime.common_check_descriptions['case'] = {'finding_id': 'finding', 'verdict': 'passed'}
            ledger.save(runtime)
            with self.assertRaises(FileExistsError):
                CampaignState(path, 'https://example.test/a', 'spec', False)
            ledger.close()
            other = CampaignState(path, 'https://example.test/b', 'spec', False)
            other.attach(runtime)
            self.assertEqual(runtime.covered_common_checks, {'case'})
            other.close()
            with self.assertRaises(ValueError):
                CampaignState(path, 'https://different.test/', 'spec', False)


class PlanningBoundaryTest(unittest.IsolatedAsyncioTestCase):
    async def test_model_ignoring_navigation_enum_reaches_atomic_rejection_without_losing_valid_ui(self):
        initial = {'observation': {'page': {'url': 'https://example.test/', 'snapshot_id': 'initial'},
                                  'controls': [], 'links': []}}
        common = {'proposal_index': 0, 'title': 'Initial view', 'family': 'ui',
                  'expected': 'Readable heading', 'expected_source': 'supplied requirement', 'steps': []}
        args = {'page_summary': 'Example', 'proposed_checks': ['View', 'Route'], 'open_questions': [],
            'scenarios': [{'scenario_id': 'view', **common},
                {**common, 'scenario_id': 'route', 'proposal_index': 1, 'family': 'routing',
                 'steps': [{'operation': 'navigate', 'url': 'https://example.test/invented'}]}], 'unplanned': []}
        model = SimpleNamespace(last_usage={}, complete=AsyncMock(return_value={'role': 'assistant',
            'stop_reason': 'tool_use', 'content': [{'type': 'tool_use', 'id': 'tool-1',
                                                  'name': 'qa_test_plan', 'input': args}]}))
        with TemporaryDirectory() as root:
            runtime = SimpleNamespace(model=model, output=Path(root), calls=0, max_calls=3, max_rounds=3,
                                      usage=[], quality_checks=True, persist=lambda *a: None)
            evidence = SimpleNamespace(collector=SimpleNamespace(_sanitize=lambda x: x))
            flow = {'flow_id': 'flow', 'rounds': 0, 'messages': []}
            accepted, _ = await _call(runtime, evidence, flow, 'planning', 'instructions', {}, planning_tool(initial))
            plan, _, rejected = isolate_plan({'scenarios': accepted['scenarios'], 'unplanned': []},
                {k: accepted[k] for k in ('page_summary', 'proposed_checks', 'open_questions')}, initial, 3)
            self.assertEqual([s['scenario_id'] for s in plan['scenarios']], ['view'])
            self.assertEqual(rejected[0]['scenario_id'], 'route')
            self.assertEqual(model.complete.await_count, 1)


if __name__ == '__main__':
    unittest.main()
