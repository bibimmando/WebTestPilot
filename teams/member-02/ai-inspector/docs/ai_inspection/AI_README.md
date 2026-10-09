# WebTestPilot AI 검사기: 팀 공유용

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
| 실제 MCP 접속·전처리 탭 연결 | 연결부 구현 필요 |
| 자동 추가 재현·초기화·로그인 연계 | 후속 작업 |
| 시각적 UI·모바일 자동 검사 | 후속 작업 |
| 단일 PDF·재생성·웹 화면 | 후속 작업 |

**실제 Claude와 Playwright MCP 서버를 연결한 전체 검사를 완료한 상태는 아닙니다.**
기존 분석 코드 위에 실제 실행을 연결할 관리 구조를 추가한 단계입니다.

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

전처리·AI가 공통 탭 연결, 요소 ID와 MCP 참조의 매핑, 행동 허용 정책을 맞춰야 합니다.
JSONL만으로 브라우저 세션을 공유할 수는 없습니다. 실행 모드는 팀 연결 모듈이 준비된 탭을 제공해야 합니다.
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

새 --execute 모드는 --runtime-factory module:function으로 실제 공통 탭·MCP 세션을 제공해야 합니다.
현재 저장소에는 실서비스 연결 모듈이 없으며 다음 통합 작업에서 구현합니다.
실행 계약·예시는 개발 상세 문서에 있습니다. 세 모드는 동시에 선택할 수 없습니다.

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
2026-10-09 기준 로컬 브라우저 포함 AI 테스트 39개, 기존 전처리 포함 전체 51개가 통과했습니다.
실제 탭의 클릭·관찰·판정 연결도 검증했지만 모델과 MCP 서버 호출은 모의 처리했습니다.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection/test -t . -v
```

로컬 브라우저 테스트 포함:

```powershell
$env:WEBTESTPILOT_BROWSER_TESTS = "1"
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection/test -t . -v
Remove-Item Env:WEBTESTPILOT_BROWSER_TESTS
```

다음 목표는 실제 공통 탭에서 짧은 사례 하나의 행동·관찰·판정을 JSON까지 연결하고,
그 기록을 이용한 추가 1회 재현을 구현하는 것입니다. 이후 범위 확대와 단일 PDF를 연결합니다.
