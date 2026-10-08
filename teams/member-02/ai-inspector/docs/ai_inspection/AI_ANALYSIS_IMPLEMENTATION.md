# JSONL 기반 Claude 분석 연결: 팀원용 구현 설명

## 1. 이번 작업의 목적과 완료 범위

기존 기능은 전처리 JSONL을 읽고 AI 요청을 파일로 준비하는 단계까지였다.
이번 작업에서는 그 요청을 Claude API에 전달하고, 응답을 검증해 결과와 사용량을
원본 input_id에 연결하여 저장하는 분석 모드를 추가했다.

**구현 완료:** 명시적 분석 실행, 호출 개수 제한, 종류별 요청, 응답 검증,
실패 기록, 반환 토큰 집계, 항목별 결과 저장, 모의 API 통합 테스트.

**이번 작업에 포함하지 않음:** 실제 유료 호출 검증, 자동 Playwright 추가 탐색,
설명형 계획의 실행 코드 변환, 최종 버그 판정, 사용자용 리포트, 모델 자동 승격.

따라서 API 키가 있는 사용자는 이제 분석 명령을 실행할 수 있지만,
실제 계정·모델 접근 권한과 AI 응답 품질은 첫 실제 호출에서 별도로 확인해야 한다.
개발 과정에서는 유효한 키를 읽어 출력하거나 실제 API 요청을 보내지 않았다.

## 2. 팀별 책임과 연결 경계

| 담당 | 책임 | 관련 입력·출력 정보 |
|---|---|---|
| 1팀: 크롤링·전처리 | 페이지·행동 증거 수집과 AI 후보 선정 | hybrid_ai_input.jsonl, 종류·ID·증거 규약 |
| 2팀: AI 검사·리포트 | 증거 검토, 추가 검사 제안, 이후 실행·보고 연결 | input_id가 유지된 분석 결과와 사용량 |
| 3팀: 테스트 페이지·벤치마크 | 재현 환경과 평가 기준 | 정상 동작 요구사항, 초기화 방법, 별도 평가용 정답 |

이번 구현은 1팀 크롤러 코드와 원본 결과 파일을 수정하지 않는다.
기존 증거를 활용하며 페이지 전체를 다시 크롤링하지 않는다.
평가용 버그 정답 목록을 AI 입력에 포함해 성능을 부풀리지 않아야 한다.

## 3. 실행 흐름

```text
ai_inspector.py: 명시적으로 모드 선택
        ↓
inspection_input.py: 전체 JSONL 검증
        ↓
입력 순서로 최대 limit개 선택 + 출력 경로 검증
        ↓
evidence_inspector.py: 종류별 요청 생성
        ↓
prepare-only ─────────────→ 준비 상태 저장(API 0회)
        │ analyze
        ↓
env_config.py: 환경변수 또는 프로젝트 루트 .env에서 키 읽기
        ↓
claude_client.py: 항목당 Messages API 1회 호출
        ↓
API 응답 종료 상태 확인 → JSON 해석 → 로컬 규약 검증
        ↓
input_id + 분석/오류 + 반환 사용량 저장
        ↓
다음 선택 항목 처리(재시도 없음)
```

명령의 --limit가 1이어도 전체 입력 파일은 먼저 검증한다.
후반부 줄의 형식이 잘못됐다면 앞부분을 유료 호출하기 전에 차단한다.
출력이 원본을 덮어쓰는 경로도 분석기를 생성하기 전에 거부한다.
API 호출 전에 결과 파일을 써서 기본 경로·권한 문제를 확인한다.
빈 입력은 분석 모드여도 키를 읽는 분석기를 만들지 않고 0회 호출로 끝낸다.

## 4. 변경된 코드

| 파일 | 변경 내용 |
|---|---|
| src/ai_inspection/ai_inspector.py | 준비/분석 모드 택일, 모델·토큰·네트워크 제한 옵션, 종료 코드 |
| src/ai_inspection/evidence_inspector.py | 분석기 생성 연결, 오류 후 계속 처리, 실패 사용량 보존, 집계·체크포인트 |
| src/ai_inspection/claude_client.py | 설정 검증, 안전한 API 오류 분류, 잘린 응답·잘못된 JSON 거부 |
| src/ai_inspection/test/test_analysis_mode.py | 분석 CLI를 모의 API로 검증하는 테스트 추가 |
| src/ai_inspection/test/test_ai_inspector.py | 현재 옵션과 API 오류 형식에 맞춰 기존 테스트 갱신 |
| docs/ai_inspection/AI_README.md, README.md | 실제 연결 상태와 실행법 갱신 |

