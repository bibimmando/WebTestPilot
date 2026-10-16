# AI 검사기 개발 상세 문서

> Git share: use [REPRODUCE.md](../../REPRODUCE.md) for current setup and [shared evidence](../../reports/maison_2026-10-16/README.md) for results. Historical local workspace paths below are development records.

기준일: 2026-10-09. 개발자 본인이 구조·실행·오류 처리·다음 작업을 확인하는 문서입니다.
팀 공유용 설명은 [AI_README.md](AI_README.md)에 있습니다.

## 1. 이번 변경과 구현 범위

프로젝트 방향성에 맞춰 기존 코드의 역할을 확장하고 실행 관리자를 추가했습니다.
팀 입력은 기존 `hybrid_ai_input.jsonl` 및 `webtestpilot.hybrid-ai-input.v1` 규격을 유지합니다.
원본 JSONL·전처리 코드·외부 팀 저장소·과거 결과 파일은 수정하거나 이동하지 않았습니다.

기존 준비·분석 모드는 그대로 사용 가능합니다. 새 실행 모드는 연결 객체를 주입받는 개발용 확장입니다.
**실제 Playwright MCP stdio 클라이언트와 단일 Chromium CDP 탭 연결을 제공하며 로컬 실제 서버로 검증했습니다.**
전처리 브라우저의 CDP 제공·팀 카탈로그 연결은 아직 통합해야 합니다. 설정·실행 방법은 12번을 참고합니다.
실제 Claude와 MCP 서버의 통합 성공을 뜻하지 않습니다.

### 현재 분석 모드와 증거 수집의 구분

--analyze는 크롤러가 수집해 JSONL에 저장한 증거를 읽고 Claude에 분석을 요청합니다.
AI가 실행 중 사이트를 탐색하거나 새 증거를 수집하는 모드가 아닙니다.
semantic_test_planning은 기능 요약·검사 제안, 나머지 지원 종류는 기존 증거 검토로 처리합니다.
추가 확인 사항은 제안이며 실제 행동 실행·재현·최종 결함 판정은 수행하지 않습니다.
새 --execute는 별도의 확장 경로이며 --mcp-config로 내장 연결부를 사용할 수 있습니다.

| 기능 | 상태 |
|---|---|
| JSONL 검증·증거 분석·결과 저장 | 기존 기능 유지 |
| 사이트 문맥·페이지 관찰·검사 흐름 어댑터 | 추가 |
| 구조화된 행동 선택 `ClaudePlanner` | 추가, 모의 API 검증 |
| 실행 관리자·권한 확인·실제 행동 기록·새 관찰 전달 | 추가, 주입된 실행기로 검증 |
| 기존 MCP 세션 호출 어댑터 | 추가, 모의 MCP 결과 검증 |
| 기존 탭의 관찰·뷰포트 캡처 | 추가, 로컬 브라우저 검증 |
| 등록된 기대 조건의 프로그램 판정 | 텍스트 포함·URL 일치만 구현 |
| 실제 MCP 접속·공통 탭 연결 | 단일 CDP 탭 내장 연결부, 로컬 실제 MCP 검증; 전처리 CDP 제공은 통합 필요 |
| 자율 기능 발견·새 검사 조건 생성 | 기존 설명형 계획 유지, 실행 모드는 등록된 검사 카탈로그로 제한 |
| 추가 1회 재현·reset/seed·비밀값 참조·로그인 연계 | 미구현 |
| 모바일 자동 전환·시각적 AI 판정 | 미구현 |
| 단일 PDF·보고서 AI·재생성·웹 UI | 미구현 |

## 2. 파일별 책임

| 파일 | 역할 |
|---|---|
| `analysis/inspection_input.py` | JSONL 검증, 원본을 변경하지 않는 내부 문맥 변환 |
| `providers/claude_client.py` | 공통 API 전송·오류·사용량, 증거 분석기와 행동 선택기 |
| `analysis/evidence_inspector.py` | 기존 증거 분석, 등록된 기대 조건과 실제 관찰 비교 |
| `execution/browser_runner.py` | 기존 독립 제한 실행기, 기존 탭의 `SharedPageObserver` |
| `execution/mcp_executor.py` | 등록된 행동을 실제 MCP 도구·인자로 매핑, 도구 결과 확인 |
| `execution/playwright_mcp_runtime.py` | 실제 stdio SDK 브리지·CDP 접속·같은 탭 확인·기본 행동 도구 매핑·연결 정리 |
| `handoff/execution_handoff.py` | 기존 분석의 제안별 오프라인 전달 초안 생성·검토된 행동 추가·전달 집계 |
| `execution/inspection_runtime.py` | 계획·권한·실행·관찰·판정·한도·중지·JSON 저장 |
| `ai_inspector.py` | 준비·분석·실행 명령행 진입점 |
| `test/` | 기존 기능 호환과 새 구조의 테스트 |

기존 `verify_steps()`는 별도 브라우저의 제한 실행 테스트 기반으로 유지합니다.
제품의 공통 탭 실행 경로는 `MCPExecutor`에 연결합니다. 새 관찰기는 브라우저를 생성·종료하지 않습니다.

## 3. JSONL 입력과 내부 문맥

기존 한 줄 입력 예시:

```json
{"schema":"webtestpilot.hybrid-ai-input.v1","input_id":"page-001","kind":"semantic_test_planning","url":"http://localhost:8000/demo","payload":{}}
```

필수 필드는 `schema`, `input_id`, `kind`, `url`, 객체형 `payload`입니다.
지원 `kind`는 `navigation_failure`, `interaction_execution_error`, `ambiguous_interaction`, `semantic_test_planning`입니다.
`ambiguous_interaction`은 행동 전후 결과가 불명확한 증거 검토로 처리합니다. 화면 변화가 없다는 사실만으로 버그로 단정하지 않습니다.
이 작업 종류와 기능·입력 검증·라우팅·UI의 버그 분류는 다른 개념입니다.
전체 파일을 먼저 검증하고 입력 순서대로 최대 `--limit`개를 선택합니다.
잘못된 버전·URL·중복 ID·지원하지 않는 종류·100,000자를 넘는 행은 거부합니다.

`adapt_inspection_context(record)`는 원본의 복사본을 다음 세 묶음으로 정리합니다.

```text
input_id / kind
site_context       : 사이트 설명·공통 문맥
page_observation   : URL·현재 관찰·원본 증거
inspection_flow    : 목표·시작 조건·이전 행동
```

없는 문맥은 빈 객체이며 업무 규칙이나 권한을 만들지 않습니다.
추가 문맥을 넣을 수 있는 AI 측 선택 확장 위치는 `payload.inspection_context`입니다.
아래 객체를 그 값으로 넣을 수 있습니다.

```json
{
  "site_context": {"description": "테스트 게시판"},
  "page_observation": {"state_description": "작성 화면"},
  "inspection_flow": {"goal": "작성 후 표시 확인", "start_condition": "빈 테스트 데이터"}
}
```

이 확장은 팀의 새 필수 규격으로 확정한 것이 아닙니다. 기존 JSONL도 그대로 읽습니다.
실행 중 실제 관찰과 이전 행동은 실행 관리자가 갱신하며 원본 파일에는 쓰지 않습니다.
JSONL이나 페이지의 허용 행동 문구를 실행 권한으로 채택하지 않습니다.

