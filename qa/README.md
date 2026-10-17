# WebTestPilot v2 (`qa/`)

URL만 주면 사이트를 스스로 탐색해 기능을 찾고, 검사 계획을 세워 실행한 뒤 결함 후보를 판정하고 보고서(JSON·PDF)를 만드는 QA 도구다. 요구사항은 선택 입력이다(주면 그 검사를 먼저 하고 나머지도 탐색한다).

- 설계: [docs/design/V2_ARCHITECTURE.md](../docs/design/V2_ARCHITECTURE.md)
- 작업 기록: [docs/HANDOFF.md](../docs/HANDOFF.md)

## 흐름

```
사이트 지도(같은 origin 링크 수집, 페이지 종류로 묶기)
 → 페이지 종류마다 AI 탐색·계획(Opus) → plan.json 고정
 → 결정적 실행(Playwright Test, AI 없음) → 기록(ledger) 대조
 → 1차 분류(코드) → 애매한 실패만 AI 분류(Sonnet) → 결함 후보 1회 재실행
 → 시스템 판정(버그 확신 높음·중간 / 판단 보류 / 미완료 / 버그 아님)
 → report.json · report.html · report.pdf
```

- AI는 탐색·계획과 애매한 실패의 분류에만 쓴다. 실행·대조·재현·판정·보고서는 코드가 한다.
- 기대값은 계획을 낼 때 고정한다. 탐색 때 본 값을 그대로 정답으로 쓰지 못하게 계약이 막는다.
- 쓰기 요청(POST 등)과 허용 origin 밖 요청은 기본으로 막는다.

## 설치

Playwright는 저장소 루트에, 나머지 의존성은 `qa/`에 설치한다.

```powershell
npm install                       # 저장소 루트: @playwright/test
npx playwright install chromium   # 처음 한 번
cd qa
npm install
```

Anthropic API 키는 환경변수 `ANTHROPIC_API_KEY`, 또는 저장소 루트 `.env`에 둔다(커밋하지 않는다).

```
ANTHROPIC_API_KEY=sk-ant-...
```

## 실행 (Claude API)

```powershell
cd qa
node src/cli.ts --url http://localhost:8080/
```

- 기본 예산은 $10이다. 그중 30%는 분류·재현 몫으로 남기고, 탐색은 40분이 지나면 새 대화를 시작하지 않는다.
- 결과 폴더는 `runs/<name>-<시각>/`이고, 끝나면 경로와 비용을 출력한다.

요구사항을 줄 때(선택):

```json
[{ "id": "R1", "text": "담기를 누르면 장바구니 개수가 1 늘어난다" }]
```

```powershell
node src/cli.ts --url http://localhost:8080/ --requirements req.json --name shop
```

### 주요 옵션

| 옵션 | 기본값 | 뜻 |
|---|---|---|
| `--url` | (필수) | 시작 URL |
| `--requirements` | 없음 | 요구사항 JSON 파일 |
| `--budget` | 10 | 비용 상한(USD, 토큰 사용량 기준 추정) |
| `--explore-minutes` | 40 | 이 시간이 지나면 새 탐색 대화를 시작하지 않음 |
| `--name` | live | 결과 폴더 이름 앞부분 |
| `--origins` | 시작 URL의 origin | 허용 origin(쉼표로 여러 개) |
| `--allow-writes` | 끔 | 쓰기 요청 허용. 켜면 실행 워커는 1로 고정 |
| `--max-pages` | 30 | 사이트 지도에서 방문할 페이지 수 |
| `--max-templates` | 8 | 탐색할 페이지 종류 수 |
| `--turns-per-template` | 25 | 페이지 종류마다 대화 턴 수 |
| `--pages-per-template` | 3 | 같은 종류에서 계획을 실행할 페이지 수(대표 포함) |
| `--concurrency` | 1 | 동시에 여는 탐색·분류 대화 수 |
| `--workers` | 1 | 동시에 실행할 시나리오 수 |
| `--plan-model` / `--triage-model` | Opus 5.5 / Sonnet 5.5 | 계획·분류 모델 |

## 결과 보기

`runs/<이름>/` 안:

