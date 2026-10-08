# WebTestPilot AI 검사기

이 문서는 2팀의 **AI 검사기·리포트 목표**와 **현재 사용할 수 있는 기능**을 구분해 설명합니다.

> 현재 CLI는 **API 없는 요청 준비**와 **유료 Claude 증거 분석·검사 계획 생성**을 지원합니다.
> 실제 서비스 호출은 아직 검증하지 않았습니다. 자동 추가 검증과 최종 판정·리포트는 미연결입니다.

팀원용 구조·변경 사항·오류와 토큰 기록의 상세 설명은
[AI_ANALYSIS_IMPLEMENTATION.md](AI_ANALYSIS_IMPLEMENTATION.md)를 참고하세요.

## 1. 검사기의 목표 흐름

1팀은 크롤링과 전처리를 담당합니다. 2팀은 수집된 증거를 활용해 AI 검토와 필요한 추가 검증을 수행하고 결과를 사용자에게 전달하는 것을 목표로 합니다.

~~~text
1팀: 크롤링·전처리
        ↓
hybrid_ai_input.jsonl
        ↓
2팀: 입력 검증·작업 분류·AI 요청 준비
        ↓
AI 증거 검토 / 추가 검사 계획 생성
        ↓
추가 증거가 필요한가?
  ├─ 아니오 → 기존 증거로 결과 정리
  └─ 예     → 계획·권한 검증 → Playwright 실행 → 추가 증거 수집
        ↓
기대 동작과 증거에 근거한 판정·결과 종합
        ↓
사용자용 리포트
~~~

위 흐름은 **목표 설계**이며 모든 단계가 연결되어 있지는 않습니다.

- 전처리의 관찰·행동 증거를 재사용하고 모든 페이지를 다시 탐색하지 않습니다.
- AI 검토 대상으로 선정됐다는 이유만으로 버그라고 판단하지 않습니다.
- 도구 실행 실패, 정상 동작, 사이트 문제 가능성, 증거 부족을 구분해야 합니다.
- 추가 실행은 검토된 계획과 허용된 환경에서만 수행합니다.
- 기대 동작을 모르면 단정하지 않고 추가 확인이 필요한 항목으로 남깁니다.
- 원본 input_id로 입력부터 최종 결과까지 연결합니다.

판정 기준과 기대 동작은 테스트 페이지·벤치마크 담당 3팀과 합의해야 합니다.
AI의 설명만으로 버그가 확정되는 구조를 목표로 하지 않습니다.

## 2. 현재 구현 상태

| 단계 | 현재 상태 | 설명 |
|---|---|---|
| JSONL 읽기·검증 | CLI 연결 완료 | 버전·필수 필드·URL·중복 ID·작업 종류 검증 |
| 작업 분류·AI 요청 준비 | CLI 연결 완료 | 종류별 목적과 응답 규약을 만들고 파일로 저장 |
| Claude API 통신 | 분석 CLI 연결 완료 | 모의 API로 검증. 실제 계정·응답 품질은 미검증 |
| AI 응답 검증·결과 저장 | 분석 CLI 연결 완료 | 오류와 반환된 토큰 기록 포함. 최종 버그 판정은 아님 |
| Playwright 추가 검증 | 독립 실행 기반 있음 | 로컬 브라우저로 검증. JSONL·AI 흐름과 미연결 |
| 설명형 계획 → 실행 단계 변환 | 미구현 | AI 제안을 자동 실행하지 않음 |
| 최종 버그 판정·사용자용 리포트 | 미구현 | 후속 작업 |

### 지금 실제로 동작하는 흐름

~~~text
hybrid_ai_input.jsonl
  → 전체 파일 검증
  → 입력 순서대로 최대 N개 선택
  → 증거 검토 / 검사 계획 요청으로 분류
  → 준비 모드: AI 요청과 준비 상태 저장
  → 분석 모드: Claude 호출 → 응답 검증 → 분석·오류·사용량 저장
~~~

**--prepare-only에서는 API 키가 필요하지 않고 API·브라우저 호출도 없습니다.**
**--analyze는 유료 Claude API 호출을 명시적으로 허용하는 옵션**입니다.
키를 입력한 것만으로 호출되지 않습니다. 두 모드는 동시에 선택할 수 없고 하나는 필수입니다.
어느 모드도 Playwright를 자동 실행하지 않습니다.