## 4. RuntimeBinding과 연결 팩토리

실제 팀 연결부는 다음 형태의 팩토리를 구현합니다.

```python
from src.ai_inspection.inspection_runtime import RuntimeBinding

def create(*, context, planner, output_dir):
    # 아래 객체들은 팀의 실제 세션 연결 코드에서 준비해야 합니다.
    return RuntimeBinding(
        planner=planner,
        executor=shared_executor,
        controls=reviewed_controls,
        checks=registered_checks,
        allowed_origins=(approved_origin,),
        permission=approved_action_policy,
    )
```

설명용 예시이며 `shared_executor` 등의 정의가 없으므로 그대로 실행할 수 없습니다.
CLI는 현재 항목의 `context`, `ClaudePlanner`, 결과 경로를 팩토리에 전달합니다.
팩토리는 해당 항목에 대응하는 준비된 공통 탭을 제공해야 합니다.
실행 관리자가 자동으로 URL 탐색·로그인·초기화하지 않습니다.
첫 실제 관찰 URL이 JSONL URL과 정확히 다르면 AI 호출 전에 해당 항목을 미완료 처리합니다.

| 필드 | 요구 인터페이스 |
|---|---|
| `planner(request)` | 등록된 검사 ID와 구조화된 행동 반환 |
| `executor.observe()` | 실제 같은 탭의 URL·본문·증거 등 반환 |
| `executor.execute(step)` | 실제 행동 실행, `execution_status: completed` 반환 |
| `controls` | 검토된 요소 ID → 선택자 문자열; 실제 MCP 인자는 별도 매핑 |
| `checks` | 신뢰하는 연결부가 등록한 기대 조건 카탈로그 |
| `allowed_origins` | 프로그램 설정에서 승인한 HTTP(S) 출처 |
| `permission(step)` | 행동·대상·입력값을 검증하여 허용될 때 정확히 True 반환 |

관찰 데이터·테스트 값은 모델과 결과에 전달할 수 있는 비민감 자료여야 합니다.
현재 행동 계약은 비밀번호·세션·키 참조를 지원하지 않습니다. 로그인 비밀값은 넣지 않습니다.
실제 연결부는 서버·네트워크의 허용 정책과 도구별 제한 시간도 적용해야 합니다.
실행 전후 URL 검증과 콜백만으로 모든 위험 동작이 자동 차단되는 것은 아닙니다.

## 5. MCP 연결 경계

```python
from src.ai_inspection.mcp_executor import MCPExecutor

executor = MCPExecutor(
    call_tool=call_tool_sync,
    observe=observe_shared_tab,
    permission=approved_action_policy,
    action_bindings={
        "click": (registered_click_tool_name, build_click_arguments),
        "fill": (registered_fill_tool_name, build_fill_arguments),
        "press": (registered_press_tool_name, build_press_arguments),
    },
)
```

도구 이름·인자는 실제 서버 목록과 스키마를 확인한 연결부가 등록합니다.
내장 연결부의 고정 서버 버전은 검토된 선택자를 target에 직접 전달합니다. 별도 참조 기반 서버를 쓰면 요소 ID·참조 변환은 팀 팩토리가 담당합니다.
`call_tool_sync(name, arguments)`는 실제 CallToolResult를 `{"isError": false, ...}` 딕셔너리로 정규화합니다.
`isError` 누락·오류·지원하지 않는 형식은 완료로 처리하지 않습니다.
내장 StdioMCPClient는 비동기 SDK 세션을 별도 스레드에서 유지하고 동기 호출로 연결합니다.
SDK 접속·서버 실행·탭 선택·세션 종료는 이 어댑터가 하지 않습니다. 기존 세션 소유자가 수명주기를 관리합니다.

모델은 구조화된 행동을 선택하고 프로그램이 MCP를 호출합니다.
공급자 API의 네이티브 `tool_use`/`tool_result` 대화 형식까지 구현한 것은 아닙니다.

## 6. 행동 계획과 기대 조건

모델 응답 예시:

```json
{
  "decision": "act",
  "check_id": "save-result",
  "steps": [
    {"action": "fill", "control_id": "title", "value": "test title"},
    {"action": "click", "control_id": "save", "value": ""}
  ]
}
```

허용 행동은 click·fill·press이며 한 계획 최대 10개입니다.
fill은 1,000자 이하 문자열, press는 Enter·Tab·Escape만 지원합니다. click의 value는 빈 문자열입니다.
등록되지 않은 요소·검사 ID, 추가 필드, 자유 코드 실행은 거부합니다.
종료 응답은 `{"decision":"finish","check_id":"","steps":[]}`입니다.
실제 판정한 검사가 없이 finish만 반환하면 통과나 완료가 아닌 미완료입니다.

기대 조건 등록 예시:

```python
checks = {
    "save-result": {
        "kind": "text_contains",
        "value": "test title",
        "source": "requirement",
        "evidence_ref": "requirements:save-and-display",
    }
}
```

현재 `kind`는 text_contains·url_equals·unknown입니다.
근거 `source`는 requirement·explicit_constraint·inference·unknown입니다.
모델은 등록된 check_id를 선택하며 근거를 새로 만들어 판정하지 않습니다.

| 판정 | 조건 |
|---|---|
| `passed` | 등록된 근거가 있고 실제 관찰이 조건을 만족 |
| `candidate` | 근거 있는 조건과 불일치; 추가 재현 전 후보 |
| `review_required` | 기대 근거가 없거나 추정뿐임 |
| `incomplete` | 관찰이 없거나 잘린 텍스트에서 기대값을 찾을 수 없음 |

행동 완료·검사 판정·재현 결과는 별개입니다. 검사 통과는 해당 범위의 결과입니다.
현재 전체 사이트의 미검사 기능을 계산하는 커버리지 기능은 없습니다.
새 기능 발견과 기대 조건 생성은 다음 단계에서 현재 등록 카탈로그 구조를 확장해야 합니다.

## 7. 실행 관리자와 관찰

```text
전체 JSONL 검증 → 내부 문맥 변환 → 출력 사전 확인
 → 팩토리로 준비된 탭·모델·권한 연결
 → 실제 관찰·URL 확인
 → AI 계획 검증 → 계획 전체의 권한 확인
 → 행동 전 관찰 → 실제 도구 실행 → 행동 후 관찰
 → 기대 조건 판정 → 행동 기록·새 관찰을 다음 AI 입력에 반영
 → 종료·한도·중지·오류 및 JSON 저장
```

`SharedPageObserver`는 기존 동기 Playwright page 객체를 받아 URL·제목·본문·화면 크기·스크롤 위치를 기록합니다.
현재 화면 캡처를 기본으로 하며 브라우저·탭을 새로 만들거나 종료하지 않습니다.
본문 기본 한도는 10,000자이고 잘림 여부를 표시합니다. 촬영 실패는 증거 부족으로 표시합니다.
현재 이미지는 파일로 저장되며 ClaudePlanner에 이미지 블록으로 전달되지 않습니다. 시각적 UI 판정은 후속 작업입니다.