새 테스트는 구현 폴더와 분리한 test 디렉토리에 작성했다.
browser_runner.py는 이번 분석 흐름에서 호출하지 않는다.

## 5. 입력 계약과 작업 분류

입력은 JSONL이며 한 줄이 작업 하나다. 지원 형식은
webtestpilot.hybrid-ai-input.v1이고 필수 필드는 다음과 같다.

| 필드 | 의미 |
|---|---|
| schema | 입력 형식 버전 |
| input_id | 중복되지 않는 비어 있지 않은 작업 ID |
| kind | 지원하는 작업 종류 |
| url | 인증정보가 포함되지 않은 절대 HTTP(S) 주소 |
| payload | 관찰·오류 등 실제 증거 객체 |
| reason, task | 선택 문자열. task는 그대로 실행 지시로 사용하지 않음 |

| kind | work_type | AI 요청 목적 |
|---|---|---|
| navigation_failure | evidence_review | 이동 실패의 증거와 가능한 원인 설명 |
| interaction_execution_error | evidence_review | 자동화 실패와 사이트 문제 가능성을 구분 |
| semantic_test_planning | test_planning | 페이지 기능 요약과 추가 검사 제안 |

빈 줄은 무시하고 실제 줄 번호를 기록한다. 중복 ID, 잘못된 JSON·버전·URL·payload,
미지원 종류는 줄 번호와 함께 오류로 보고한다. 한 입력 항목은 최대 100,000자이며
초과한 증거는 자르지 않고 거부한다.

숫자 우선순위 재계산이나 ai_queue.jsonl 연결은 하지 않는다. 입력 파일 순서를 유지한다.
지원 종류가 늘어나면 입력 검증·요청 생성·응답 검증·테스트를 함께 갱신해야 한다.

## 6. API에 무엇을 보내는가

준비한 요청에는 시스템 지침, 종류별 작업 목적, URL·선정 이유·payload,
응답 규약이 들어 있다. API의 사용자 메시지에는 input_id, kind, work_type,
task, evidence를 전달한다. 전체 crawl_report.json이나 브라우저 HTML을 새로 읽어
붙이지 않으며 API 키도 사용자 메시지에 넣지 않는다.

API 키는 인증 헤더로만 사용한다. 시스템 지침은 페이지 문구·오류·원본 지시를
신뢰할 수 없는 증거로 취급하고, 근거 없이 버그를 확정하거나 실행했다고 주장하지
않도록 한다. 이것이 모델의 판단 정확성을 보장한다는 의미는 아니다.

