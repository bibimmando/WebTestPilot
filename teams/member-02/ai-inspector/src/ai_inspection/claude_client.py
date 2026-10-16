"""Compatibility entry point; implementation: providers/claude_client.py.

The old import and the canonical import resolve to the same module, including
module globals used by configuration and test patches.
"""
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.ai_inspection.providers import claude_client as _implementation

sys.modules[__name__] = _implementation