비민감 테스트 값은 계획·행동 기록에 저장됩니다. 실패한 행동도 시작 전 증거와 오류 종류를 보존합니다.
원시 통합 예외 메시지는 저장하지 않습니다. 자동 재현·초기화는 수행하지 않으며 `reproduction_status: not_attempted`입니다.

한도 기본값은 항목당 3라운드, 전체 행동 시도 10회, 전체 경과 60초입니다.
개발용 기본값이며 팀 확정 수치가 아닙니다. 실패한 도구 호출도 행동 시도로 셉니다.
모델·도구 호출 사이에서 한도와 중지를 확인합니다. 진행 중 호출을 강제 취소하지 않으므로 MCP 호출부에도 timeout이 필요합니다.
전체 금액·입력 토큰 상한, 무변화 탐지, 보고서 생성 자원 예약은 아직 구현하지 않았습니다.

## 8. 결과 저장

| 모드 | 파일 |
|---|---|
| 기존 준비·분석 | ai_requests.jsonl, ai_results.jsonl, evidence_batch.json |
| 새 실행 | inspection_results.jsonl, inspection_run.json |
| 관찰 증거 | 연결부가 지정한 증거 폴더의 실제 이미지 |

### 8.1 파일 관계와 확인 순서

```text
크롤러: hybrid_ai_input.jsonl
  ├─ 준비/분석: ai_requests.jsonl → ai_results.jsonl
  │                                └─ evidence_batch.json (전체 요약 + 항목 결과)
  └─ 실행 연결 후: inspection_results.jsonl
                    └─ inspection_run.json (전체 요약 + 항목 결과)
                         └─ actions의 증거 참조 → 실제 이미지 파일
```

준비·분석 결과는 --output-dir에 저장됩니다. 현재 Maison 분석 폴더는
`결과파일/ai_inspection/maison/hybrid_analysis/`입니다.
분석 성공 여부는 evidence_batch.json, 실제 AI 답변은 ai_results.jsonl, 입력 구성은 ai_requests.jsonl 순서로 확인합니다.
JSONL은 한 줄이 한 JSON 객체입니다. 여러 줄을 JSON 배열처럼 해석하지 않습니다.
아래 설명은 현재 코드가 생성하는 파일 기준이며 과거 버전의 inspection.json·inspection_batch.json 등과 구분합니다.

### 8.2 hybrid_ai_input.jsonl: 크롤러가 제공하는 입력

생성 주체는 크롤러이며 AI 검사기가 만드는 분석 결과가 아닙니다.
입력 한 항목의 필드는 다음과 같습니다.

| 필드 | 의미 |
|---|---|
| schema | 팀 입력 규격 이름 webtestpilot.hybrid-ai-input.v1 |
| input_id | 입력 항목의 고유 ID. 요청·분석·실행 결과를 연결하는 기준 |
| kind | 이동 실패·행동 실패·불명확한 행동·검사 계획 등 처리 종류 |
| url | 해당 증거가 발생한 URL |
| reason / task | 선택 설명. 원본 task를 실행 지시로 그대로 사용하지 않음 |
| payload | 종류별 실제 관찰·행동·오류·페이지 문맥 등의 객체 |

예를 들어 ambiguous_interaction에는 before·after·action 등이 들어갈 수 있습니다.
단, payload의 내부 모양은 종류와 크롤러 버전에 따라 다르므로 모든 항목에 동일 필드가 있다고 가정하지 않습니다.
입력에 포함된 항목 수를 사이트 전체의 검사 수나 결함 수로 해석하지 않습니다.

### 8.3 ai_requests.jsonl: 분석 요청 구성 기록

선택한 입력마다 하나의 요청 객체를 만듭니다. API 호출 전에 파일에 기록하며 준비 모드에서도 생성됩니다.
따라서 이 파일은 요청을 준비했다는 증거이지 실제 전송·응답 성공의 증거가 아닙니다.

| 필드 | 의미 |
|---|---|
| schema_version | AI 측 요청 객체 버전 |
| input_id / kind | 원본 입력 항목 연결 정보 |
| work_type | evidence_review 또는 test_planning |
| system | 신뢰하지 않는 증거 처리·근거 없는 확정 금지 등의 프로그램 지침 |
| task | 입력 종류에 맞게 프로그램이 정한 분석 목적 |
| evidence.url / reason / payload | 전달 대상으로 구성한 원본 증거와 문맥 |
| response_contract | 응답 필드 이름과 문자열·불리언·문자열 목록 등 타입 |

API 어댑터는 이 객체를 실제 Messages 요청으로 변환합니다. 이 파일에는 API 키나 인증 헤더를 저장하지 않습니다.
API가 반환한 원문 응답 파일도 아닙니다. 분석이 엉뚱할 때 task와 payload에 필요한 정보가 있었는지 확인하는 용도입니다.

### 8.4 ai_results.jsonl: 항목별 AI 답변 또는 오류

처리한 입력마다 한 줄을 기록합니다. prepared는 요청 준비, completed는 응답 검증 완료, error는 분석 실패입니다.

| 공통 필드 | 의미 |
|---|---|
| input_id / kind / work_type | 요청·원본 입력과 연결되는 항목 정보 |
| line_number | 원본 JSONL 파일의 실제 줄 번호. 결과 파일 줄 번호와 다를 수 있음 |
| analysis_status | prepared / completed / error |
| request_characters | 준비한 요청 JSON의 문자 수. 토큰 수가 아님 |
| analysis | 성공 시 검증된 AI 응답. 준비·실패 항목에는 없을 수 있음 |
| ai_usage | API가 사용량을 반환했을 때의 모델·메시지·사용량 기록 |
| error_type / error / error_code / http_status | 실패 종류와 안전한 설명. 모든 오류에 모든 필드가 있는 것은 아님 |

evidence_review의 analysis 필드:

| 필드 | 읽는 방법 |
|---|---|
| evidence_summary | AI가 증거를 요약한 설명. 원본 사실 확인은 입력 증거와 대조 |
| possible_explanations | 가능한 설명·가설. 원인 확정이나 코드 진단 결과가 아님 |
| needs_additional_verification | 추가 검증이 필요하다는 표시. 자동 실행 완료 여부가 아님 |
| suggested_checks | 추가 확인 제안. 실제로 수행된 행동 목록이 아님 |

test_planning의 analysis 필드는 page_summary(기능 요약), proposed_checks(검사 제안),
open_questions(기대 동작 등 확인 질문)입니다. 두 응답 형식을 같은 것으로 읽지 않습니다.

ai_usage에는 provider·requested_model·returned_model·message_id·stop_reason·tokens가 있습니다.
tokens는 공급자가 반환한 입력·출력·캐시 등 사용량입니다. 입력/출력 토큰이 기록돼도 금액 계산은 별도입니다.
잘린 응답이나 로컬 응답 검증 실패에도 반환 사용량은 남을 수 있으므로 error 항목에 ai_usage가 있는 것은 정상입니다.
반대로 ai_usage가 없다고 요청 비용이 반드시 0이라고 판단하지 않습니다.

Maison의 실제 성공 항목은 evidence_review이며 needs_additional_verification=true인 클릭 실패 증거입니다.
완료 상태는 분석 API·형식 검증 성공을 나타내며 사이트 버그 확정이나 재현 성공을 나타내지 않습니다.

