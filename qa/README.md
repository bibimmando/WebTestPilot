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
| `--app` | 없음 | 앱 설정 JSON: 로그인 절차와 요청하지 않을 주소(아래) |
| `--max-pages` | 30 | 사이트 지도에서 방문할 페이지 수 |
| `--max-templates` | 8 | 탐색할 페이지 종류 수 |
| `--turns-per-template` | 25 | 페이지 종류마다 대화 턴 수 |
| `--pages-per-template` | 3 | 같은 종류에서 계획을 실행할 페이지 수(대표 포함) |
| `--concurrency` | 1 | 동시에 여는 탐색·분류 대화 수 |
| `--workers` | 1 | 동시에 실행할 시나리오 수 |
| `--plan-model` / `--triage-model` | Opus 5.5 / Sonnet 5.5 | 계획·분류 모델 |

### 로그인이 필요한 앱 (`--app`)

로그인 절차는 엔진 코드가 아니라 앱 설정 파일에 적는다. 비밀값은 파일에 쓰지 않고 환경 변수 이름만 적는다.

```json
{
  "login": {
    "url": "http://localhost:8080/login",
    "username": { "role": "textbox", "name": "^아이디$" },
    "password": { "role": "textbox", "name": "^비밀번호$" },
    "submit": { "role": "button", "name": "^로그인$" },
    "success": { "text": "로그아웃", "urlIncludes": "/account" },
    "env": { "username": "QA_USER", "password": "QA_PASS" }
  },
  "deny": ["/logout"],
  "reset": {
    "request": { "method": "POST", "url": "http://localhost:8080/test/reset" },
    "verify": { "url": "http://localhost:8080/api/cart", "text": "\"items\":[]" }
  }
}
```

- 프로그램이 로그인해 브라우저 상태를 만들고, 사이트 지도·탐색·실행·재현이 그 상태로 시작한다. 모델은 로그인 비밀값(아이디·비밀번호)을 보지 않는다. 단 로그인 뒤 화면에 보이는 내용(계정 정보·토큰 등)은 탐색 모델과 탐색 기록에 그대로 간다. 실제 사용자 계정이 아니라 테스트 계정을 쓴다.
- `deny`의 주소는 요청하지 않는다. 로그아웃처럼 서버 세션을 끊는 주소를 적는다(누르려 하면 "앱 설정이 금지한 행동"으로 남는다).
- 비밀번호 칸은 증거 스크린샷에서 가린다. 로그인 상태(세션 쿠키)는 실행 폴더에 저장하지 않고, 로그인 실행에서는 Playwright trace·자동 스크린샷을 끈다(가리지 않은 DOM·요청 기록이 남기 때문). 계정 비밀값 환경 변수는 실행 프로세스에 넘기지 않는다.
- 로그인에 실패하면 멈추지 않고 로그인 없이 검사하며, 보고서에 "로그인 이후 기능 미검사"와 사유를 남긴다.
- 구독 CLI(MCP)로 돌릴 때도 `src/mcp.ts`에 같은 `--app`을 준다.
- `reset`은 등록된 초기화다. 프로그램이 실행 전과 재현 전에 한 번씩 보내고, `verify`로 초기 상태인지 확인한다(로그인했으면 그 쿠키로). AI는 부르지 않는다. 쓰기 허용 실행에 `reset`이 없으면 재현은 "판단 불가(초기화 불가)"다. 쓰기를 막은 실행은 초기화 없이 재현한다.

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

- 앱 설정 없는 로그인(외부 인증·2단계 인증·캡차 포함)
- 서버에 저장되는 흐름(쓰기 차단이 기본, 등록된 초기화 없음)
- 초기화 뒤 재현
- 터치 전용 동작(화면 크기만 바꾼다)
- iframe·shadow DOM 안
- 보고서 요약 문장(AI)
- 웹 화면

개발 fixture와 Maison 결과는 개발 사례이며 일반화 성능 근거가 아니다(독립 앱 평가는 아직 없음).
