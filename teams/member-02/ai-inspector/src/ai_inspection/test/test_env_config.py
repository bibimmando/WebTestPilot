import contextlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from src.ai_inspection import env_config
from src.ai_inspection.claude_client import ClaudeAnalyzer


class LocalEnvironmentTest(unittest.TestCase):
    def test_reads_project_file_and_does_not_export_unrelated_values(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".env").write_text('ANTHROPIC_API_KEY="fixture-key"\nUNRELATED_TEST_VALUE=private\n', encoding="utf-8-sig")
            with patch.object(env_config, "PROJECT_ROOT", root), patch.dict(os.environ, {}, clear=True), patch(
                    "src.ai_inspection.claude_client.urlopen", side_effect=AssertionError("No API calls")):
                self.assertEqual(env_config.get_anthropic_api_key(), "fixture-key")
                client = ClaudeAnalyzer(model="test-model")
                self.assertEqual(client._api_key, "fixture-key")
                self.assertNotIn("UNRELATED_TEST_VALUE", os.environ)
                self.assertNotIn("ANTHROPIC_API_KEY", os.environ)
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(env_config.main(), 0)
                self.assertNotIn("fixture-key", output.getvalue())

    def test_environment_has_priority_even_if_empty(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".env").write_text("ANTHROPIC_API_KEY=file-key\n", encoding="utf-8")
            with patch.object(env_config, "PROJECT_ROOT", root):
                for supplied, expected in (("terminal-key", "terminal-key"), ("", "")):
                    with self.subTest(supplied=supplied), patch.dict(os.environ, {"ANTHROPIC_API_KEY": supplied}, clear=True):
                        self.assertEqual(env_config.get_anthropic_api_key(), expected)

    def test_missing_or_empty_file_and_no_variable_expansion(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(env_config, "PROJECT_ROOT", root), patch.dict(os.environ, {}, clear=True):
                self.assertEqual(env_config.get_anthropic_api_key(), "")
                (root / ".env").write_text("ANTHROPIC_API_KEY=\n", encoding="utf-8")
                with self.assertRaises(ValueError):
                    ClaudeAnalyzer()
                (root / ".env").write_text("ANTHROPIC_API_KEY=${SOME_VARIABLE}\n", encoding="utf-8")
                self.assertEqual(env_config.get_anthropic_api_key(), "${SOME_VARIABLE}")