### 8.5 evidence_batch.json: 분석 실행 전체 요약

한 파일에 실행 설정·집계·항목별 결과를 넣습니다. results 배열의 항목은 ai_results.jsonl과 같은 처리 결과입니다.
두 파일에 결과가 있다고 두 번 분석한 것은 아닙니다.

| 필드 | 의미 |
|---|---|
| schema_version / input_schema / input_file | 요약 버전·입력 규격·입력 경로 |
| mode | prepare_only / analyze / injected_analyzer. 마지막은 주입한 분석기를 사용한 경로 |
| total_records | 원본 입력의 전체 유효 항목 수 |
| selected_count | --limit로 선택한 항목 수 |
| processed_count | 처리가 끝난 항목 수. 분석 성공 수와는 다름 |
| analyzer_calls | 분석기 호출 시도 수. 청구 확정 호출 수·사이트 검사 수가 아님 |
| completed_count / error_count | AI 응답 검증 성공 수 / 분석 실패 수 |
| usage_recorded_calls | 공급자 사용량을 반환받아 기록한 호출 수 |
| token_totals | 반환 사용량의 숫자 필드별 합계. 서로 다른 토큰 종류를 무조건 합산하지 않음 |
| analysis_config | 분석 모드의 공급자·모델·tier·호출당 출력 상한·네트워크 timeout |
| requests_file / results_file | 요청·결과 파일의 저장 경로 |
| results | 입력 ID별 상태·응답·오류·사용량 배열 |

읽는 예: total_records가 22이고 selected_count=1, completed_count=1, error_count=0이면
전체 22개 중 선택한 1개 분석이 성공한 것입니다. 사이트 전체 또는 22개 전체의 검사 성공이 아닙니다.
준비 모드는 analyzer_calls=0, completed_count=0, 각 결과 prepared가 정상입니다.
processed_count가 선택 수보다 적으면 처리 도중 중단됐거나 아직 저장되지 않은 항목이 있을 수 있습니다.

### 8.6 inspection_results.jsonl: 실제 실행 경로의 항목별 기록

--execute의 연결 팩토리를 제공해 실행할 때 생성합니다. 현재 Maison --analyze 출력에는 없습니다.

| 필드 | 의미 |
|---|---|
| input_id / kind / line_number / url | 원본 JSONL의 항목 연결 |
| execution_status | 전체 항목의 실행 흐름 completed 또는 incomplete. 결함 여부와 별개 |
| termination_reason | planner_finished·no_checks_executed·permission_denied·한도·중지·runtime_error 등 |
| plans | 모델이 선택하고 프로그램이 형식을 검증한 계획. 계획 존재만으로 실행을 증명하지 않음 |
| actions | 실제 시도한 행동별 step·before·after·실행 상태·오류 종류 |
| judgments | 실제 완료한 계획의 check_id·기대 근거·관찰 비교·판정 |
| reproduction_status | 현재 not_attempted. 추가 재현을 아직 수행하지 않음 |
| error_type | 연결·계획·도구·관찰 처리 실패 시 오류 종류 |

actions의 started는 행동 전에 기록한 상태이며 호출 도중 중단돼도 남을 수 있습니다.
completed는 해당 행동과 후속 관찰이 완료된 상태, error는 행동 실행 또는 후속 관찰 실패입니다.
before/after에는 URL·본문·증거 참조 등이 들어갑니다. 실행기의 관찰 범위에 따라 부가 필드가 달라집니다.
실패한 항목은 after가 없을 수 있으며 최초 before 기록을 확인합니다.
judgments의 passed·candidate·review_required·incomplete는 6번의 판정 규칙을 따릅니다.
연결 상태가 completed여도 candidate 항목이 있을 수 있습니다.

### 8.7 inspection_run.json: 실제 실행 경로의 전체 요약

inspection_results.jsonl 항목을 results 배열에 포함하고 실행 전체의 수치를 저장합니다.

| 필드 | 의미 |
|---|---|
| schema / mode | AI 측 실행 결과 규격 및 execute 모드 |
| total_records / selected_count / processed_count | 입력 전체·선택·처리 항목 수 |
| action_count | 실제 행동 시도 수. 실패한 시도도 포함 |
| planner_calls | 행동 선택용 모델 호출 시도 수 |
| usage_records | 반환된 모델 사용량과 입력 ID를 연결한 기록 목록 |
| results | inspection_results.jsonl과 같은 항목별 결과 배열 |
| unprocessed_input_ids | 선택 한도 밖 또는 중단으로 시작하지 못한 입력 ID |
| incomplete_count | 처리한 항목 중 실행 흐름이 미완료인 수 |
| selection_limited | --limit로 일부 입력만 선택했는지 여부 |
| termination_reason | completed·completed_with_incomplete·시간/행동 한도·사용자 중지 등 전체 종료 사유 |
| report_status | 현재 not_generated. PDF 생성 완료를 표시하지 않음 |

처리한 항목의 round_limit 등 상세 사유는 results에도 있습니다. 전체 종료 사유만으로 모든 항목을 해석하지 않습니다.
usage_records는 분석 모드의 token_totals와 달리 호출별 목록입니다. 실행 모드에서는 동일한 집계 필드가 있다고 가정하지 않습니다.

### 8.8 이미지와 기존 독립 실행기의 verification.json

SharedPageObserver의 `evidence_<식별자>.png`는 현재 화면 캡처입니다. 관찰 객체의 evidence 목록에
kind=viewport_screenshot과 절대 path로 참조됩니다. viewport에는 화면 크기·스크롤 위치가 기록됩니다.
실제 이미지와 JSON을 함께 보존해야 하며 다른 PC에서 같은 절대 경로가 열린다고 가정하지 않습니다.
evidence_status=missing이면 촬영이 실패한 것이지 사이트 결함이 아닙니다.

기존 verify_steps()를 별도 호출하면 verification.json·before.png·after.png가 만들어질 수 있습니다.

- verification.json: input_id, 실행 상태, 실제 완료 단계, 차단 요청, 콘솔 오류·요청 실패 건수, 마지막 관찰 또는 오류 종류.
- before.png: 계획 전체를 실행하기 전의 전체 페이지 이미지.
- after.png: 계획 전체 실행 후의 전체 페이지 이미지. 실행 실패 시 없을 수 있음.
- steps에는 action·control_id만 남고 입력값은 저장하지 않음. 현재 새 실행 관리자의 actions와 다른 형식.

이 독립 실행기는 준비·분석 CLI에서 자동 호출되지 않습니다. 해당 파일이 없다고 분석 모드 실패는 아닙니다.
현재 PDF는 어느 분석 결과 파일에서도 자동 생성되지 않습니다.

새 실행 JSON에는 입력 ID·계획·실제 행동·행동 전후 관찰·판정·종료 이유·반환 사용량을 저장합니다.
AI 측 결과 규격은 `webtestpilot.inspection-run.v1`이며 팀 입력 규격과 별개입니다.
`execution_status`는 실행 흐름 상태, `judgments[].status`는 개별 검사 판정입니다.
`termination_reason`은 모델 종료·검사 없음·권한 거절·라운드/시간/행동 한도·중지·실행 오류를 구분합니다.
`unprocessed_input_ids`는 --limit 밖 항목과 중단으로 시작하지 못한 항목을 포함합니다.
`selection_limited`로 선택 한도 적용을 표시합니다. URL 방문만으로 완료로 세지 않습니다.

