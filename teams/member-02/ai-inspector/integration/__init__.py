"""WebTestPilot 기준 코드: 전처리, Claude 검사, MCP 실행을 한 패키지에서 연결한다."""

import sys
from pathlib import Path

# Existing local dependency install; normal virtualenv installations need no path changes.
_deps = Path(__file__).resolve().parent.parent / '.tools/integration-deps'
if _deps.is_dir() and str(_deps) not in sys.path:
    sys.path.append(str(_deps))
