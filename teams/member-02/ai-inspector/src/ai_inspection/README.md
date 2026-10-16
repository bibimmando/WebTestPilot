# AI 검사기 파일 구성

기준일: 2026-10-13. 기존 구현 9개를 역할별 패키지로 이전했습니다.
루트의 같은 이름 파일은 기존 import·터미널 명령을 유지하기 위한 작은 호환 진입점입니다.
실제 구현은 하위 폴더의 한 곳에만 존재합니다. 판정 모듈은 입력·요청·응답 검증과 오프라인 예시 실행을 구현했습니다.

## 실제 구성

```text
src/ai_inspection/
├─ README.md
├─ __init__.py
├─ ai_inspector.py                  # 기존 준비·분석·실행 CLI
├─ inspection_input.py              # 아래 9개는 기존 모듈 경로 호환 파일
├─ evidence_inspector.py
├─ inspection_runtime.py
├─ browser_runner.py
├─ mcp_executor.py
├─ playwright_mcp_runtime.py
├─ execution_handoff.py
├─ claude_client.py
├─ env_config.py
├─ analysis/
│  ├─ __init__.py
│  ├─ inspection_input.py           # hybrid JSONL·내부 문맥
│  ├─ evidence_inspector.py         # 저장 증거 분석·기존 조건 비교
│  └─ test/__init__.py
├─ execution/
│  ├─ __init__.py
│  ├─ inspection_runtime.py         # 계획·권한·실행·관찰·판정 조율
│  ├─ browser_runner.py             # 관찰·행동 검증·독립 제한 실행
│  ├─ mcp_executor.py               # 등록된 MCP 도구 어댑터
│  ├─ playwright_mcp_runtime.py     # 실제 stdio MCP·CDP 연결
│  └─ test/__init__.py
├─ handoff/
│  ├─ __init__.py
│  ├─ execution_handoff.py          # 전달 JSONL 초안·검토 입력
│  └─ test/__init__.py
├─ providers/
│  ├─ __init__.py
│  ├─ claude_client.py              # 모델 전송·분석기·행동 선택기
│  ├─ env_config.py                 # 프로젝트 루트 .env 설정
│  └─ test/__init__.py
├─ judgment/                       # judge_input/2 독립 판정
│  ├─ README.md
│  ├─ __init__.py
│  ├─ input_contract.py
│  ├─ prompts.py
│  ├─ judge.py
│  ├─ response_contract.py
│  ├─ assessment.py                # 조건별 검토·부분 충족 통과 보류
│  ├─ async_adapter.py             # 통합 비동기 호출 연결
│  ├─ images.py
│  ├─ schemas/
│  ├─ examples/
│  └─ test/                       # 새 판정 테스트
└─ test/                           # 기존 테스트 위치·분류 보존
   ├─ __init__.py
   └─ test_*.py
```

judgment/test/에는 새 판정 테스트가 있으며 다른 역할별 test/에는 현재 __init__.py만 있습니다. 기존 테스트는 이동하지 않았습니다.
새 기능의 테스트는 해당 패키지의 별도 test/에 추가합니다.

## 역할별 경계

| 패키지 | 책임 |
|---|---|
| analysis | 크롤러 JSONL 검증·저장 증거 검토·설명형 제안 |
| execution | 행동 한도·권한·브라우저·MCP·전후 증거·기존 기대 조건 비교 |
| handoff | 기존 분석과 원본을 연결한 오프라인 전달 초안 |
| providers | Claude 전송·오류·사용량·설정 |
| judgment | judge_input/2 독립 판정·비동기 통합 연결, 실제 모델 정확도 검증은 후속 |

현재 judge_observation()은 analysis/evidence_inspector.py의 기존 텍스트·URL 비교입니다.
새 judgment AI의 구현으로 해석하지 않습니다. 기능 분리는 판정 개발과 함께 검토합니다.
외부 전처리 코드와 기존 결과 파일은 이동하지 않았습니다.

## 의존성과 호환성

내부 구현과 루트 CLI는 새 정규 모듈 경로를 사용합니다. 예:

```python
from src.ai_inspection.analysis.inspection_input import load_hybrid_input
from src.ai_inspection.execution.inspection_runtime import RuntimeBinding
from src.ai_inspection.providers.claude_client import ClaudeAnalyzer
```

기존 src.ai_inspection.claude_client 등의 import도 유지합니다.
호환 파일은 sys.modules를 통해 새 구현 모듈 자체를 연결하므로 클래스·모듈 전역값·기존 mock patch 대상이 동일합니다.
단순 함수 복사나 구현 복제가 아닙니다. 호환 경로의 __file__은 실제 구현 위치를 가리킬 수 있습니다.