모델 반환 사용량은 응답 검증 실패에도 보존합니다. 미반환 사용량을 비용 0으로 가정하지 않습니다.
PDF는 연결하지 않았으며 `report_status: not_generated`입니다.
같은 결과 폴더는 갱신하므로 과거 실행을 보존하려면 별도 결과 폴더를 사용합니다.
항목·행동별 결과를 저장하지만 원자적 쓰기·프로그램 종료 후 자동 재개는 보장하지 않습니다.

## 9. 실행 명령

프로젝트 루트 PowerShell 기준:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-ai.txt
.\.venv\Scripts\python.exe -m src.ai_inspection.env_config
```

실제 키는 루트 `.env`의 ANTHROPIC_API_KEY에 설정합니다. 기존 환경변수가 우선하며 키 값은 출력하지 않습니다.
키를 설정하는 것만으로 API를 호출하지 않습니다.

### 실행 형식과 주요 옵션

모듈 방식과 직접 파일 실행을 모두 지원합니다. 프로젝트 루트에서의 직접 실행 예시는 다음과 같습니다.

```powershell
.\.venv\Scripts\python.exe .\src\ai_inspection\ai_inspector.py --hybrid-input "결과파일\ex_crawler\maison\crawl-results\hybrid_ai_input.jsonl" --analyze --limit 1 --output-dir "결과파일\ai_inspection\maison\hybrid_analysis"
```

입력·출력 상대 경로는 실행 파일 위치가 아닌 터미널의 현재 디렉토리 기준입니다.
--output-dir은 자동 생성합니다. .env는 현재 디렉토리가 아닌 검사 코드가 속한 프로젝트 루트에서 읽습니다.

| 옵션 | 현재 의미·기본값 |
|---|---|
| --hybrid-input | 필수 JSONL 입력 경로 |
| --output-dir | 필수 결과 저장 경로 |
| --prepare-only / --analyze / --execute | 반드시 하나 선택. 준비 / 유료 증거 분석 / 연결된 실행 |
| --limit | 입력 순서대로 선택할 최대 항목 수, 기본 1 |
| --tier | haiku / sonnet / opus, 기본 haiku. 자동 승격은 없음 |
| --model | 직접 지정한 API 모델 ID. tier 기본 모델보다 우선 |
| --max-tokens | 호출당 출력 토큰 상한, 기본 1600. 전체 비용 상한이 아님 |
| --api-timeout | API 네트워크 timeout 초, 기본 60 |
| --runtime-factory | 실행 모드의 신뢰하는 연결 모듈 module:function |
| --mcp-config | 실행 모드의 신뢰하는 로컬 설정 JSON. runtime-factory와 둘 중 하나만 지정 |
| --max-rounds | 실행 모드에서 항목당 최대 라운드, 기본 3 |
| --max-actions | 실행 모드에서 전체 행동 시도 상한, 기본 10 |
| --max-seconds | 실행 모드의 전체 경과 시간 상한, 기본 60 |

401 인증 실패 시 API 설정 출처와 키 활성 상태를 확인합니다. 기존 환경변수가 .env보다 우선하며
get_anthropic_api_key는 앞뒤 공백을 제거합니다. 키 설정 여부 확인 명령은 키 유효성까지 검증하지 않습니다.
입력 검증 오류는 API 호출 전에 발생합니다. ambiguous_interaction도 현재 지원 종류에 포함됩니다.

기존 준비 모드(API·브라우저 호출 없음):

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector --hybrid-input "결과파일\ex_crawler\crawl-results\hybrid_ai_input.jsonl" --prepare-only --limit 1 --output-dir "결과파일\ai_inspection\hybrid_prepare"
```

기존 증거 분석 모드(유료 API 호출):

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector --hybrid-input "결과파일\ex_crawler\crawl-results\hybrid_ai_input.jsonl" --analyze --limit 1 --output-dir "결과파일\ai_inspection\hybrid_analysis"
```

별도 팀 팩토리를 사용할 때의 예시(team_runtime:create는 자리표시자; 내장 --mcp-config 명령은 12번):

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector --hybrid-input "결과파일\ex_crawler\crawl-results\hybrid_ai_input.jsonl" --execute --runtime-factory team_runtime:create --limit 1 --max-rounds 3 --max-actions 10 --max-seconds 60 --output-dir "결과파일\ai_inspection\execution_001"
```

이 예시는 team_runtime 모듈을 별도로 구현해야 사용할 수 있습니다. 내장 연결부를 쓸 때는 12번 명령을 사용합니다.
--runtime-factory는 명령행에서 지정한 신뢰하는 로컬 Python 모듈이며 JSONL/페이지 값으로 import하지 않습니다.
--execute는 유료 계획 호출과 승인된 행동 실행을 허용하며 --prepare-only/--analyze와 함께 선택할 수 없습니다.
입력·출력 사전 확인 후 팩토리를 호출합니다.
선택한 실행 정상 종료는 종료 코드 0, 실행 미완료·한도·중지는 1, 잘못된 CLI·입력·경로는 2입니다.
--limit로 선택하지 않은 항목이 있다는 사실만으로 종료 코드 1이 되지는 않습니다.
라이브러리의 `run_inspection(..., stop_requested=callback)`은 호출 사이 중지를 지원합니다.
CLI의 별도 중지 파일·웹 중지 버튼은 아직 없습니다.

## 10. 검증

