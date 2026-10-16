"""Compatibility entry point; implementation: handoff/execution_handoff.py.

The old import and the canonical import resolve to the same module, including
module globals used by configuration and test patches.
"""
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.ai_inspection.handoff import execution_handoff as _implementation

if __name__ == "__main__":
    raise SystemExit(_implementation.main())

sys.modules[__name__] = _implementation
