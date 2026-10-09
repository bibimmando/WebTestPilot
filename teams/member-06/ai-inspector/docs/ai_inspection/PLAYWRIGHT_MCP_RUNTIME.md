# 실제 Playwright MCP 연결

2026-10-09, `development` 브랜치의 `member-06` 작업 공간.

기존 `run_inspection`, `ClaudePlanner`, `MCPExecutor`, `SharedPageObserver` 소스를 재사용한다.
담당자 확인 후 구현을 `teams/member-06/ai-inspector/`로 이동했으며 `member-02` 원본은 작업 전 상태로 복원했다.
크롤러·JSONL 입력 규격·기존 증거 분석 기능은 재구현하지 않았다.

```text
input_id + 등록된 검사 / 승인된 컨트롤
  → ClaudePlanner (개발 검증은 ScriptedPlanner)
  → validate_runtime_plan
  → MCPExecutor → LocalMCPClient → 실제 Microsoft Playwright MCP
  → 동일 CDP 탭의 SharedPageObserver
  → 다음 Planner 요청 / 판정 / 기존 JSON·JSONL 저장
```

## 설치

아래는 저장소 루트 PowerShell 기준이다. Python 3.11 이상과 Node 18 이상이 필요하다.

```powershell
. .\.tools\dev.ps1
python -m pip install -r teams/member-06/ai-inspector/requirements-ai.txt
npm install --prefix .tools/playwright-mcp @playwright/mcp@0.0.83 --no-audit --no-fund
```

검증 버전은 Python 3.12.14, MCP SDK 1.30.0, Playwright Python 1.63.0,
Playwright MCP 0.0.83이다. 서버 도구 목록과 `inputSchema`는 연결 시 실제 조회한다.
`browser_click.target`, `browser_type.target/text`, `browser_press_key.key`를 확인하고,
고유 선택자 지원을 광고하지 않는 버전이나 알 수 없는 필수 인자는 거절한다.
전체 조회 규격은 세션 폴더의 `mcp_tools.json`에 저장한다.

공식 서버 설명: <https://github.com/microsoft/playwright-mcp>.

## API 호출 없는 실제 실행

```powershell
python teams/member-06/ai-inspector/scripts/smoke_playwright_mcp.py
```

로컬 fixture 서버와 격리된 Chromium을 시작하고 실제 MCP로 버튼 클릭, `pilot` 입력,
Enter 키를 실행한다. API 호출은 0회다. 실행 후 서버·MCP 세션·자체 브라우저를 종료한다.
기본 결과 위치는 `.tools/mcp-smoke/`다.

- `runtime.json`: 신뢰하는 로컬 연결 설정·검사·컨트롤·동작/값 허용 목록
- `mock_plan.json`: 구조화된 계획
- `hybrid_ai_input.jsonl`: 원본 입력 ID를 가진 로컬 fixture 입력
- `inspection_results.jsonl`, `inspection_run.json`: 기존 출력 형식
- `session-*/mcp_tools.json`, `session-*/evidence/*.png`: 서버 규격과 실제 관찰 이미지

출력의 `actions[].receipt.tool_name`은 실제 호출한 도구이고 `before/after`는 같은 탭에서
수집한 관찰이다. `blocked_requests`는 값·주소 없이 차단한 요청의 메서드와 이유만 기록한다.
실행 완료와 검사 판정은 별개이며 자동 재현은 `not_attempted` 상태를 유지한다.

## 기존 JSONL과 연결

저장소 루트에서 가상환경을 활성화한 뒤 AI 모듈 디렉터리로 이동한다.
설정 경로·MCP 실행 파일·서버 CLI 인자는 절대 경로 사용을 권장한다.

```powershell
cd teams/member-06/ai-inspector
python -m src.ai_inspection.ai_inspector `
  --hybrid-input "C:\path\hybrid_ai_input.jsonl" `
  --execute --runtime-config "C:\path\runtime.json" `
  --mock-plan "C:\path\mock_plan.json" `
  --analysis-results "C:\path\ai_results.jsonl" `
  --limit 1 --max-rounds 3 --max-actions 10 --max-seconds 60 `
  --output-dir "C:\path\ai-results\execution"
```

`--analysis-results`는 선택 사항이다. 지정하면 `input_id`가 일치하는 완료된 분석 한 건에서
`suggested_checks`를 읽는다. `runtime.json`의 `suggestion_bindings`에 등록한 **정확한 문자열**에
매핑된 검사만 등록한다. 불명확한 제안은 무시하며 등록 가능한 검사가 없으면 실행하지 않는다.
모델이 생성한 자연어를 선택자·코드·권한으로 변환하지 않는다.