기본 테스트(API 과금 없음):

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection/test -t . -v
```

실제 로컬 브라우저 테스트 포함:

```powershell
$env:WEBTESTPILOT_BROWSER_TESTS = "1"
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection/test -t . -v
Remove-Item Env:WEBTESTPILOT_BROWSER_TESTS
```

검증 범위: 기존 모드 호환, 행동 이후 관찰을 다음 계획에 전달, 입력 ID·원본 보존, 후보/검토/미완료 구분,
권한 거절·미등록 요소·MCP 오류, 실행 한도·중지, 사용량 보존, 기존 탭의 관찰·촬영.
실제 MCP 서버의 로컬 접속·행동·증거·판정은 검증했습니다. 결함 탐지율·자동 재현·독립 재현용 PDF는 아직 검증하지 않았습니다.
Claude 증거 분석의 실제 호출 성공은 아래 별도 실행 기록에서 확인했습니다. 구조화된 행동 선택의 실제 호출은 미검증입니다.

### 실제 Claude 증거 분석 확인

2026-10-09 사용자가 Maison JSONL 첫 항목을 --analyze --limit 1로 실행한 저장 결과를 확인했습니다.

- 대상: 위시리스트 페이지 클릭 실패, kind는 interaction_execution_error.
- selected_count / processed_count / analyzer_calls / completed_count: 각각 1.
- error_count: 0. stop_reason: end_turn.
- 입력 598·출력 631토큰, 모델 claude-haiku-4-5-20251001.
- 결과: 가능한 원인 설명, 추가 검증 필요 true, 제안 검사 목록.
- 위치: 결과파일/ai_inspection/maison/hybrid_analysis/ai_results.jsonl 및 evidence_batch.json.

키 인증·API 응답·응답 형식 검증·사용량 저장까지 성공한 사례입니다.
후보의 실제 원인·재현·결함 여부를 증명한 결과는 아닙니다. 응답은 기존 크롤러 증거에 대한 해석입니다.

2026-10-09 확인 결과:

- AI 테스트 39개 및 기존 전처리 테스트 12개, 총 51개 통과. 로컬 브라우저 테스트도 포함했습니다.
- 공통 탭에서 실제 클릭 → 전후 관찰·이미지 → 판정·JSON 연결을 검증했습니다. MCP 디스패처와 모델은 모의 처리했습니다.
- 현재 팀 JSONL 14개 항목을 기존 준비 모드로 처리했고 API 호출 0회·오류 0개·입력 해시 동일을 확인했습니다.

이후 ambiguous_interaction 및 실제 MCP 테스트를 추가한 시점의 AI 테스트 수는 43개입니다. 전달 파일 확장 후 현재 수치는 13번에 기록합니다.
실제 MCP·로컬 브라우저 활성화 실행에서 43개 모두 통과했습니다. 기본 실행은 39개 통과·4개 건너뜀입니다.
위 51개 전체 통과는 추가 전 실행 기록입니다.
Maison 입력은 총 22개이며 --prepare-only --limit 5에서 5개 선택·오류 0·API 호출 0을 확인했습니다.

전체 회귀 테스트 명령:

```powershell
$env:WEBTESTPILOT_BROWSER_TESTS = "1"
.\.venv\Scripts\python.exe -m unittest discover -s src -t . -v
Remove-Item Env:WEBTESTPILOT_BROWSER_TESTS
```

## 11. 다음 구현 순서

1. 내장 MCP 연결부에 전처리 CDP 주소·검토된 요소·기대 조건·권한을 연결하고 실제 Claude 사례 1건 수행.
2. 테스트팀의 기대 근거·시작 조건이 있는 짧은 사례에서 실제 모델·도구 실행 검증.
3. 기록된 행동·값·시작 조건과 승인된 초기화로 추가 1회 재현.
4. 기능 발견·검사 생성·검사 범위 기록 확장.
5. 로그인·모바일·시각적 UI·상태 변경·자원 제한 연결.
6. 검증 상태가 담긴 JSON을 원본으로 단일 PDF·실패 후 보고서 재생성.

이번 단계는 실제 MCP 실행까지 연결했습니다. 자동 재현·보고서는 후속 작업입니다.

## 12. 실제 Playwright MCP 연결

### 준비 조건과 소유권

Python MCP SDK 1.30 계열, Playwright, Node.js 18 이상을 사용합니다. 서버는 `@playwright/mcp@0.0.83`으로 고정합니다.
프로젝트 루트에서 `python -m pip install -r requirements-ai.txt`로 Python 의존성을 설치합니다.
내장 연결부는 `npx.cmd -y @playwright/mcp@0.0.83`을 stdio 서버로 실행합니다. 첫 실행에는 패키지 다운로드가 필요할 수 있습니다.
앱이나 Codex 설정에 등록된 다른 MCP 세션을 재사용하는 방식은 아닙니다.

브라우저 소유자가 Chromium의 원격 디버깅을 loopback에서 제공하고, 로그인·시작 상태를 준비한 뒤 브라우저를 열어 둬야 합니다.
설정의 CDP 주소는 `http://127.0.0.1:9222`처럼 명시적 포트가 있는 로컬 HTTP 주소만 허용합니다.
현재 연결부는 기존 탭이 정확히 1개인 브라우저를 지원합니다. 시작 URL은 선택된 JSONL 항목의 url과 정확히 같아야 합니다.
현재 전처리의 일반 `chromium.launch()` 실행은 CDP 주소를 자동 제공하지 않으므로 팀 통합 진입점에서 이를 추가해야 합니다.
전처리 원본은 이번에 수정하지 않았습니다. 전처리 async 콜백에 동기 연결부를 직접 호출하는 것도 피해야 합니다.

관찰과 행동은 같은 탭에서 수행합니다. 임시 window 표식을 관찰기에서 만들고 MCP browser_evaluate로 확인한 후 즉시 삭제합니다.
초기 연결 및 매 행동 직전에 확인하므로 같은 URL의 다른 탭을 조작하는 것을 막습니다.
연결부 종료 시 MCP 서버와 관찰 클라이언트를 정리합니다. 브라우저 소유자의 browser.close()는 호출하지 않습니다.
factory 생성 중 실패해도 자체 연결을 정리하며, 런타임은 성공·실패 모두 executor.close()를 호출합니다.

### 설정 JSON

아래는 로컬 예제입니다. 운영 설정은 사람이 검토한 별도 로컬 JSON으로 작성합니다.
페이지·모델 응답·JSONL payload에서 endpoint·선택자·권한·기대 조건을 자동 가져오지 않습니다.

```json
{
  "cdp_endpoint": "http://127.0.0.1:9222",
  "controls": {"field": "#field", "save": "#save"},
  "checks": {
    "save": {"kind": "text_contains", "value": "saved:hello", "source": "requirement", "evidence_ref": "fixture:save"}
  },
  "allowed_origins": ["http://127.0.0.1:8080"],
  "permissions": {"field": ["fill", "press"], "save": ["click"]}
}
```

controls는 요소 ID→검토된 선택자, checks는 기대 조건 카탈로그, permissions는 요소별 허용 행동입니다.
빠진 요소의 행동은 거절합니다. checks의 source와 evidence_ref는 실제 요구사항 근거로 작성합니다.
allowed_origins는 초기 페이지·관찰·행동 직전 출처를 검사합니다. **네트워크 요청·POST·리다이렉트의 사전 차단은 구현하지 않았습니다.**
허용된 클릭도 서버 상태를 바꿀 수 있으므로 팀의 요청 정책·테스트 계정·복원 조건을 별도로 연결해야 합니다.

### 실행 명령

시작 탭·해당 JSONL·설정 JSON을 준비한 뒤 실행합니다. 아래 실행은 유료 Claude 행동 선택과 허용된 실제 브라우저 행동을 수행합니다.
input.jsonl과 mcp_config.json은 준비한 파일 경로로 바꿉니다. `.env`에는 기존 방식대로 키를 설정합니다.

```powershell
.\.venv\Scripts\python.exe .\src\ai_inspection\ai_inspector.py --hybrid-input "input.jsonl" --execute --mcp-config "mcp_config.json" --limit 1 --max-rounds 3 --max-actions 3 --max-seconds 60 --output-dir "결과파일\ai_inspection\mcp_execution"
```

`--analyze`는 기존 저장 증거 분석으로 유지됩니다. `--execute`에서만 MCP 연결을 생성합니다.
여러 입력 항목의 URL이 다르면 현재 factory는 다음 URL로 이동하지 않습니다. 각 항목 시작 탭 준비는 통합 계층의 책임입니다.

### 도구와 제한

