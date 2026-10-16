# WebTestPilot AI 검사기: 팀 공유용

> Git share: use [REPRODUCE.md](../../REPRODUCE.md) for current setup and [shared evidence](../../reports/maison_2026-10-16/README.md) for results. Historical local workspace paths below are development records.

기준일: 2026-10-09. 프로젝트 방향성에 맞춘 AI 검사기의 역할과 현재 상태를 공유합니다.
코드·응답 규격·연결 객체·오류 처리는 [개발 상세 문서](AI_ANALYSIS_IMPLEMENTATION.md)에 있습니다.

## 1. 팀 입력은 JSONL을 유지합니다

크롤러의 hybrid_ai_input.jsonl과 기존 webtestpilot.hybrid-ai-input.v1 규격을 사용합니다.
필수 schema·input_id·kind·url·payload는 변경하지 않았습니다.
원본 파일을 수정하지 않고 input_id로 분석·실행·증거·판정을 연결합니다.
`ambiguous_interaction`도 지원하며 행동 전후 결과가 불명확한 항목으로 증거를 검토합니다. 화면 변화가 없다는 사실만으로 버그로 확정하지 않습니다.

AI 내부에서는 사이트 공통 문맥·현재 페이지 관찰·현재 검사 흐름으로 정리합니다.
없는 문맥이나 업무 규칙을 임의로 채우지 않습니다. 추가 문맥은 AI 측 선택 확장이며
전처리팀에 새로운 필수 필드를 요구하는 규격 변경은 아닙니다.

## 2. 현재 구현 상태

| 기능 | 상태 |
|---|---|
| JSONL 읽기·검증·AI 요청 준비 | 사용 가능 |
| Claude 증거 분석·설명형 검사 계획 | CLI 연결, 실제 증거 분석 1건 성공 확인; 설명형 계획은 모의 검증 |
| 구조화된 행동 선택·반복 실행 관리자 | 추가, 주입된 모델·실행기로 검증 |
| MCP 도구 호출 어댑터 | 추가, 모의 MCP 세션 검증 |
| 기존 탭 관찰·현재 화면 촬영 | 추가, 로컬 브라우저 검증 |
| 등록된 기대 조건 비교 | 텍스트 포함·URL 일치 지원 |
| 실제 MCP 접속·공통 탭 연결 | 단일 Chromium CDP 탭 연결 구현, 로컬 실제 MCP 검증; 전처리 CDP 제공은 팀 통합 필요 |
| 자동 추가 재현·초기화·로그인 연계 | 후속 작업 |
| 시각적 UI·모바일 자동 검사 | 후속 작업 |
| 단일 PDF·재생성·웹 화면 | 후속 작업 |

**실제 Claude와 Playwright MCP 서버를 연결한 전체 검사를 완료한 상태는 아닙니다.**
실제 MCP 행동·전후 증거·판정은 로컬 페이지에서 검증했습니다. Claude 행동 선택은 모의 응답으로 검증했습니다.

### 현재 --analyze에서 실제로 하는 일

```text
크롤러가 사이트 탐색·행동·증거 수집
 → JSONL 저장
 → AI가 저장된 증거 분석 또는 검사 계획 제안
 → 분석 결과·추가 확인 사항 저장
```

증거 수집의 주체는 크롤러입니다. AI는 --analyze 실행 중 사이트에 접속하거나 새 증거를 수집하지 않습니다.
AI가 제안한 추가 검사를 자동 실행하지 않으며, 현재 단계는 기존 증거 분석·추가 검사 제안까지입니다.
semantic_test_planning 항목은 검사 계획 제안이고, 오류·불명확한 행동 항목은 이미 수집된 증거 검토입니다.

2026-10-09 Maison 위시리스트 클릭 실패 항목 1개를 실제 Claude로 분석했습니다.
완료 1개·오류 0개, 입력 598·출력 631토큰을 확인했습니다.
응답은 클릭 실패의 가능한 설명과 추가 확인 사항이며 버그 확정·실제 추가 실행·재현 성공을 뜻하지 않습니다.
결과 위치: 결과파일/ai_inspection/maison/hybrid_analysis/ai_results.jsonl.

