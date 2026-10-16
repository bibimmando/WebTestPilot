"""Behavioral safeguards: partial satisfaction must never become a passing verdict."""
from copy import deepcopy
import json
import unittest
from pathlib import Path

from src.ai_inspection.judgment.assessment import review_response
from src.ai_inspection.judgment.async_adapter import judge_async, JudgmentValidationError
from src.ai_inspection.judgment.input_contract import ROOT
from src.ai_inspection.judgment.judge import prepare_request


def reviewed(item, *, status='met', purpose=True, supported=True):
    result = deepcopy(item)
    result['assessment'] = {'expectation_supported': supported, 'purpose_covered': purpose,
        'reason': 'Check the full intended state transition, not only a numeric bound.',
        'criteria': [{'criterion': 'Frozen expected behavior', 'status': status,
                      'evidence': 'Facts from the referenced observations.',
                      'snapshot_ids': list(item['snapshot_ids']), 'action_ids': list(item['action_ids'])}]}
    return result


class AssessmentTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.payload = json.loads((ROOT / 'examples/judge_input.v2.example.json').read_text(encoding='utf-8'))
        reply = json.loads((ROOT / 'examples/scenario_judgments.example.json').read_text(encoding='utf-8'))
        self.item = reply['judgments'][0]
        self.payload['scenarios'] = self.payload['scenarios'][:1]

    def test_partial_pass_and_weak_purpose_downgrade_without_promoting_to_bug(self):
        self.item['verdict'] = 'passed'
        for changes in ({'status': 'unknown'}, {'status': 'unmet'}, {'purpose': False}, {'supported': False}):
            with self.subTest(changes=changes):
                result, audit = review_response({'judgments': [reviewed(self.item, **changes)]}, self.payload)
                self.assertEqual(result['judgments'][0]['verdict'], 'inconclusive')
                self.assertEqual(audit['scenarios'][0]['model_verdict'], 'passed')
                self.assertNotIn('assessment', result['judgments'][0])

    def test_saved_filter_clear_partial_pass_regression(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/f4_saved_partial_pass.json').read_text(encoding='utf-8'))
        result, audit = review_response({'judgments': [fixture['reviewed_judgment']]},
                                        {'scenarios': [fixture['scenario']]})
        self.assertEqual(fixture['original_judgment']['verdict'], 'passed')
        self.assertEqual(result['judgments'][0]['verdict'], 'inconclusive')
        self.assertEqual(audit['scenarios'][0]['assessment']['criteria'][0]['status'], 'met')
        self.assertEqual(audit['scenarios'][0]['assessment']['criteria'][1]['status'], 'unknown')

    def test_candidate_requires_evidenced_unmet_criterion(self):
        for status, expected in [('met', 'inconclusive'), ('unknown', 'inconclusive'), ('unmet', 'candidate')]:
            result, _ = review_response({'judgments': [reviewed(self.item, status=status)]}, self.payload)
            self.assertEqual(result['judgments'][0]['verdict'], expected)

    def test_missing_assessment_and_unowned_criterion_evidence_are_rejected(self):
        with self.assertRaises(ValueError):
            review_response({'judgments': [self.item]}, self.payload)
        item = reviewed(self.item)
        item['assessment']['criteria'][0]['snapshot_ids'] = ['foreign']
        with self.assertRaises(ValueError):
            review_response({'judgments': [item]}, self.payload)

    async def test_strict_async_retains_id_audit_and_external_response_contract(self):
        self.item['verdict'] = 'passed'
        audit = {}
        async def call(request):
            self.assertIn('assessment', request['tools'][0]['input_schema']['properties']['judgments']['items']['required'])
            return {'judgments': [reviewed(self.item)]}, 'toolu-reviewed'
        result, identifier = await judge_async(self.payload, call=call, structured=True, assessment_sink=audit.update)
        self.assertEqual(identifier, 'toolu-reviewed')
        self.assertEqual(result, {'judgments': [self.item]})
        self.assertEqual(audit['scenarios'][0]['accepted_verdict'], 'passed')
        async def legacy(request):
            return {'judgments': [self.item]}, 'toolu-missing-review'
        with self.assertRaises(JudgmentValidationError) as caught:
            await judge_async(self.payload, call=legacy, structured=True)
        self.assertEqual(caught.exception.tool_use_id, 'toolu-missing-review')

    def test_live_schema_is_an_extension_not_a_modified_team_schema(self):
        plain, _ = prepare_request(self.payload)
        strict, _ = prepare_request(self.payload, structured=True)
        def required(r):
            return r['tools'][0]['input_schema']['properties']['judgments']['items']['required']
        self.assertNotIn('assessment', required(plain))
        self.assertIn('assessment', required(strict))
