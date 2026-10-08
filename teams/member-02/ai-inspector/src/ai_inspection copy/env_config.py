"""Read the local Claude API key without exposing or exporting its value."""

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


# 실행 위치와 무관하게 프로젝트 루트 설정만 읽고 환경변수에 우선권을 준다.
def get_anthropic_api_key() -> str:
    existing = os.environ.get("ANTHROPIC_API_KEY")
    if existing is not None:
        return existing.strip()
    from dotenv import dotenv_values

    # 다른 환경변수 참조를 확장하거나 전체 .env를 프로세스 환경에 넣지 않는다.
    values = dotenv_values(PROJECT_ROOT / ".env", encoding="utf-8-sig", interpolate=False)
    return (values.get("ANTHROPIC_API_KEY") or "").strip()


# API 호출 없이 키 설정 여부만 출력하며 값은 표시하지 않는다.
def main() -> int:
    configured = bool(get_anthropic_api_key())
    print("Claude API key: configured (no API call)" if configured else
          "Claude API key: not configured; fill ANTHROPIC_API_KEY in the project-root .env")
    return 0 if configured else 1


if __name__ == "__main__":
    raise SystemExit(main())
