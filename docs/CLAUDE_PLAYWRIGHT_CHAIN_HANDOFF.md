# Claude–Playwright MCP 연결: 파일별 변경 설명

브랜치: `claude-playwright-chain`

구현 커밋: `71bddbb306d7978129682f6eb301653dc479b128`

작성일: 2026-10-09

## 현재 작업 위치

담당자를 확인한 뒤 MCP 연결 구현을 `teams/member-06/ai-inspector/`로 이동했다.
기존 AI 검사기의 필요한 소스는 재사용 사본으로 함께 배치해 독립 실행한다.
`teams/member-02/ai-inspector/`는 구현 전 `7cfdd95` 상태로 복원했다.
현재 실행 안내는 `teams/member-06/ai-inspector/README.md`와 해당 폴더의 런타임 문서를 따른다.
아래 표의 `member-02` 경로는 기존 구현 커밋의 변경 이력을 설명하는 역사적 경로다.

이동 후 `member-06`의 48개 테스트와 실제 MCP Mock 실행(행동 3개·검사 통과)을 검증했다.
복원한 `member-02`의 40개 기존 테스트도 모두 통과했으며 원본 `7cfdd95`와 파일 내용이 일치한다.

기존 AI 검사기에 실제 로컬 Playwright MCP 연결을 추가했다. 기존 크롤러와 증거 분석은
재사용하며, 구조화된 계획을 승인된 컨트롤에 실행하고 같은 탭의 관찰 결과를 다시 Planner에 전달한다.

## 구현 커밋의 17개 파일

아래에서 `AI/`는 `teams/member-02/ai-inspector/`를 뜻한다.

| 파일 | 변경 | 역할과 수정 이유 |
|---|---|---|
| `.env.example` | 추가 | `ANTHROPIC_API_KEY` 이름만 제공하는 빈 설정 예시. 실제 키 없이 팀원이 로컬 설정을 준비하도록 한다. |
| `.gitignore` | 수정 | `**/.playwright-mcp/`를 제외해 MCP 서버가 생성한 로컬 산출물이 커밋되지 않도록 한다. 기존 `.env` 제외 규칙은 유지한다. |
| `Claude API Key SECURE.md` | 추가 | 사용자가 제공한 키 보안·로컬 실행 요구사항. 환경변수, Git 제외, 로그 노출 방지와 완료 조건의 기준이다. |
| `Claude&Playwright-CHAIN.md` | 추가 | 사용자가 제공한 개발 범위와 연결 요구사항. 기존 기능 재사용, 실제 MCP 스키마 확인, 같은 탭 관찰과 Mock 우선 검증을 규정한다. |
| `AI/README.md` | 수정 | 새 MCP 런타임 안내 링크와 검증 상태를 추가하고 저장소 루트 `.env` 설정 위치를 명시한다. |
| `AI/docs/ai_inspection/PLAYWRIGHT_MCP_RUNTIME.md` | 추가 | 연결 구조, 설치 버전, 설정 규격, Mock·Claude 실행 명령, 검증 결과와 남은 제한을 설명하는 상세 운영 문서다. |
| `AI/examples/mcp_fixture.html` | 추가 | 버튼 클릭과 필드 입력 후 Enter 결과를 확인하는 격리된 로컬 검증 화면. 외부 사이트 없이 실제 MCP 동작을 확인한다. |
| `AI/requirements-ai.txt` | 수정 | 공식 Python MCP SDK와 `jsonschema` 의존성을 추가해 실제 세션 연결과 조회된 입력 스키마 검증을 지원한다. |
| `AI/scripts/smoke_playwright_mcp.py` | 추가 | 로컬 fixture 서버·브라우저·MCP를 실행하고 JSON 결과를 보존한다. 기본은 무료 Mock Planner이며 명시적 Claude 모드는 계획 API를 최대 1회 호출한다. |
| `AI/src/ai_inspection/ai_inspector.py` | 수정 | 기존 CLI에 `--runtime-config`, `--analysis-results`, `--mock-plan`을 추가한다. 기존 팩토리 모드를 유지하고 키 누락 시 안전한 안내를 출력한다. |
| `AI/src/ai_inspection/claude_client.py` | 수정 | `MissingAPIKeyError`를 추가해 키 누락을 일반 실행 오류와 구분한다. 기존 Claude 요청·응답 처리와 모델 설정은 유지한다. |
| `AI/src/ai_inspection/env_config.py` | 수정 | `.env` 기준 경로를 AI 모듈 디렉터리에서 저장소 루트로 변경한다. 기존 환경변수 우선권과 키 비출력 방식은 유지한다. |
| `AI/src/ai_inspection/inspection_runtime.py` | 수정 | 행동 기록에 실행 receipt를 저장해 실제 선택 도구를 확인할 수 있도록 한다. 성공·실패·한도 중단 후 실행기 `close()`를 호출하고 정리 실패를 기록한다. |
| `AI/src/ai_inspection/mcp_client.py` | 추가 | stdio MCP 세션 생성·도구 목록 조회·입력 스키마 검증·결과 정규화·타임아웃·종료를 담당한다. API 키를 자식 서버에 전달하지 않고 비동기 네트워크 가드를 실행한다. |
| `AI/src/ai_inspection/playwright_mcp_runtime.py` | 추가 | 로컬 설정을 기존 `RuntimeBinding`에 연결한다. 같은 CDP 탭을 확인하고 click/fill/press를 실제 도구에 바인딩하며 컨트롤·값·DOM 유효성을 검사한다. 분석 제안은 입력 ID와 등록된 문자열이 일치할 때만 검사로 연결한다. |
| `AI/src/ai_inspection/test/test_playwright_mcp_runtime.py` | 추가 | 실제 MCP의 세 동작·관찰 피드백·POST 차단·자원 정리와, 스키마 변경·미등록 값·타임아웃·제안 연결·Mock CLI를 검증한다. |
| `webtestpilot-crawler/DEVELOPMENT.md` | 수정 | 새 연결 구현과 48개 테스트 통과, 상세 문서 위치 및 실제 Claude 검증이 남았다는 개발 상태를 기록한다. 크롤러 코드는 변경하지 않았다. |

## 검증과 AI 팀의 후속 작업

AI·브라우저·실제 MCP를 포함한 테스트 **48개가 모두 통과**했다. Mock 실행은 실제
`browser_click` → `browser_type` → `browser_press_key`를 호출했고 같은 탭의 전후 관찰·이미지와
`passed` 판정을 JSON으로 저장했다. 실제 `.env`와 로컬 실행 산출물은 push하지 않았다.

실제 Claude Planner의 유료 API 호출은 아직 검증하지 않았다. AI 팀은 저장소 루트 `.env`에
`ANTHROPIC_API_KEY`를 설정하고 상세 운영 문서의 Claude smoke 명령으로 최종 통합 검증을 진행한다.
일반 실행의 반복 API 호출 수는 `--max-rounds` 등 제한을 확인해야 한다.
자동 재현·다중 탭·인증 흐름·PDF는 이번 구현 범위에 포함하지 않는다.

## 이 설명 보완 커밋

`docs/CLAUDE_PLAYWRIGHT_CHAIN_HANDOFF.md`를 추가해 기존 구현 커밋의 파일별 역할과 수정 이유,
검증 결과 및 AI 팀의 후속 작업을 한 문서에서 확인할 수 있도록 했다.