| 구조화된 행동 | 실제 MCP 도구 | 입력·검증 |
|---|---|---|
| click | browser_click | target=검토된 선택자, 요소 1개·표시 상태 확인 |
| fill | browser_type | target·text, submit=false; 기존 1,000자 제한 |
| press | browser_press_key | Enter/Tab/Escape; 대상이 이미 포커스된 경우만 허용 |

AI가 JavaScript나 도구 이름을 만들지 않습니다. browser_run_code_unsafe는 사용하지 않습니다.
같은 탭 확인에만 프로그램의 고정 browser_evaluate 함수를 사용합니다.
MCP 응답 isError=false를 확인하며 실패는 미완료로 저장합니다. actions[].receipt에는 실제 tool_name을 남깁니다.
도구 응답의 전체 페이지 내용은 결과에 복사하지 않습니다. 스크린샷·본문 관찰에는 페이지 데이터가 들어갑니다.
서버 프로세스에는 API 키를 전달하지 않으며 표준 오류 원문을 결과에 저장하지 않습니다.
기본 MCP 호출 제한은 30초, 행동 제한은 5초입니다. 전체 max-seconds는 호출 사이에 확인하므로 진행 중 호출만큼 초과할 수 있습니다.

### 실제 검증과 결과 파일

외부 사이트·유료 AI 없이 로컬 HTTP 페이지와 독립 Chrome/Edge 프로필에서 검증했습니다.
실제 stdio 초기화·도구 목록 확인·CDP 접속·같은 탭 확인 → fill → Tab → click → 전후 증거 → passed → JSON 저장을 통과했습니다.
권한 거절과 종료 후 소유 브라우저 유지도 확인했습니다. 모델의 act/finish 응답은 테스트에서 고정했습니다.
테스트 위치: `src/ai_inspection/test/test_playwright_mcp_runtime.py`.

```powershell
npm.cmd install --prefix tmp/playwright_mcp @playwright/mcp@0.0.83
$env:WEBTESTPILOT_MCP_TESTS = "1"
$env:WEBTESTPILOT_BROWSER_TESTS = "1"
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection/test -t . -v
Remove-Item Env:WEBTESTPILOT_MCP_TESTS
Remove-Item Env:WEBTESTPILOT_BROWSER_TESTS
```

생성되는 파일은 기존 8번의 inspection_results.jsonl·inspection_run.json·evidence_*.png입니다.
MCP의 자동 부가 파일 경로는 출력 폴더의 mcp_artifacts/로 지정하며 버전에 따라 내용이 다를 수 있습니다.
추가 재현은 not_attempted, 보고서는 not_generated로 유지합니다. 실제 사이트·유료 Claude 행동 선택 통합은 아직 검증하지 않았습니다.