## 3. 실행 구조

아래는 실행 관리자에 연결 객체를 주입하는 확장 경로입니다. 현재 --analyze의 동작과 구분합니다.

```text
팀 JSONL → 입력 검증·문맥 정리 → 준비된 공통 탭 관찰
 → AI가 등록된 검사·행동 선택 → 프로그램이 요소·권한·한도 확인
 → MCP 도구 실행 → 행동 전후 관찰·증거 → 기대 근거와 실제 결과 비교
 → 새 관찰·행동 기록으로 다음 검사 → 실행 결과 JSON
```

계획만으로 실행·통과를 선언하지 않습니다.
현재 실행 모드는 등록된 검사 카탈로그 안에서 행동을 선택하며 자유로운 기능 발견·검사 생성은 추가 확장이 필요합니다.
추가 재현은 아직 하지 않으므로 근거 있는 불일치도 재현 전 후보로 표시합니다.

| 판정 | 의미 |
|---|---|
| passed | 실제 수행한 검사가 근거 있는 기대 조건을 만족 |
| candidate | 근거 있는 기대 조건과 불일치, 추가 재현 전 |
| review_required | 기대 근거가 불명확하거나 AI 추정뿐임 |
| incomplete | 관찰 부족·실행 미완료 |

## 4. 팀 연결 역할

- 전처리: JSONL, 브라우저·탭 수명주기, 관찰·요소 매핑·증거 기반.
- AI: 모델 호출, MCP 어댑터, 검사 선택·실행 관리·판정·결과 기록, 이후 재현·보고서.
- 테스트/벤치마크: 기대 근거, 계정·데이터·초기 상태, 정답·독립 평가.

전처리·AI가 공통 탭의 CDP 주소, 검토된 요소 ID·선택자, 기대 조건, 행동 허용 정책을 맞춰야 합니다.
JSONL만으로 브라우저 세션을 공유할 수는 없습니다. 전처리는 Chromium 브라우저를 열어 둔 상태로 CDP 연결을 제공해야 합니다.
현재 전처리의 일반 launch 실행은 이 연결을 자동 제공하지 않습니다. 전처리 원본은 수정하지 않았습니다.
웹 UI·배포 담당은 이번 변경에서 정하지 않았습니다.

## 5. 사용 방법

프로젝트 루트 PowerShell 기준입니다.

요청 준비(API 키·과금·브라우저 실행 없음):

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector --hybrid-input "결과파일\ex_crawler\crawl-results\hybrid_ai_input.jsonl" --prepare-only --limit 1 --output-dir "결과파일\ai_inspection\hybrid_prepare"
```

증거 분석(유료 API 호출, 루트 .env에 키 설정 필요):

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector --hybrid-input "결과파일\ex_crawler\crawl-results\hybrid_ai_input.jsonl" --analyze --limit 1 --output-dir "결과파일\ai_inspection\hybrid_analysis"
```