providers/env_config.py의 PROJECT_ROOT는 이동한 파일 깊이를 반영해 기존 프로젝트 루트를 유지합니다.
handoff/execution_handoff.py의 직접 실행 sys.path도 새 깊이를 반영했습니다.
기존 runtime-factory 모듈 경로와 공개 함수 이름은 유지합니다.
__init__.py에서는 모델·브라우저 호출이나 패키지 전체 자동 import를 수행하지 않습니다.

## 기존 명령과 새 명령

프로젝트 루트에서 기존 명령을 그대로 사용할 수 있습니다.

```powershell
.\.venv\Scripts\python.exe .\src\ai_inspection\ai_inspector.py --help
.\.venv\Scripts\python.exe -m src.ai_inspection.execution_handoff --help
.\.venv\Scripts\python.exe .\src\ai_inspection\execution_handoff.py --help
.\.venv\Scripts\python.exe -m src.ai_inspection.env_config
```

전달 모듈의 새 정규 실행 경로도 지원합니다.

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.handoff.execution_handoff --help
.\.venv\Scripts\python.exe .\src\ai_inspection\handoff\execution_handoff.py --help
```

env_config 명령은 키 값 없이 설정 여부만 출력하며 API를 호출하지 않습니다.

## 테스트

```powershell
# 기존 사용자 분류의 테스트
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection/test -t . -v

# 새 하위 패키지 test까지 전체 검색
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection -t . -v
```

기본 실행은 유료 API를 호출하지 않습니다. 실제 로컬 브라우저·MCP 검증은 다음과 같이 명시적으로 활성화합니다.

```powershell
$env:WEBTESTPILOT_BROWSER_TESTS = "1"
$env:WEBTESTPILOT_MCP_TESTS = "1"
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection -t . -v
Remove-Item Env:WEBTESTPILOT_BROWSER_TESTS
Remove-Item Env:WEBTESTPILOT_MCP_TESTS
```

Node.js·Chrome/Edge·로컬 MCP 테스트 서버 설치 조건은 개발 상세 문서 12번을 참고합니다.

이번 이동 후 검증: 실제 로컬 MCP·브라우저 포함 AI 테스트 47개 및 동기화 테스트 3개 모두 통과했습니다.
9개 기존 import와 새 import의 모듈 동일성, .env 기준 경로, 구·신 CLI 진입점도 확인했습니다.

## 판정 모듈

judgment/input_contract.py, prompts.py, judge.py, response_contract.py, images.py, async_adapter.py와 별도 test/를 구현했습니다.
[판정 작업 디렉토리 문서](judgment/README.md)와 [개발 상세](../../docs/ai_inspection/AI_JUDGMENT_MODULE.md)를 참고하세요.
판정 로직은 전처리 MCP 실행 코드가 아닌 judge_input/2 계약을 기준으로 개발합니다.
별도 worktree의 judgment_bridge.py와 staged.py에 연결하고 전처리팀 모델 통신·호출 한도·기한·취소 관리를 유지했습니다.
처음 보는 개발자는 [전체 흐름·동기화·데모 안내](../../docs/ai_inspection/PROJECT_PIPELINE_GUIDE.md)를 참고하세요.

## 관련 문서

- [팀 공유 문서](../../docs/ai_inspection/AI_README.md)
- [개발 상세 문서](../../docs/ai_inspection/AI_ANALYSIS_IMPLEMENTATION.md)
- [전처리팀 판정 계약](https://github.com/bibimmando/WebTestPilot/blob/development/teams/member-01/integration/docs/JUDGMENT_CONTRACT.md)

GitHub 반영과 실제 모델 정확도 확인은 별도 작업입니다.

2026-10-15 판정 조건별 검토와 실행·UI 재현 품질 보완을 추가했습니다.
[판정 코드 변경 안내](judgment/QUALITY_IMPROVEMENTS.md)와
[전체 변경·검증 기록](../../docs/ai_inspection/INSPECTION_QUALITY_IMPROVEMENTS_2026-10-15.md)을 참고하세요.
# 실행 신뢰성 후속 기록

2026-10-16: 관찰 URL·실행 대상 일치·DOM 상태 증거·캠페인 기록의 공통 보완은 [EXECUTION_RELIABILITY.md](EXECUTION_RELIABILITY.md)를 참고합니다.