```json
{
  "mcp_command": "C:/Program Files/nodejs/node.exe",
  "mcp_args": ["C:/path/WebTestPilot/.tools/playwright-mcp/node_modules/@playwright/mcp/cli.js"],
  "timeout": 20,
  "controls": {"field": "#field"},
  "permissions": {"field": {"actions": ["fill", "press"], "values": ["pilot", "Enter"]}},
  "checks": {
    "echo": {"kind": "text_contains", "value": "typed pilot", "source": "requirement", "evidence_ref": "local-fixture-spec"}
  },
  "suggestion_bindings": {"입력 후 Enter 응답 확인": "echo"}
}
```

`cdp_endpoint`가 없으면 자체 격리 브라우저를 시작해 입력 URL로 이동한다.
기존 전처리팀 탭을 사용하려면 `cdp_endpoint: http://127.0.0.1:<port>`를 추가한다.
이 경우 미리 준비된 탭 하나가 입력 URL과 정확히 일치해야 하며 자동 이동·초기화하지 않는다.
임시 페이지 제목을 MCP 스냅샷에서 확인해 같은 탭임을 증명한 뒤 원래 제목으로 복원한다.
새 Planner 호출의 관찰은 해당 탭에서만 가져온다.

각 동작 직전에 컨트롤이 유일·가시·활성인지 다시 검사한다. URL이 바뀌면 이전 컨트롤을
더 이상 실행하지 않는다. 키 입력은 등록된 컨트롤에 포커스를 둔 다음 실제 MCP로 실행한다.
모델에 임의 MCP 도구나 JavaScript 실행 기능을 노출하지 않는다.

## Claude API 연결과 키

기존 `env_config.py`를 재사용한다. 저장소 루트 `WebTestPilot/.env`에서
`ANTHROPIC_API_KEY`를 읽으며 기존 환경변수가 우선한다.
`.env.example`에는 이름만 들어 있다. 이전 AI 모듈 디렉터리의 `.env`를 사용했다면
저장소 루트로 설정을 옮기거나 환경변수를 사용한다. 상위 폴더의 `.env`는 자동 검색하지 않는다.
키를 출력하거나 전체 `.env`를 다른 프로세스 환경으로 내보내지 않는다.
MCP 서버에는 제한된 브라우저 실행 환경변수만 전달하며 API 키를 상속하지 않는다.

Mock 검증 뒤 명시적으로 유료 테스트할 때만 다음 명령을 사용한다.

```powershell
python teams/member-06/ai-inspector/scripts/smoke_playwright_mcp.py `
  --planner claude --output-dir .tools/mcp-smoke-claude
```

이 smoke 경로는 Claude Haiku 계획 요청을 **최대 1회**, 출력 상한 1200토큰·요청 타임아웃 30초로
호출한다. 입력 토큰과 금액 상한을 뜻하지 않는다. 이후 종료는 로컬에서 처리한다.
실제 Planner 응답·MCP 실행·반환 사용량을 기존 결과에 저장한다.
일반 `--execute --runtime-config`에서는 `--mock-plan`을 생략하면 기존 ClaudePlanner를 사용하고
`--max-rounds`에 따라 여러 유료 요청이 발생할 수 있다.

## 검증 결과

2026-10-09: AI·로컬 브라우저·신규 MCP 테스트 48개 모두 통과했다.

- 실제 MCP click/fill/press 및 같은 탭의 전후 관찰·이미지
- 후속 Planner 요청에 변경된 본문 전달, JSON·JSONL의 입력 ID 유지
- 로컬 fixture의 POST 차단, 실행 종료 후 자체 브라우저 종료
- 도구 스키마 변경 거절, 미등록 값·컨트롤 거절, 타임아웃 취소·세션 종료
- 완료 분석의 입력 ID 연결과 등록된 제안만 검사로 선택
- 기존 준비·분석·실행 모드 회귀 및 환경변수 우선권·키 출력 방지

```powershell
cd teams/member-06/ai-inspector
$env:WEBTESTPILOT_BROWSER_TESTS = "1"
$env:WEBTESTPILOT_MCP_TESTS = "1"
python -m unittest discover -s src -t . -v
```

Mock의 실제 실행은 `.tools/mcp-smoke/inspection_run.json`에서 `completed`, 행동 3개,
`text_contains` 검사 `passed`를 확인했다. 저장소 루트 API 키가 설정되지 않아 유료 Claude smoke는
아직 실행하지 않았다. 실제 Claude Planner의 API 응답 검증은 완료되지 않았다.

## 남은 제한

단일 로컬 CDP 탭과 검토된 검사·동작·값만 지원한다. 기존 service worker가 있는 세션은 거절하고
새 worker 등록을 차단한다. GET/HEAD/OPTIONS 외 요청과 외부 출처 document 이동을 차단한다.
안전 정책을 적용하므로 로그인·결제·폼 제출·사용자 상태 변경 기능은 이번 범위가 아니다.
동적 컨트롤 재발견·여러 탭·다중 사용자·자동 재현·PDF는 구현하지 않았다.
타임아웃은 실패로 기록하며 이미 발생한 DOM 변화의 롤백을 보장하지 않는다.
관찰 내용과 이미지에는 테스트 화면 내용이 포함되므로 실행 산출물은 로컬에 보관한다.
