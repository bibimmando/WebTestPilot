# 팀원 6: Claude Planner와 Playwright MCP 실행 연결

`member-06` 담당 작업인 실제 MCP 실행 연결을 이 디렉터리에서 개발한다.
기존 `member-02` AI 검사기의 입력·분석·실행 관리자 소스를 재사용한 독립 실행 사본이며,
기존 코드의 작성자나 담당을 변경하는 의미는 아니다. `member-02` 원본은 이번 MCP 개발 이전 상태로 복원했다.

## 실행

저장소 루트 PowerShell 기준:

```powershell
. .\.tools\dev.ps1
python -m pip install -r teams/member-06/ai-inspector/requirements-ai.txt
npm install --prefix .tools/playwright-mcp @playwright/mcp@0.0.83 --no-audit --no-fund
python teams/member-06/ai-inspector/scripts/smoke_playwright_mcp.py
```

기본 smoke 실행은 API를 호출하지 않고 실제 로컬 MCP에서 클릭·입력·Enter를 검증한다.
실제 Claude 테스트는 저장소 루트 `WebTestPilot/.env`에 `ANTHROPIC_API_KEY`를 설정한 뒤
명시적으로 `--planner claude`를 지정한다. 해당 smoke 경로는 유료 계획 요청을 최대 1회 호출한다.

설정·기존 JSONL 연동·검증 결과·제한은 [상세 런타임 안내](docs/ai_inspection/PLAYWRIGHT_MCP_RUNTIME.md)를 따른다.

## 소스 구성

- `src/ai_inspection/mcp_client.py`: 실제 stdio MCP 세션·조회 스키마·타임아웃·네트워크 가드
- `src/ai_inspection/playwright_mcp_runtime.py`: 동일 CDP 탭 확인·승인된 동작 연결·제안 검사 매핑
- `src/ai_inspection/inspection_runtime.py`: 기존 검사 루프에 실행 receipt와 세션 정리 연결
- `src/ai_inspection/ai_inspector.py`: 기존 모드와 MCP 런타임·Mock 실행 CLI
- `scripts/smoke_playwright_mcp.py`, `examples/mcp_fixture.html`: 실제 로컬 동작 검증
- 나머지 입력·증거 판정·Claude 요청·MCP 어댑터와 기존 테스트: `member-02` 소스 재사용

독립 패키지가 `src`라는 기존 모듈 이름을 사용하므로 Python 모듈 실행·테스트는
`teams/member-06/ai-inspector`에서 수행한다. 같은 프로세스에서 `member-02`와 두 `src` 패키지를 혼합하지 않는다.

```powershell
cd teams/member-06/ai-inspector
$env:WEBTESTPILOT_BROWSER_TESTS = "1"
$env:WEBTESTPILOT_MCP_TESTS = "1"
python -m unittest discover -s src -t . -v
```

키와 실행 산출물은 Git에서 제외한다. 자동 재현·인증·다중 탭·PDF는 이번 구현 범위에 포함하지 않는다.
