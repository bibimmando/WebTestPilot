import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from integration.examples.maison_recheck.run_campaign import HERE, prepare, run, command


class CampaignRunnerTest(unittest.IsolatedAsyncioTestCase):
    def test_portable_inputs_and_commands_need_no_historical_results(self):
        config, specs = prepare(HERE / 'campaign_config.json')
        self.assertEqual(len(specs), 31)
        self.assertEqual(sum(s['group'] == 'followup' for s in specs), 2)
        self.assertTrue(all('requirements' in s for s in specs))
        args = command(specs[0], Path('new-output'), config['settings'], 95)
        self.assertIn('--browser-state-reset', args)
        self.assertIn('--campaign-state', args)
        self.assertNotIn('--allow-writes', args)

    def test_target_scope_and_input_path_are_bounded(self):
        for target in ('https://user:secret@example.test', 'https://example.test/path', 'file:///tmp'):
            with self.assertRaises(ValueError):
                prepare(HERE / 'campaign_config.json', target=target)
        _, specs = prepare(HERE / 'campaign_config.json', target='https://example.test', limit=1, skip_followups=True)
        self.assertEqual(len(specs), 1)
        self.assertEqual(specs[0]['url'], 'https://example.test/products')

    async def test_default_prepare_never_calls_browser_or_model_and_preserves_inputs(self):
        config, specs = prepare(HERE / 'campaign_config.json', limit=1, skip_followups=True)
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / 'prepared'
            with patch('integration.__main__.run', new=AsyncMock(side_effect=AssertionError('no live run'))) as live:
                data = await run(config, specs, out)
                live.assert_not_awaited()
            self.assertEqual(data['status'], 'prepared')
            self.assertFalse(data['paid_execution'])
            self.assertEqual((out / 'inputs' / (specs[0]['label'] + '.md')).read_text(encoding='utf-8'), specs[0]['requirements'])
            with self.assertRaises(ValueError):
                await run(config, specs, out)

    async def test_explicit_execution_uses_existing_cli_only_and_restores_argv(self):
        import sys
        from types import SimpleNamespace
        config, specs = prepare(HERE / 'campaign_config.json', limit=1, skip_followups=True)
        original = sys.argv
        with tempfile.TemporaryDirectory() as folder:
            with patch('integration.models.env_value', return_value='dummy-test-key'), \
                 patch('integration.__main__.parse_args', return_value=SimpleNamespace()), \
                 patch('integration.__main__.run', new=AsyncMock(return_value=({'run_id': 'mock'}, False))) as live:
                data = await run(config, specs, Path(folder) / 'mocked', execute=True)
                live.assert_awaited_once()
        self.assertEqual(data['status'], 'finished')
        self.assertIs(sys.argv, original)


if __name__ == '__main__':
    unittest.main()
