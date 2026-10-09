# WebTestPilot — Claude Planner와 Playwright MCP 실행 연결

## 목표

기존 WebTestPilot 프로젝트의 AI 검사 모듈에서 Claude가 생성한 검사 계획을 실제 Playwright MCP로 실행할 수 있도록 연결한다.

크롤러, JSONL 생성, 기존 Claude 증거 분석, 기본 실행 관리자 및 결과 저장 기능은 이미 구현되어 있으므로 재개발하지 않는다.

**개발 범위는 Claude Planner → Playwright MCP 실제 실행 연결에 한정한다.**

## 1. 기존 코드 분석

`development` 브랜치의 다음 파일을 먼저 분석한다.

- `claude_client.py`
- `inspection_runtime.py`
- `mcp_executor.py`
- `browser_runner.py`
- `evidence_inspector.py`
- `inspection_input.py`

특히 다음 연결 관계를 확인한다.

`ClaudePlanner → RuntimeBinding → MCPExecutor → MCP Client → Playwright MCP Server`

이미 구현된 기능을 최대한 재사용한다.

## 2. 검사 계획 연결

기존 AI 분석 결과의 `suggested_checks`는 자연어 검사 제안이다.

이를 실제 실행할 수 있도록 다음 처리를 추가한다.

1. 원본 `input_id`와 AI 분석 결과를 연결한다.
2. `suggested_checks`를 검사 후보로 사용한다.
3. 기존 `binding.checks`의 검사 규격으로 변환할 수 있는 항목만 등록한다.
4. Claude Planner가 등록된 검사와 허용된 컨트롤을 선택하도록 한다.
5. 생성된 계획을 기존 `validate_runtime_plan()`으로 검증한다.

검사 목적이 불명확하거나 실행할 수 없는 제안은 무리하게 실행하지 않는다.

## 3. 실제 MCP 연결

기존 `MCPExecutor`에 주입할 실제 MCP 클라이언트 어댑터를 구현한다.

필요 기능:

- Playwright MCP 서버와 연결
- MCP 세션 생성 및 종료
- 서버가 제공하는 도구 목록 조회
- 지원하는 도구의 이름과 입력 스키마 확인
- `click`, `fill`, `press`를 실제 MCP 도구에 매핑
- MCP `CallToolResult`를 기존 Executor 규격으로 정규화
- MCP 오류 및 타임아웃 처리
- 기존 실행 관리자에 실제 MCP Executor 주입

MCP 도구명이나 인자 구조를 추측해서 하드코딩하지 말고, 실제 서버의 도구 스키마를 기준으로 연결한다.

## 4. Claude와 실행 결과의 반복 연결

기존 `run_inspection()` 흐름을 활용한다.

Claude가 검사 계획을 생성하면:

1. 실행 관리자가 계획을 검증한다.
2. 실제 Playwright MCP 도구를 호출한다.
3. 브라우저 실행 결과를 수집한다.
4. 변경된 페이지 상태를 관찰한다.
5. 관찰 결과를 다음 Claude Planner 호출에 반영한다.
6. 검사 완료 또는 중단 조건까지 반복한다.

Claude가 임의의 MCP 도구나 임의의 브라우저 스크립트를 실행하지 못하도록 한다.

## 5. 브라우저 세션

MCP가 조작하는 브라우저와 관찰기가 확인하는 브라우저는 동일한 탭이어야 한다.

기존 크롤러가 생성한 선택자가 현재 DOM에서 유효한지 재검증한다.

공통 세션을 사용할 수 없는 경우에는 별도 브라우저의 관찰 결과를 같은 세션의 결과로 취급하지 않는다.

## 6. API 연결 정책

초기 개발에서는 실제 Claude API 키 없이 Mock Planner를 사용한다.

실제 MCP 서버와 Mock Planner를 연결하여 브라우저 조작이 성공하는지 먼저 검증한다.

그다음 기존 `ClaudePlanner`를 주입해 실제 Claude API를 사용하는 구조로 확장한다.

기존 Claude API 구현을 불필요하게 변경하지 않는다.

## 7. 출력

모든 실행 결과는 JSON으로 기록한다.

기존 `inspection_results.jsonl`, `inspection_run.json`과의 호환성을 유지한다.

최소 포함 정보:

- `input_id`
- Claude가 생성한 검사 계획
- 선택한 MCP 도구
- 실행 상태
- 실행 전후 관찰 결과
- 검사 판정
- 오류 유형
- 종료 사유

## 8. 완료 조건

다음 경로가 실제 Playwright MCP 서버에서 작동해야 한다.

`검사 후보 → Claude Planner의 구조화된 계획 → MCP 도구 호출 → 브라우저 실제 조작 → 결과 재관찰 → JSON 저장`

최소한 버튼 클릭, 입력 필드 작성, 키 입력을 실제 MCP로 검증한다.

기존 테스트를 유지하면서 신규 통합 테스트를 추가한다.

구현 후 변경 파일, 연결 구조, 실행 방법, 실제 검증 결과 및 남은 제한 사항을 설명한다.