API에는 JSON 스키마 출력 형식을 지정하고, 반환값을 로컬에서 다시 검사한다.
요청 구조는 [Messages API](https://platform.claude.com/docs/en/api/messages/create),
출력 형식은 [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)를 참고했다.

## 7. AI 응답 계약

### 증거 검토

```json
{
  "evidence_summary": "PDF 이동 중 다운로드 시작이 기록됨",
  "possible_explanations": ["정상 다운로드를 이동 실패로 기록했을 가능성"],
  "needs_additional_verification": true,
  "suggested_checks": ["다운로드 이벤트와 저장된 파일 확인"]
}
```

### 검사 계획

```json
{
  "page_summary": "상품 목록과 필터가 있는 페이지",
  "proposed_checks": ["필터 선택 후 상품 목록의 변화 확인"],
  "open_questions": ["필터별 기대 상품 목록은 무엇인가?"]
}
```

위 예시는 이해를 돕는 설명이며 실제 API 실행 결과가 아니다.
각 규약의 키가 정확히 일치해야 한다. 요약은 문자열, 목록은 최대 10개 문자열,
추가 확인 여부는 불리언이다. 예상하지 않은 키·최종 verdict·실행 코드 형태는 거부한다.
설명형 proposed_checks와 suggested_checks는 Playwright 실행 명령이 아니다.

## 8. 설치·키 설정·실행

프로젝트 루트의 PowerShell에서 실행한다. 기존 .venv가 없으면 먼저
python -m venv .venv로 만든다.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-ai.txt
.\.venv\Scripts\python.exe -m src.ai_inspection.env_config
```

루트 .env에 ANTHROPIC_API_KEY를 직접 입력한다. 설정 확인 명령은 값이나 인증 헤더를
출력하지 않고 API도 호출하지 않는다. 설정되었다는 출력은 실제 인증 성공을 의미하지 않는다.
이미 환경변수가 있으면 .env보다 우선하며 빈 환경변수도 덮어쓰지 않는다.
실제 .env는 공유하지 말고 빈 .env.example과 .gitignore만 공유한다.

### 비용 없는 준비

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector --hybrid-input "결과파일\ex_crawler\crawl-results\hybrid_ai_input.jsonl" --prepare-only --limit 1 --output-dir "결과파일\ai_inspection\hybrid_prepare"
```

### 실제 분석: 유료 API 호출

실행 전에 증거 파일에 비밀번호·토큰·쿠키 값·개인정보가 포함되지 않았는지 확인한다.
현재 입력부는 임의의 payload에서 민감정보를 완벽하게 탐지·제거하지 않는다.
다음 명령은 기본 Haiku로 최대 한 항목을 실제 호출한다. 이 구현 작업에서는 실행하지 않았다.

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector --hybrid-input "결과파일\ex_crawler\crawl-results\hybrid_ai_input.jsonl" --analyze --tier haiku --limit 1 --max-tokens 1600 --api-timeout 60 --output-dir "결과파일\ai_inspection\hybrid_analysis"
```

### 옵션과 비용 제한

| 옵션 | 기본값·동작 |
|---|---|
| --prepare-only / --analyze | 둘 중 하나 필수. 동시에 사용할 수 없음 |
| --limit | 1. 호출 시도 수는 선택 항목 수를 넘지 않음 |
| --tier | haiku. sonnet 또는 opus를 명시적으로 선택 가능 |
| --model | API 모델 ID 직접 지정. tier에 대응하는 ID보다 우선 |
| --max-tokens | 1600. 호출당 출력 토큰 상한 |
| --api-timeout | 60초. 네트워크 요청의 제한 시간 |
| --output-dir | 결과 디렉토리. 같은 경로의 결과는 갱신됨 |

현재 코드의 기본 매핑은 Haiku=claude-haiku-4-5-20251001,
Sonnet=claude-sonnet-5-5, Opus=claude-opus-5-5다. 자동 승격하지 않는다.
모델 접근 권한과 지원 여부는 사용 계정에서 확인해야 한다. 모델 설정을 변경할 때는
[공식 모델 문서](https://platform.claude.com/docs/en/models/overview)를 확인한다.

--max-tokens는 입력 토큰·전체 요금의 상한이 아니다. 네트워크 타임아웃도 비용 0을
보장하지 않는다. 동일 항목을 다시 실행하면 다시 과금될 수 있다. 자동 재시도,
동시 호출, 자동 모델 전환, 기존 성공 항목 자동 생략 기능은 없다.

## 9. 출력 파일과 결과 해석

| 파일 | 역할 |
|---|---|
| ai_requests.jsonl | 실제 분석에 사용하는 준비된 요청들 |
| ai_results.jsonl | 처리 완료한 항목별 분석 결과·오류·반환된 사용량 |
| evidence_batch.json | 실행 설정·진행 수·사용량 합계와 항목별 요약 |

항목의 공통 정보는 input_id, kind, work_type, line_number, request_characters다.
성공하면 analysis, 사용량이 반환되면 ai_usage가 추가된다. API 키는 저장하지 않는다.

| 항목 analysis_status | 의미 |
|---|---|
| prepared | 요청 준비만 완료. 분석하지 않음 |
| completed | AI 응답 형식 검증 완료. 사이트 정상 판정이 아님 |
| error | API·응답 종료·JSON 해석·규약 검증 중 실패 |

분석 요약의 mode는 analyze다. 내부 테스트용 분석기 주입은 injected_analyzer,
준비 모드는 prepare_only다. 주요 집계 필드는 다음과 같다.

- total_records / selected_count / processed_count: 전체·선택·처리 항목 수.
- analyzer_calls: 분석기 호출 시도 수. 청구 확정 호출 수가 아님.
- completed_count / error_count: 분석 응답 검증 성공·실패 수.
- usage_recorded_calls: API 사용량이 반환되어 기록된 호출 수.
- token_totals: 반환 사용량의 숫자 필드를 항목별로 합산한 값.
- analysis_config: 요청한 tier·모델 ID·출력 상한·네트워크 제한 시간.

ai_usage에는 공급자·요청 모델·응답 모델·메시지 ID·stop_reason·tokens가 들어 있다.
응답이 잘리거나 로컬 검증에 실패해도 이미 반환된 사용량은 보존한다.
사용량이 없는 호출의 비용을 0이라고 가정하지 않는다. 캐시 등 토큰 세부 필드를
모두 더해서 임의의 전체 비용이나 총 토큰을 계산하지 않는다. 통화 비용 계산은 미구현이다.

## 10. 오류 처리와 저장 방식

| 상황 | 처리 |
|---|---|
| 입력·옵션·키 오류 | 호출 전 차단. CLI 종료 코드 2 |
| HTTP 401/403/404/429 등 | 안전한 오류 코드와 HTTP 상태 저장 |
| 접속 실패·타임아웃 | 분류된 오류 저장. 재시도하지 않음 |
| stop_reason이 end_turn이 아님 | incomplete_response 오류와 반환 사용량 저장 |
| 모델 출력이 JSON이 아님 | invalid_model_json 오류 |
| 응답 규약 불일치 | error_type을 기록하고 원시 예외 메시지는 생략 |
| 일부 분석 실패 | 남은 선택 항목을 계속 처리. 실행 종료 코드 1 |
| 모두 성공 또는 준비·빈 입력 | 종료 코드 0 |

HTTP 오류의 원시 본문과 일반 예외 메시지는 비밀값·입력 내용이 포함될 수 있어 저장하지 않는다.
API가 준 안전한 분류·상태는 기록한다. 사용량 상태는 호출마다 초기화해 이전 항목과 섞이지 않게 한다.

선택한 요청 파일을 먼저 저장하고, 각 항목 처리 후 결과·요약 파일을 갱신한다.
중단 시 저장 완료한 항목은 확인할 수 있다. 다만 진행 중 API 요청이나 파일 쓰기의
완전한 복구·자동 재개·원자적 저장은 보장하지 않는다. 호출 중 중단되면 사용량을
받지 못했더라도 서버에서는 요청이 처리됐을 수 있다.

## 11. 검증 방법과 검증 한계

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection/test -t . -v
.\.venv\Scripts\python.exe -m unittest src.ai_inspection.test.test_analysis_mode -v
```

새 테스트는 네트워크 응답을 모의 처리하며 실제 키나 과금이 필요하지 않다.
준비 모드에서 분석기를 생성하지 않는지, 모드를 명시해야 하는지, 두 작업 종류의
분석 결과가 ID로 연결되는지, 호출·출력 상한이 적용되는지 확인한다.
응답 잘림 후 사용량 보존, 이후 항목 계속 처리, 키 비노출, 입력 원본 보존,
키 누락·빈 입력·출력 충돌·HTTP·접속·타임아웃 오류도 검사한다.
전체 입력 검증 실패나 출력 파일 쓰기 실패 시 호출하지 않는지,
기본 분석 상한 1개와 응답 규약 실패 시 사용량 보존도 확인한다.

### 이번 작업의 검증 결과(2026-10-08)

| 확인 항목 | 결과 |
|---|---|
| 전체 src 회귀 테스트 | 35개 통과. 로컬 브라우저 테스트 포함 |
| 현재 hybrid_ai_input.jsonl의 준비 모드 | 14개 모두 읽기·요청 생성 완료, 분석기 호출 0회 |
| 실제 입력 종류 | navigation_failure 1개, interaction_execution_error 5개, semantic_test_planning 8개 |
| 원본 결과 보존 | 준비 전후 입력 바이트 일치. 출력은 임시 디렉토리에만 저장 |
| 실제 Claude 유료 호출 | 수행하지 않음. 통신·분석 테스트는 모의 응답 사용 |

전체 테스트를 로컬 브라우저까지 포함해 재실행하려면:

```powershell
$env:WEBTESTPILOT_BROWSER_TESTS = "1"
.\.venv\Scripts\python.exe -m unittest discover -s src -t . -v
Remove-Item Env:WEBTESTPILOT_BROWSER_TESTS
```

이는 API 계약과 연결 코드 검증이다. 실제 인증·계정 과금·모델 품질·버그 발견율을
확인한 것은 아니다. 실제 최초 검증은 담당자가 허가된 입력 한 항목으로 수행한다.
결과에서 원본 input_id, completed/error, ai_usage, 반환 토큰을 확인하고 문제를 공유한다.
공유할 때 실제 키·개인정보는 제거한다.