| 파일 | 내용 |
|---|---|
| `report.pdf` · `report.html` | 사람이 읽는 보고서. 실행 범위와 범위 밖, 버그·보류·질문·관찰·오류 신호·미완료, 항목마다 기대/실제·근거·재현 절차·실패 시점 화면 |
| `report.json` | 보고서의 사실 원본(report/1) |
| `plan.json` | 고정된 계획(기능 F#, 시나리오, 대상, 질문, 관찰) |
| `explore.json` | 사이트 지도, 페이지 종류별 대화 결과 |
| `run/` | 실행 기록(`ledger.jsonl`·`results.json`), 판정(`verdicts.json`), 증거(`evidence/`), trace(`artifacts/`) |
| `repro/` | 결함 후보 재실행 |
| `summary.json` · `calls.json` | 비용·시간·모델 호출 |

보고서만 다시 만들기(새 검사 없음):

```powershell
node src/report.ts runs/<이름>
```

## 개발

```powershell
npm test            # 무료 회귀(브라우저 + 가짜 모델, 유료 API 호출 없음)
npm run typecheck
```

| 파일 | 역할 |
|---|---|
| `src/cli.ts` | 처음부터 끝까지 실행 |
| `src/sitemap.ts` | 사이트 지도·페이지 종류 묶기 |
| `src/explore.ts`, `prompts/explore.md` | 탐색 도구·프롬프트, 페이지 종류별 대화(큐·동시 실행·재시도), 계획 합치기·다른 페이지 복제 |
| `src/rules.ts` | 일반 규칙 목록(근거로 인용하는 규칙 ID) |
| `src/plan.ts` | 계획 계약 검증·고정, 비교 연산 |
| `src/browser.ts` | snapshot, 대상 고정, 화면 안정 대기, 정책(쓰기·origin 차단) |
| `src/generate.ts` · `src/fixture.ts` · `src/run.ts` | plan → spec, 실행 헬퍼(전후 증거·오류 신호), Playwright Test 실행 |
| `src/reconcile.ts` | 기록 ↔ 계획 대조(상태 재계산, 무효 시나리오) |
| `src/triage.ts`, `prompts/triage.md` | 1차·AI 분류, 재현, 시스템 판정 |
| `src/report.ts` | report.json·HTML·PDF |
| `src/agent.ts` | 비용 예약·정산이 있는 모델 호출 루프 |
| `src/mcp.ts` | 같은 탐색 도구를 MCP 서버로 노출(개발용) |
| `test/fixtures/` | 개발 fixture(쇼핑 목록·상세, 사내 게시판). 결함 변형·정답표는 `../eval/variants/` |

### 구독 CLI로 탐색만 돌려 보기 (개발용, 성능 수치로 쓰지 않음)

탐색 도구를 MCP 서버로 띄우고 Codex·Claude Code가 탐색·계획을 한다. 계획이 검증을 통과하면 `--out` 파일에 저장된다.

```powershell
$prompt = node src/mcp.ts --url http://localhost:8080/ --print-prompt | Out-String
$prompt | codex exec -s read-only --skip-git-repo-check `
  -c "mcp_servers.qa.command='node'" `
  -c "mcp_servers.qa.args=['src/mcp.ts','--url','http://localhost:8080/','--out','runs/plan.json']" `
  -c "mcp_servers.qa.default_tools_approval_mode='approve'" -
```

- `default_tools_approval_mode='approve'`가 없으면 비대화형 실행에서 도구 호출이 거부된다.
- Windows PowerShell 5.1에서는 TOML 문자열을 작은따옴표로 쓴다.

## 지금 하지 않는 것

다음은 결과에 "범위 밖"으로 표시된다.

- 로그인 이후 기능
- 서버에 저장되는 흐름(쓰기 차단)
- 초기화 뒤 재현
- 모바일 화면
- 시각 판정(겹침·넘침)
- 품질·사용성 규칙
- 보고서 요약 문장(AI)
- 웹 화면

개발 fixture와 Maison 결과는 개발 사례이며 일반화 성능 근거가 아니다(독립 앱 평가는 아직 없음).