새 --execute 모드는 --mcp-config 설정.json으로 내장 Playwright MCP 연결부를 사용하거나,
--runtime-factory module:function으로 팀의 별도 연결부를 사용할 수 있습니다. 두 옵션 중 하나만 지정합니다.
설정 JSON·CDP 준비 조건·명령은 [상세 문서 12번](AI_ANALYSIS_IMPLEMENTATION.md#12-실제-playwright-mcp-연결)에 있습니다.
실행 계약·예시는 개발 상세 문서에 있습니다. 세 모드는 동시에 선택할 수 없습니다.

모듈 실행 대신 파일을 직접 실행해도 됩니다. 프로젝트 루트에서 아래처럼 실행합니다(유료 분석).

```powershell
.\.venv\Scripts\python.exe .\src\ai_inspection\ai_inspector.py --hybrid-input "결과파일\ex_crawler\maison\crawl-results\hybrid_ai_input.jsonl" --analyze --limit 1 --output-dir "결과파일\ai_inspection\maison\hybrid_analysis"
```

입력·출력 상대 경로는 터미널의 현재 디렉토리를 기준으로 해석합니다. 출력 폴더는 자동 생성됩니다.

## 6. 결과와 보고서

### 현재 Maison 분석 폴더의 세 파일

현재 분석 결과 폴더는 `결과파일/ai_inspection/maison/hybrid_analysis/`입니다.
JSON은 파일 전체가 하나의 객체이고, JSONL은 한 줄마다 별도 항목의 JSON 객체가 저장된 형식입니다.

| 파일 | 무엇을 담는가 | 언제 확인하는가 |
|---|---|---|
| `evidence_batch.json` | 이번 실행의 선택·처리·성공·오류 수, 모델 설정, 반환 토큰 합계, 항목별 결과 요약 | 실행이 성공했는지 먼저 확인할 때 |
| `ai_results.jsonl` | 각 입력에 대한 AI 분석 또는 실패 기록. 증거 요약·가능한 설명·추가 검사 제안 포함 | AI가 실제로 무엇이라고 답했는지 읽을 때 |
| `ai_requests.jsonl` | 각 입력을 AI 분석용으로 구성한 요청. 시스템 지침·작업 목적·원본 증거·응답 규격 포함 | AI에게 어떤 자료와 질문을 전달하도록 구성했는지 확인할 때 |

**읽는 순서는 evidence_batch.json → ai_results.jsonl → 필요 시 ai_requests.jsonl을 권장합니다.**

#### evidence_batch.json: 실행 전체의 요약

`total_records`는 입력 파일 전체 항목 수, `selected_count`는 --limit로 선택한 수,
`processed_count`는 처리한 수입니다. 따라서 선택한 1개가 성공했다고 전체 입력을 분석한 것은 아닙니다.
`completed_count`가 분석 완료 수이고 `error_count`가 분석 오류 수입니다.
`analyzer_calls`는 분석기 호출 시도 수이며 사이트에서 실행한 검사 수가 아닙니다.
`token_totals`는 API가 반환한 토큰 사용량 합계입니다. 비용 금액이나 버그 수는 아닙니다.

#### ai_results.jsonl: AI 답변과 항목별 실패 기록

`input_id`로 원본 JSONL의 같은 항목을 찾을 수 있습니다. `line_number`는 원본 파일의 실제 줄 번호입니다.
`kind`는 입력 작업 종류이고 `work_type`은 증거 검토(evidence_review) 또는 검사 계획(test_planning)입니다.

증거 검토의 `analysis`에는 다음 내용이 있습니다.

- `evidence_summary`: 수집된 증거를 AI가 요약한 설명.
- `possible_explanations`: 가능한 원인에 대한 가설. 실제 원인이 확인됐다는 뜻은 아닙니다.
- `needs_additional_verification`: 추가 확인이 필요한지 여부.
- `suggested_checks`: 추가로 확인해볼 항목. 아직 수행한 검사 기록이 아닙니다.

검사 계획 항목에는 `page_summary`, `proposed_checks`, `open_questions`가 있습니다.
각각 페이지 기능 요약, 제안 검사, 기대 동작 등 확인할 질문입니다.
실패 항목에는 정상 분석 대신 `error_type`, `error_code`, `http_status` 등의 오류 정보가 남습니다.

#### ai_requests.jsonl: AI 요청 준비 기록

`system`은 프로그램이 정한 분석 지침, `task`는 작업 목적, `evidence`는 원본 URL·이유·payload,
`response_contract`는 답변에 요구한 필드와 타입입니다.
이 파일은 준비 모드에서도 생성되므로 **파일이 존재한다는 것만으로 실제 API 호출을 증명하지 않습니다.**
API의 HTTP 요청 원문이나 모델 응답 파일도 아닙니다.

### 입력·실행·증거 파일의 구분

| 파일 | 생성 주체와 역할 |
|---|---|
| `hybrid_ai_input.jsonl` | 크롤러가 만든 입력. 페이지·행동·오류 등 기존 증거를 AI에 전달 |
| `inspection_results.jsonl` | --execute 경로의 항목별 계획·실제 행동·전후 관찰·판정·종료 사유 |
| `inspection_run.json` | --execute 경로의 전체 실행 요약·사용량·미처리 입력 목록 |
| `evidence_<식별자>.png` | 공통 탭 관찰기가 저장한 현재 화면 이미지. 위 실행 결과의 증거 참조로 연결 |
| `verification.json`, `before.png`, `after.png` | 기존 독립 실행기를 별도로 호출했을 때의 제한 행동 기록과 실행 전후 이미지 |

뒤의 실행·이미지 파일은 현재 --analyze에서 생성하지 않습니다.
현재 --execute 결과에도 자동 재현·PDF는 없으며 reproduction_status는 not_attempted, report_status는 not_generated입니다.
각 파일의 필드별 상세 설명과 연결 예시는 [개발 상세 문서의 8번](AI_ANALYSIS_IMPLEMENTATION.md#8-결과-저장)에 있습니다.

analysis_status: completed는 AI 응답 검증 완료이지 사이트 정상 판정이 아닙니다.
실행 완료와 검사 통과도 구분합니다. 권한 거절·한도·도구 오류로 중단된 흐름은 미완료입니다.
모델·도구 호출 사이에서 한도와 중지를 확인하며 진행 중 도구 호출 취소는 연결부에서 처리해야 합니다.

## 7. 테스트와 다음 목표

테스트는 src/ai_inspection/test/에 있으며 실제 API를 호출하지 않습니다.
실행 기반 확장 시 로컬 브라우저 포함 AI 테스트 39개, 기존 전처리 포함 전체 51개가 통과했습니다.
MCP 구현 시 AI 테스트 43개가 로컬 브라우저·실제 MCP를 활성화한 실행에서 모두 통과했습니다.
전달 파일 테스트 4개를 추가한 현재 기본 실행은 47개 중 43개 통과·선택 테스트 4개 건너뜀입니다.
실제 MCP의 fill·press·click, 같은 탭 확인, 권한 거절, 전후 이미지·텍스트, 판정·JSON 저장과 연결 종료 후 브라우저 유지까지 확인했습니다.
유료 모델은 호출하지 않았습니다. 기본 실행에서는 브라우저 3개와 실제 MCP 1개를 건너뜁니다.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection/test -t . -v
```

로컬 브라우저 테스트 포함:

```powershell
$env:WEBTESTPILOT_BROWSER_TESTS = "1"
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection/test -t . -v
Remove-Item Env:WEBTESTPILOT_BROWSER_TESTS
```

실제 MCP 테스트에는 Node.js와 Chrome 또는 Edge가 필요합니다. 최초 서버 설치 후 실행합니다.

```powershell
npm.cmd install --prefix tmp/playwright_mcp @playwright/mcp@0.0.83
$env:WEBTESTPILOT_BROWSER_TESTS = "1"
$env:WEBTESTPILOT_MCP_TESTS = "1"
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection/test -t . -v
Remove-Item Env:WEBTESTPILOT_BROWSER_TESTS
Remove-Item Env:WEBTESTPILOT_MCP_TESTS
```

다음 목표는 전처리의 CDP 제공과 요소·검사 카탈로그를 연결해 실제 Claude로 짧은 사례 하나를 수행하는 것입니다.
이후 초기 상태 복원·추가 1회 재현 → 최초 발견·재현 결과 통합 → 단일 PDF·재생성 순으로 진행합니다.

## 8. 전처리팀 전달용 실행 계획

팀 합의에 따라 전처리팀은 기능의 정상 여부가 아니라 **계획한 행동이 제대로 수행됐는지**를 확인하고 전후 증거를 반환합니다.
기대 동작·기능 판정 기준은 AI 측에서 별도 관리하며 전달 파일에는 포함하지 않습니다.

| 파일 | 역할 |
|---|---|
| ai_results.jsonl | 기존 분석·suggested_checks 또는 proposed_checks, 원본 유지 |
| execution_plans.jsonl | 별도 전달 파일. 한 줄에 제안 1개, 대상 URL·시작 조건·행동·수집 요청 |
| execution_handoff.json | 초안 수·준비된 항목 수·분석 미완료로 제외된 항목 집계 |
| execution_results.jsonl | 전처리팀 반환용 권장 파일명. 생성·수신 연결은 아직 미구현 |

새 `execution_handoff` 명령은 API·MCP를 호출하지 않는 오프라인 변환입니다.
설명형 제안만으로 요소·입력값·시작 상태를 추측하지 않습니다. 최초 출력은 `needs_information`이고 행동 목록은 비어 있습니다.
사람이 검토한 JSONL을 `--reviewed-plans`로 추가하면 해당 계획만 `ready_for_handoff`로 바뀝니다.
이는 전달 준비 상태이며 실행 권한·초기 상태 복원·동작 성공이 검증됐다는 뜻은 아닙니다.
전처리는 ready 항목만 정책·요소·시작 조건을 확인한 뒤 실행하며, 나머지는 필요한 정보를 확인합니다.
문서 검토처럼 자동 실행이 불가능한 제안을 억지로 click/fill/press로 바꾸지 않습니다.

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.execution_handoff --hybrid-input "결과파일\ex_crawler\maison\crawl-results\hybrid_ai_input.jsonl" --ai-results "결과파일\ai_inspection\maison\hybrid_analysis\ai_results.jsonl" --output-dir "결과파일\ai_inspection\maison\execution_handoff"
```

2026-10-09 저장된 Maison 분석 5건에서 33개 초안을 생성했습니다. 준비 완료 0개·정보 확인 필요 33개입니다.
실제 행동·AI 추가 호출은 하지 않았습니다. 생성 성공을 실행 가능한 계획 33건 확보로 해석하면 안 됩니다.
반환 결과는 plan_id와 source_input_id를 유지하고 행동별 완료·실패·확인 불가, 시작 조건 준비 여부, 오류, 전후 증거를 구분합니다.
화면 변화가 없다는 사실만으로 행동 실패를 선언하지 않습니다. 상세 규격·검토 입력 예시는 [상세 문서 13번](AI_ANALYSIS_IMPLEMENTATION.md#13-전처리팀-실행-계획-전달)에 있습니다.

## 9. 개발 코드 위치 정리 (2026-10-13)

실제 구현은 src/ai_inspection의 analysis/·execution/·handoff/·providers/로 정리했습니다.
기존 루트 파일은 import·터미널 명령 호환용입니다. 기존 테스트 위치와 입력·출력 규격은 유지합니다.
judgment/는 독립 판정 모듈이며 합성 예시·모의 모델로 입출력 연결을 구현했습니다. 실제 통합은 후속입니다.
[파일 구성 설명](../../src/ai_inspection/README.md)을 참고하세요.

## 10. 전처리팀 계약 기반 판정 모듈 (2026-10-13)

judge_input/2 입력·전후 증거 조회·독립 판정 요청·실제 이미지 첨부·scenario_judgments 응답 검증을 구현했습니다.
판정은 passed/candidate/inconclusive이며 MCP 추가 행동·재현·confirmed·보고서는 담당하지 않습니다.
제공된 4개 합성 사례의 응답을 모의 검증했고 실제 모델의 판단 성능은 아직 평가하지 않았습니다.
새 테스트 7개를 포함한 기본 AI 테스트는 54개 중 50개 통과·선택 테스트 4개 건너뜀입니다.
기존 통합 프로그램의 모델 전송·한도·취소·tool_use ID 관리를 유지하는 연결 어댑터를 별도 worktree에 구현했습니다.
모의 모델·실제 localhost MCP로 판정·재현·report.json 연결을 확인했습니다. 현재 테스트 기록과 실행법은 아래 입문 문서에 있습니다.
[판정 모듈 상세·명령·출력](AI_JUDGMENT_MODULE.md)을 참고하세요.

## 11. 처음 보는 개발자를 위한 읽기 순서

먼저 [전체 파이프라인 안내](PROJECT_PIPELINE_GUIDE.md)를 읽으세요.
전체 역할·행동 수행과 기능 판정의 차이·소스 원본과 통합 worktree·산출물 읽는 순서·테스트·현재 한계를 설명합니다.
그다음 AI_JUDGMENT_MODULE.md와 전처리팀 JUDGMENT_CONTRACT.md를 참고합니다.
기존 hybrid JSONL 분석·전달 초안은 별도 경로이며 지금 주 연결은 실행 후 judge_input/2 판정입니다.