## 3. 현재 기능 실행하기

### API 키의 로컬 설정

프로젝트 루트에 `.env`와 공유용 `.env.example`을 준비했습니다. `.env`의
`ANTHROPIC_API_KEY=` 뒤에 본인의 키를 입력하세요. 키를 채팅이나 코드에 넣지 않습니다.

환경 설정 의존성은 다음 명령으로 설치합니다. 현재 `.venv`에는 설치를 완료했습니다.
읽기 기능은 [python-dotenv 공식 설명](https://pypi.org/project/python-dotenv/)을 바탕으로 구성했습니다.

~~~powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-ai.txt
~~~

키 설정 여부만 확인하려면 아래 명령을 사용합니다. API를 호출하지 않고 키 값도 출력하지 않습니다.

~~~powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.env_config
~~~

Claude API 기반 코드는 실행 위치와 무관하게 프로젝트 루트의 `.env`를 읽습니다.
기존 `ANTHROPIC_API_KEY` 환경변수가 있으면 그 값을 우선하며, 빈 환경변수도
덮어쓰지 않습니다. 이전에 빈 값으로 설정했다면 해당 환경변수를 제거하고 다시 실행하세요.
다른 `.env` 변수는 프로세스 환경에 추가하지 않으며 변수 참조도 확장하지 않습니다.

`.env`는 평문 파일이며 `.gitignore`로 Git 제외하도록 설정했습니다. 실제 파일은
공유하지 말고, 키가 빈 `.env.example`과 `.gitignore`만 공유하세요. 현재 작업 루트는
Git 저장소가 아니므로 팀 저장소에 코드를 옮길 때 제외 규칙도 함께 적용해야 합니다.
이미 Git에 추가한 비밀 파일은 `.gitignore`만으로 추적이 해제되지 않습니다.

**키를 입력해도 준비 모드는 AI를 호출하지 않습니다.** 실제 호출은 --analyze를 선택한 경우에만 수행합니다.

### JSONL 요청 준비

프로젝트 루트의 PowerShell에서 첫 항목만 준비하려면:

~~~powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector --hybrid-input "결과파일\ex_crawler\crawl-results\hybrid_ai_input.jsonl" --prepare-only --limit 1 --output-dir "결과파일\ai_inspection\hybrid_prepare"
~~~

현재 결과 파일의 전체 14개 항목을 준비하려면 --limit 14로 바꿉니다.
14는 샘플 파일의 항목 수이며 다른 파일은 실제 개수에 맞춰 지정합니다.

| 옵션 | 의미 |
|---|---|
| --hybrid-input | 팀원 크롤러의 JSONL 입력 파일 |
| --prepare-only | API·브라우저 호출 없이 요청만 준비. --analyze와 택일 |
| --analyze | 유료 Claude 분석 실행. --prepare-only와 택일 |
| --limit | 처리할 최대 항목 수. 기본 1 |
| --output-dir | 결과 파일을 저장할 디렉토리 |
| --tier | haiku/sonnet/opus. 기본 haiku |
| --model | API 모델 ID 직접 지정. tier의 기본 ID보다 우선 |
| --max-tokens | 호출당 출력 토큰 상한. 기본 1600 |
| --api-timeout | 호출 네트워크 제한 시간(초). 기본 60 |

실제 분석 명령은 API 비용이 발생합니다. 먼저 --limit 1로 확인하세요.

~~~powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector --hybrid-input "결과파일\ex_crawler\crawl-results\hybrid_ai_input.jsonl" --analyze --tier haiku --limit 1 --max-tokens 1600 --output-dir "결과파일\ai_inspection\hybrid_analysis"
~~~

자동 재시도·모델 승격은 없습니다. --max-tokens는 입력 토큰·전체 요금 상한이 아니며,
네트워크 제한 시간까지 비용이 반드시 0인 것도 아닙니다. 같은 항목을 재실행하면 다시 호출합니다.

입력 순서를 유지하며 숫자 우선순위를 다시 계산하지 않습니다.
ai_queue.jsonl의 우선순위를 ID로 연결하는 기능은 아직 없습니다.

### 입력 검증 규칙

- 형식은 webtestpilot.hybrid-ai-input.v1입니다.
- 필수 필드는 schema, input_id, kind, url, 객체형 payload입니다.
- reason과 task는 선택 문자열입니다.
- 선택 상한과 관계없이 전체 파일을 먼저 검증하며 빈 줄은 무시합니다.
- 잘못된 JSON·버전·URL·중복 ID·지원하지 않는 종류는 실제 줄 번호와 함께 오류를 표시합니다.
- 검증 실패 시 새 결과를 저장하지 않습니다. 이전 실행의 파일은 자동 삭제하지 않습니다.
- 한 항목은 최대 100,000자입니다. 초과하면 증거를 자르지 않고 오류를 냅니다.
- 원본 입력을 수정하거나 출력 파일로 덮어쓰는 경로는 차단합니다.

## 4. AI에게 준비하는 작업

| 입력 kind | 요청 목적 | 결과 work_type |
|---|---|---|
| navigation_failure | 이동 실패 증거와 가능한 원인 검토 | evidence_review |
| interaction_execution_error | 자동화 실행 실패와 사이트 문제를 구분하기 위한 검토 | evidence_review |
| semantic_test_planning | 페이지 기능 요약과 추가 검사 계획 생성 | test_planning |

원본의 공통 task를 실행 지시로 그대로 사용하지 않고 종류별 목적을 정의합니다.
페이지 내용·오류 메시지 등은 신뢰할 수 없는 증거로 취급합니다.

### 증거 검토 응답 규약

- evidence_summary: 증거 요약.
- possible_explanations: 가능한 원인 설명 목록.
- needs_additional_verification: 추가 검증 필요 여부.
- suggested_checks: 제안하는 추가 검사 목록.

### 검사 계획 응답 규약

- page_summary: 페이지 기능 요약.
- proposed_checks: 제안하는 검사 목록.
- open_questions: 기대 동작 등 확인이 필요한 질문 목록.

목록은 최대 10개 문자열입니다. **설명형 제안이지 실행 가능한 Playwright 명령이 아닙니다.**
최종 버그 판정이나 자유 실행 명령은 현재 응답 규약에 포함하지 않습니다.

내부 inspect_hybrid_input 함수에 모의 analyzer를 주입해 응답 검증과 결과 연결을 테스트합니다.
한 항목의 분석 실패는 다음 선택 항목의 분석을 막지 않습니다.
ClaudeAnalyzer는 --analyze에 연결했습니다. 이번 구현 검증에는 모의 응답만 사용했으며
실제 계정 권한·모델 이용 가능 여부·AI 응답 품질은 사용자의 첫 실제 실행에서 확인해야 합니다.

## 5. 저장되는 결과와 읽는 방법

| 파일 | 내용 |
|---|---|
| ai_requests.jsonl | 종류별 시스템 지침·작업 목적·원본 증거·응답 규약 |
| ai_results.jsonl | 항목별 ID·종류·원본 줄 번호·처리 상태·분석 또는 오류·반환 사용량 |
| evidence_batch.json | 전체·선택·처리 수, 호출 시도·완료·오류 수, 반환 토큰 합계와 처리 요약 |

준비 모드에서는 다음 값이 정상입니다.

- analysis_status: prepared → AI 요청 준비 완료. AI 분석 완료가 아닙니다.
- analyzer_calls: 0 → 분석기를 호출하지 않았습니다.
- request_characters → 요청 JSON의 문자 수. 실제 사용 토큰 수가 아닙니다.

분석 모드 또는 모의 분석기를 사용하면 항목별 completed 또는 error와 응답·오류가 저장됩니다.
completed는 응답 검증 완료를 뜻하며 사이트가 정상이라는 판정은 아닙니다.
분석기가 사용량을 제공하면 ai_usage도 기록하지만 준비 모드에서는 실제 토큰 사용량이 발생하지 않습니다.

분석 모드의 mode는 analyze입니다. 응답 잘림·검증 실패에도 반환된 ai_usage는 보존합니다.
usage_recorded_calls는 사용량이 반환되어 기록된 호출 수, token_totals는 그 사용량의 합계입니다.
사용량을 받지 못한 호출의 비용을 0으로 단정하지 않습니다. 오류 항목이 있으면 종료 코드는 1입니다.
입력·옵션·키 오류는 종료 코드 2이며 API 호출 전에 차단합니다. 빈 입력은 키 없이 호출 0회로 완료합니다.

출력 디렉토리는 자동 생성되며 호출 전에 파일을 써서 기본 저장 문제를 확인하고 항목별로 갱신합니다.
중단 시 이미 저장된 항목은 확인할 수 있지만 진행 중 요청·파일 쓰기의 완전한 복구를 보장하지 않습니다.
같은 경로로 실행하면 위 세 파일을 갱신합니다.
기존 원본 결과 JSONL과 과거 검사 결과·스크린샷은 변경하지 않습니다.

## 6. 코드 구성과 추가 검증 기반

| 파일 | 역할 |
|---|---|
| ai_inspector.py | JSONL 요청 준비·Claude 분석 명령의 진입점 |
| inspection_input.py | JSONL 읽기·형식 검증 |
| evidence_inspector.py | 작업 분류·요청 생성·응답 검증·결과 저장 |
| claude_client.py | JSONL 요청을 Messages API로 전송하고 사용량·안전한 오류를 반환 |
| env_config.py | 프로젝트 루트 .env와 환경변수에서 키 읽기·비공개 설정 확인 |
| browser_runner.py | 명시적으로 허용한 추가 검증 실행 기반 |
| test/ | 구현과 분리한 테스트 코드 |

browser_runner.py는 검토된 선택자와 click/fill/press 단계만 받아 실행합니다.
명시적 허용 없이는 브라우저를 열지 않습니다. 외부 출처 이동·팝업과
POST/PUT/PATCH/DELETE 요청을 차단하며 로그인·장바구니 등 상태 변경을 허용하는 기능은 아직 없습니다.
입력값은 단계 기록에 저장하지 않습니다.

실행 결과에는 스크린샷·본문 일부·오류 종류와 건수가 남습니다.
화면이나 본문에 민감정보가 포함될 수 있으므로 허가된 테스트 환경과 비민감 데이터로 사용해야 합니다.
안전 정책이 모든 위험을 자동 판별하는 것은 아닙니다.

이 실행기는 JSONL의 설명형 제안을 자동 변환하지 않으며 준비·분석 CLI 모두에서 호출되지 않습니다.

기존 URL 직접 검사, 우선순위 JSON 검사, --input, --top, --observe-only,
--execute-checks 등 이전 검사 옵션은 제거했습니다. AI 패키지는 더 이상
src/preprocessing의 파서나 브라우저 탐색 함수에 의존하지 않습니다.
이전 전처리 코드·문서는 참고용으로 남아 있지만 현재 파이프라인에서는 사용하지 않습니다.

## 7. 테스트

테스트는 src/ai_inspection/test/에 작성합니다.
기본 테스트는 모의 API 응답을 사용하며 실제 Claude API를 호출하지 않습니다.

AI 검사기 테스트:

~~~powershell
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection/test -t . -v
~~~

추가 검증 실행기의 실제 로컬 브라우저 테스트:

~~~powershell
$env:WEBTESTPILOT_BROWSER_TESTS = "1"
.\.venv\Scripts\python.exe -m unittest src.ai_inspection.test.test_browser_runner -v
~~~

브라우저 테스트에는 Playwright와 설치된 Chrome/Edge 또는 Playwright Chromium이 필요합니다.
로컬 임시 페이지에서 입력·클릭·스크린샷 저장과 상태 변경 요청 차단을 확인하며,
실제 AI 추론 성능이나 버그 발견율을 측정하는 테스트는 아닙니다.

## 8. 다음 연결 작업

1. 사용자 계정에서 첫 실제 Claude 호출 1건의 응답과 사용량을 검증합니다.
2. AI 제안을 검토 가능한 실행 단계로 변환하고 추가 검증 실행기와 연결합니다.
3. 3팀과 기대 동작·판정 기준·벤치마크 규약을 확정합니다.
4. 입력 ID, 증거, 실행 결과, 판정을 묶어 사용자용 리포트를 만듭니다.

위 항목은 예정 작업이며 현재 구현 완료를 의미하지 않습니다.
