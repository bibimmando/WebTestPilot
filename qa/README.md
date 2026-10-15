# WebTestPilot v2 (`qa/`)

설계: [docs/design/V2_ARCHITECTURE.md](../docs/design/V2_ARCHITECTURE.md). 현재 2단계(spec 생성·결정적 실행·ledger 대조)까지 구현했다.

| 파일 | 단계 |
|---|---|
| `src/explore.ts`, `src/mcp.ts` | ① 탐색·계획 (API 루프 / 개발용 MCP 서버) |
| `src/plan.ts` | 계획 계약 검증·고정 |
| `src/generate.ts` | ② plan → spec 템플릿 (ID만 담는다) |
| `src/fixture.ts` | ③ `start`·`act`·`check` 헬퍼, `ledger.jsonl` 기록 |
| `src/run.ts` | ③ 실행 폴더에 입력·실행 코드 고정 → `playwright test` → 대조 |
| `src/reconcile.ts` | ledger ↔ plan 대조. 상태 재계산, 무효 시나리오 제외, 요구사항별 집계 |

실행 결과는 `runs/<이름>/`에 남는다: `plan.json`, `policy.json`, `src/`(실행한 헬퍼 사본), `specs/`, `manifest.json`(해시·버전), `ledger.jsonl`, `results.json`, `artifacts/`(trace·스크린샷), `report.json`, `playwright.log`.

```powershell
cd qa
npm install
npm test            # 무료 회귀 (브라우저 + 가짜 모델, 유료 API 차단)
npm run typecheck
```

## 개발 중 실행: Claude Code · Codex CLI 구독

탐색 도구를 MCP 서버(`src/mcp.ts`)로 띄우고 CLI가 루프를 돈다. 계획이 검증을 통과하면 `--out` 파일에 저장된다.
이 경로는 루프·모델·비용 한도가 CLI에 있으므로 **결과를 성능 수치로 쓰지 않는다.**

요구사항 파일 (`req.json`):

```json
[{ "id": "R1", "text": "담기를 누르면 장바구니 개수가 1 늘어난다" }]
```

### Claude Code

`mcp.claude.json` (경로는 qa 폴더 기준):

```json
{ "mcpServers": { "qa": { "command": "node",
  "args": ["src/mcp.ts", "--url", "http://localhost:8080/", "--requirements", "req.json", "--out", "runs/plan.json"] } } }
```

```powershell
claude -p (node src/mcp.ts --url http://localhost:8080/ --requirements req.json --print-prompt | Out-String) --model opus --mcp-config mcp.claude.json --strict-mcp-config --allowedTools "mcp__qa"
```

대화형으로 쓸 때는 `claude --mcp-config mcp.claude.json`으로 연 뒤 `/mcp__qa__explore`를 입력한다.

`claude` CLI는 데스크톱 앱과 로그인이 따로다. 처음 한 번 `claude`를 실행해 `/login`으로 로그인해야 한다. (2026-10-15 기준 이 PC의 CLI는 로그인되지 않아 Claude Code 경로는 아직 실제로 돌려보지 않았다.)

### Codex CLI (2026-10-15 확인: 목록·모달 fixture에서 계획 제출까지 동작)

```powershell
$prompt = node src/mcp.ts --url http://localhost:8080/ --requirements req.json --print-prompt | Out-String
$prompt | codex exec -s read-only --skip-git-repo-check `
  -c "mcp_servers.qa.command='node'" `
  -c "mcp_servers.qa.args=['src/mcp.ts','--url','http://localhost:8080/','--requirements','req.json','--out','runs/plan.json']" `
  -c "mcp_servers.qa.default_tools_approval_mode='approve'" -
```

- `default_tools_approval_mode='approve'`가 없으면 비대화형 실행에서 MCP 도구 호출이 모두 거부된다. 이 서버만 자동 승인하며, 쓰기 요청·외부 origin은 서버가 막는다.
- Windows PowerShell 5.1은 외부 프로그램 인자 안의 큰따옴표를 지우므로, TOML 문자열은 작은따옴표로 쓴다.
- Codex는 GPT 계열 모델이다. Claude API 결과와 섞어 비교하지 않는다.

## 테스트·평가 실행: Claude API

완성 후에는 `explore()`가 Anthropic API로 직접 루프를 돈다. 호출마다 비용을 예약하고 실제 usage로 정산한다. 모델은 계획 Opus 5.5, 실행 단계 AI(`custom`·분류) Sonnet 5.5가 기본이고, 비용이 크면 각각 한 단계 내린다 (Sonnet 5.5 · Haiku 5.5). CLI 진입점은 2단계에서 만든다.