구현 계약 참고: [Playwright MCP 공식 문서](https://github.com/microsoft/playwright-mcp),
[Python MCP SDK 공식 문서](https://github.com/modelcontextprotocol/python-sdk/tree/v1.x).

## 13. 전처리팀 실행 계획 전달

### 역할과 구현 범위

전처리는 계획대로 Playwright MCP 행동이 수행됐는지 확인하고 증거를 반환합니다. 기능의 정상 여부를 판정하는 역할은 아닙니다.
`execution_plans.jsonl`에는 기대 동작·판정 조건을 넣지 않습니다. 기능 판정용 checks 카탈로그는 기존 AI 실행 경로에 별도로 존재합니다.
이번에 구현한 것은 기존 분석에서 별도 전달 파일을 만드는 오프라인 exporter입니다. 기존 분석·크롤러·MCP 실행 경로는 변경하지 않습니다.
전달 계획을 기존 `--execute`에 자동 공급하거나 전처리의 반환 파일을 자동 판정하는 연결은 아직 구현하지 않았습니다.

### 입력과 출력

입력은 원본 hybrid_ai_input.jsonl과 기존 ai_results.jsonl입니다. 원본 ID·kind·work_type을 대조하고 중복·불일치를 거절합니다.
전체 파일을 검증한 후 출력하며 입력 파일을 덮어쓰는 경로는 거절합니다. 같은 출력 폴더를 다시 쓰면 전달 파일은 갱신됩니다.
completed 분석에서 suggested_checks 또는 proposed_checks를 읽어 제안 하나당 초안 한 줄을 만듭니다.
prepared/error 분석은 계획으로 만들지 않고 execution_handoff.json의 skipped에 남깁니다.
빈 문자열 제안은 오류로 처리합니다. 분석 제안이 비어 있으면 해당 항목에서 계획을 만들지 않습니다.

| 필드 | 의미 |
|---|---|
| schema | webtestpilot.execution-plan.v1 |
| plan_id | 원본 ID·제안 필드·0 기반 순번·내용의 해시. 같은 입력이면 동일 ID, 내용·순번 변경 시 바뀜 |
| source_input_id / source_kind | 원본 JSONL 연결 |
| source_proposal | field·index·text, 원래 제안 추적 |
| url | 원본 페이지 URL, 검토 입력으로 변경하지 않음 |
| handoff_status | needs_information 또는 ready_for_handoff |
| execution_kind | additional_check 또는 reproduction; 초안의 additional_check는 미확정 기본값 |
| preconditions | 준비·복원할 시작 조건 문자열 목록 |
| steps | action·control_id·value 목록, 실행할 순서대로 최대 10개 |
| collect_evidence | 전후 스크린샷·DOM·URL, 동작 완료와 실행 오류 수집 요청 |
| missing_information | 부족한 정보. 초안은 시작 조건·행동·실행 구분 확인 필요 |

초안은 preconditions=[]·steps=[]로 생성됩니다. AI 문장을 규칙으로 해석하거나 오류 로그에서 선택자를 추출해 행동을 만들지 않습니다.
문서 확인·콘솔 점검 등 현재 click/fill/press 규격으로 표현할 수 없는 제안도 초안으로 남기고 담당자가 확인합니다.
동작 검증은 화면 변화 유무와 구분합니다. 도구 완료 여부로도 페이지 내부 처리의 성공까지 보장하지 않으며 확인 불가를 허용합니다.

### 생성 명령

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.execution_handoff --hybrid-input "결과파일\ex_crawler\maison\crawl-results\hybrid_ai_input.jsonl" --ai-results "결과파일\ai_inspection\maison\hybrid_analysis\ai_results.jsonl" --output-dir "결과파일\ai_inspection\maison\execution_handoff"
```

직접 실행은 `python .\src\ai_inspection\execution_handoff.py` 뒤에 같은 옵션을 붙이면 됩니다.
전체 저장 분석에서 생성하며 --limit는 없습니다. 유료 모델·브라우저 연결 없이 실행됩니다.
종료 코드 0은 변환 성공이며 계획 실행 준비 여부와 무관합니다. 잘못된 입력·검토 규격·경로는 종료 코드 2입니다.
생성 파일: execution_plans.jsonl, execution_handoff.json. 집계에 ready_count·needs_information_count·skipped·execution_performed=false를 남깁니다.

### 검토된 행동을 추가하는 방법

초안의 plan_id를 복사해 별도 reviewed_plans.jsonl을 작성합니다. 한 줄 예시이며 대상 ID·조건은 실제 확인한 값으로 바꿉니다.

```json
{"plan_id":"초안의 plan_id","preconditions":["원본 URL에서 확인된 동일 로그인·화면 상태를 복원"],"steps":[{"action":"click","control_id":"확인한 요소 ID","value":""}],"collect_evidence":["before_screenshot","after_screenshot","before_dom","after_dom","before_url","after_url","action_completion","execution_errors"],"execution_kind":"reproduction"}
```

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.execution_handoff --hybrid-input "결과파일\ex_crawler\maison\crawl-results\hybrid_ai_input.jsonl" --ai-results "결과파일\ai_inspection\maison\hybrid_analysis\ai_results.jsonl" --reviewed-plans "reviewed_plans.jsonl" --output-dir "결과파일\ai_inspection\maison\execution_handoff"
```

검토 파일에는 위 5개 필드만 허용합니다. 알려지지 않은·중복 plan_id, 빈 시작 조건·수집 요청, 미지원 행동을 거절합니다.
fill은 최대 1,000자, press는 Enter/Tab/Escape만 허용합니다. 비밀값을 직접 작성하지 않습니다.
검토 입력이 유효한 계획만 ready_for_handoff로 표시합니다. 나머지 초안은 그대로 남깁니다.
이 검증은 구조 검증입니다. 실제 요소 존재·권한·복원 성공은 전처리 실행 계층에서 확인해야 합니다.
재현은 동일 시작 조건의 복원이 가능할 때 지정합니다. 다른 조건의 추가 실행은 additional_check로 전달합니다.

### 전처리 반환 규격 제안 — 수신 기능은 미구현

권장 파일명은 execution_results.jsonl입니다. 아래는 합의용 구조이며 아직 코드에서 강제하거나 자동 소비하지 않습니다.

```json
{
  "schema": "webtestpilot.execution-result.v1",
  "plan_id": "전달받은 plan_id",
  "source_input_id": "원본 input_id",
  "execution_kind": "reproduction",
  "preconditions_status": "prepared",
  "execution_status": "completed",
  "actions": [
    {
      "step_index": 0,
      "target_status": "found",
      "execution_status": "completed",
      "error_type": null,
      "before": {"url": "실행 전 URL", "screenshot_ref": "증거 경로", "dom_ref": "증거 경로"},
      "after": {"url": "실행 후 URL", "screenshot_ref": "증거 경로", "dom_ref": "증거 경로"}
    }
  ]
}
```

시작 조건은 prepared/not_prepared/unknown, 대상 확인은 found/not_found/ambiguous/unknown,
행동은 completed/failed/unknown/not_attempted로 구분하는 것을 권장합니다.
시작 조건 복원 실패·대상 불명확·도구 오류를 기능 결함 판정으로 바꾸지 않습니다.
증거가 없으면 경로 대신 null과 누락 사유를 남기는 방식으로 팀과 합의해야 합니다.

### 검증 기록

전달 테스트 4개 추가: 원본 보존·초안에서 행동 미생성·기대 동작 미포함·ID 안정성,
선택한 검토 계획만 준비 상태 변경, 미지원 행동 거절·기존 출력 보존, 두 분석 유형·미완료 제외, 원본 불일치·덮어쓰기 거절.
현재 기본 AI 테스트 47개 중 43개 통과·브라우저/MCP 선택 테스트 4개 건너뜀입니다.
2026-10-09 저장된 Maison 분석 5건에서 초안 33건 생성, ready 0건·needs_information 33건을 확인했습니다.
이 작업에서 실제 사이트·MCP·유료 AI는 호출하지 않았습니다. 전처리팀이 실행한 결과도 아직 수신하지 않았습니다.

## 14. 역할별 디렉토리 정리 (2026-10-13)

기존 구현 9개를 analysis/·execution/·handoff/·providers/로 이동했습니다.
루트의 기존 파일은 동일 구현 모듈로 연결하는 호환 진입점입니다. 기존 CLI·import·mock patch 경로를 유지합니다.
.env 기준 경로와 전달 모듈 직접 실행의 sys.path를 이동 깊이에 맞췄습니다.
judgment/는 신규 판정 개발용 기반이며 아직 판정 구현은 없습니다. 기존 test/는 사용자 분류대로 보존합니다.
새 기능 테스트는 각 패키지의 별도 test/에 작성하고 전체 검색은 -s src/ai_inspection -t .를 사용합니다.
정확한 파일 구성과 실행 명령은 [패키지 README](../../src/ai_inspection/README.md)에 있습니다.

이동 후 로컬 브라우저·실제 MCP를 포함한 AI 테스트 47개와 동기화 스크립트 테스트 3개가 모두 통과했습니다.
9개 기존 모듈과 정규 모듈이 동일 객체인 점, 프로젝트 루트 설정 경로, 기존·새 직접 실행과 모듈 CLI도 확인했습니다.
동기화 스크립트는 하위 Python 파일과 패키지 Markdown 문서를 함께 복사하도록 갱신했습니다. 실제 복사·커밋·푸시는 수행하지 않았습니다.

## 15. 독립 판정 모듈 (2026-10-13)

judgment/에 judge_input/2의 고정 계약·합성 예시·입력/응답 검증·이미지 읽기·독립 프롬프트·주입 모델 경계를 구현했습니다.
모의 응답을 검증하는 별도 CLI와 결과 저장을 제공하며 유료 호출 옵션은 아직 없습니다.
전처리팀의 실제 모델 전송 계층·한도·취소·실제 tool_use ID를 연결하는 어댑터는 후속입니다.
[판정 모듈 개발 문서](AI_JUDGMENT_MODULE.md)와 [작업 폴더 README](../../src/ai_inspection/judgment/README.md)에 상세 계약·명령·한계를 기록했습니다.
기존 루트 test/의 위치는 유지하고 새 테스트는 judgment/test/에 작성했습니다.
기본 전체 54개 중 50개 통과·선택 4개 건너뜀, 동기화 3개 통과를 확인했습니다.

## 16. 통합 판정 연결·입문 안내 (2026-10-13)

별도 WebTestPilot-integration worktree의 staged.py 판정 구간에 judgment_bridge.py·제품용 judgment/를 연결했습니다.
원본은 src/ai_inspection/judgment/이며 scripts/sync_judgment_integration.py로 파일과 해시를 반영합니다.
비동기 async_adapter는 기존 _call/_exchange·한도·취소·사용량·실제 tool_use_id를 유지합니다.
새 통합 테스트는 integration/test/에 작성하고 원본 테스트는 judgment/test/에 유지합니다.
원본 기본 테스트 59개 중 55개 통과·선택 4개 건너뜀, 동기화 5개·새 통합 5개 통과를 확인했습니다.
기존 통합 회귀 테스트 6개 모듈도 로컬 MCP·모의 모델로 통과했습니다.
보관 데모의 normal은 passed, broken은 candidate → 기존 1회 재현 → confirmed로 기록됐습니다.
이는 모의 판정 기반 연결 검증이며 외부 사이트·유료 모델·실제 AI 정확도 평가가 아닙니다.
[처음 보는 개발자를 위한 전체 파이프라인 문서](PROJECT_PIPELINE_GUIDE.md)에 폴더 역할·실행 명령·결과 읽는 순서를 정리했습니다.
