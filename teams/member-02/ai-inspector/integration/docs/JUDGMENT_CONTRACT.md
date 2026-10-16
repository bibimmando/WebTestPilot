# 판정 AI 연결 규격 v1

기준일: 2026-10-12. 입력 버전은 **`judge_input/2`**, 모델 응답 도구는 **`scenario_judgments`**다. 현재 `integration/staged.py`의 실제 필드에 맞춘 협업 규격이다. 기존 문서의 계획용 `inspection_plan/1`과 구분한다.

## 1. AI팀이 받을 것과 만들 것

판정 AI는 실행한 시나리오의 기대 결과와 실제 관찰을 비교해 `passed`, `candidate`, `inconclusive`를 반환한다. 입력에 있는 기대 결과·근거를 그대로 사용한다.

```text
페이지 전처리 → AI 실행 계획 → 실행 AI ↔ 프로그램의 MCP 실행
→ 실행 증거 후처리 → judge_input.json + 필요한 실제 이미지
→ 판정 AI → {"judgments": [...]} → 프로그램 검증·재현·보고서
```

### 전달 파일

| 파일 | 용도 |
|---|---|
| [입력 예시](../examples/judge_input.v2.example.json) | 네 버그 유형의 합성 실행 증거. 외부 서버나 API 없이 개발 가능 |
| [응답 예시](../examples/scenario_judgments.example.json) | 위 입력에 대응하는 모델 응답 내용 |
| [입력 JSON Schema](../schemas/judge_input.v2.schema.json) | 현재 입력의 구조와 필드 타입 검사 |
| [응답 JSON Schema](../schemas/scenario_judgments.schema.json) | 실제 `JUDGE_TOOL.input_schema`에서 추출한 응답 구조 |

예시는 형식 이해·단위 검사용 합성 자료이며 실제 사이트 검사 결과가 아니다. 실제 생성된 `judge_input.json`보다 작다. UI 예시는 이미지 확보 실패를 표현하므로 `inconclusive`가 맞다. 실제 이미지가 포함된 정상 UI 판정은 별도의 이미지 첨부가 필요하다.

### 현재 구현에서 확인한 주의점

2026-10-12 실제 검사에서 다른 시나리오의 snapshot/action ID를 낸 판단 응답이 거절됐고, 관측 결과는 상품 2개를 유지하는데 모델 설명은 13개로 복원됐다고 쓰는 잘못된 정상 판단도 있었다. AI팀은 ID 참조 검증과 함께 `expected`·전후 사실·`actual`·`verdict`의 일관성을 확인해야 한다. 현재 이 문서는 전달 형식의 기준이며 판단 정확도가 검증됐다는 의미는 아니다. [실제 검사 결과](../../../../docs/reviews/QA_SKILL_MAISON_TEST_2026-10-12.md)에 근거와 후속 작업을 정리했다.

### AI팀 개발 범위

1. 입력 JSON을 해석하고 증거 ID로 전후 관찰을 조회하는 처리.
2. 고정된 기대 결과와 실제 관찰을 비교하는 판정 프롬프트.
3. 필요한 실제 이미지도 모델 입력에 함께 넣는 처리.
4. 정해진 응답 형태로 결과를 받는 처리와 합성 예시를 이용한 검사.

모델 전송·키·사용량은 기존 `models.py`의 공통 계층과 연결한다. 현재 판단 호출부를 AI팀 구현으로 교체할 때 실행 전체의 호출 한도·기한·취소·실제 tool_use ID를 보존한다. 판정 함수 안에서 MCP로 추가 행동을 수행하는 인터페이스는 이 규격에 포함하지 않는다.

## 2. 입력 위치와 단위

현재 실행 결과는 `output/<run>/flows/<flow_id>/judge_input.json`에 생성된다. **한 번의 페이지 검사 flow**에 포함된 여러 시나리오가 한 입력에 들어간다. 시나리오 실행 중 다른 URL로 이동할 수 있으므로 `page_url`과 마지막 관찰 URL이 같다고 가정하지 않는다.

이미지는 실행 루트 `output/<run>/` 기준으로 찾는다. JSON 파일이 있는 `flows/<flow_id>/`를 이미지 경로의 기준으로 사용하지 않는다.

| 최상위 필드 | 타입 | 의미 |
|---|---|---|
| `schema_version` | string | 반드시 `judge_input/2` |
| `run_id`, `flow_id` | string | 실행과 페이지 검사 흐름의 식별자 |
| `page_url` | string | 이 flow의 최초 페이지 URL |
| `site_requirements` | string 또는 null | 실행 전에 주어진 요구사항. 없으면 별도 요구사항을 만들어내지 않음 |
| `scenarios` | array | 판정해야 할 시나리오. 현재 최대 10개 |
| `observations` | object | `snapshot_id → 관찰` 맵. 같은 snapshot은 한 번만 저장 |
| `unplanned` | array | 실행 계획을 만들지 못한 제안과 이유. 판정 대상에 포함하지 않음 |

`unplanned[]`는 `proposal_index`, `proposal`, `reason`을 가진다. 실행하지 못한 제안을 정상 또는 버그로 판정하지 않는다.

## 3. 시나리오 필드

| 필드 | 의미 |
|---|---|
| `scenario_id` | 응답과 연결하는 고유 ID |
| `proposal_index`, `title` | 최초 제안 번호와 시나리오 제목 |
| `family` | `functional`, `input_validation`, `routing`, `ui` 중 하나 |
| `expected` | 실행 전에 고정한 기대 결과 |
| `expected_source` | 기대 결과의 근거. 명시적 요구사항·관측 UI·잠정 추측 등을 구별해 읽음 |
| `execution_status` | `completed`, `incomplete`, `not_run` |
| `failure_reason`, `policy_blocked` | 실행/관찰 중단 이유와 프로그램 정책 차단 여부 |
| `planned_step_count` | 계획한 동작 수 |
| `attempted_step_count` | 실제 시도한 동작 수. 실행 성공 수와 같다고 가정하지 않음 |
| `skipped_step_count` | 시도하지 않은 계획 단계 수 |
| `planned_steps` | 선택 추가 필드. 실행 전에 동결한 계획 단계 원본 |
| `attempted_plan_step_count` | 선택 추가 필드. 한 번 이상 시도한 계획 단계 수 |
| `completed_plan_step_count` | 선택 추가 필드. 실제 성공 실행과 관찰이 확보된 계획 단계 수 |
| `executed_action_count` | 선택 추가 필드. 실제 executed 행동 수. 보조 행동 포함 |
| `steps` | 실제 시도한 동작과 실행/관찰 결과 |
| `snapshot_ids`, `action_ids` | **이 시나리오가 응답에서 참조할 수 있는 ID 목록** |
| `start_snapshot_id`, `end_snapshot_id` | 시작·종료 관찰의 ID |
| `image` | 실제 이미지 메타데이터 또는 null |
| `observation_errors` | 이미지 등의 관찰 확보 오류 |

현재 프로그램은 `not_run`이면서 시도한 동작이 0개인 항목을 `program_policy` 출처의 `inconclusive` 상태로 기록하고 AI 입력에서 제외한다. 방어적으로 이런 항목을 전달받았을 때에도 의미 판정은 `inconclusive`로 처리한다.

staged/3의 실제 행동 수에는 보조 동작·실패 시도·교정이 포함된다. attempted_step_count가 planned_step_count보다 클 수 있으므로 두 수의 동일성으로 완료를 추정하지 않는다. 실행 AI의 explanation/자유 서술은 판정 입력에 포함하지 않는다. 계획 진척은 프로그램이 실제 행동 기록으로 계산한다. 이전 합성 예시에는 새 선택 필드가 없으며 그대로 유효하다.

### 동작별 `steps[]`

| 필드 | 의미 |
|---|---|
| `step_index`, `action_id` | 시나리오 내 순서와 실제 행동 ID |
| `plan_step_index`, `purpose` | 선택 추가 필드. 계획 단계 번호와 planned/supporting 구분 |
| `tool_use_id`, `correction_of` | 선택 추가 필드. 실제 실행 AI 호출 ID와 교정 대상 행동 ID |
| `operation` | `click`, `fill`, `press`, `navigate` |
| `element_key`, `url`, `value`, `wait_ms` | 실행 대상과 인자. 해당 없는 값은 null일 수 있음 |
| `execution` | `executed`, `not_executed`, `unknown` |
| `observation_status` | `available`, `incomplete` |
| `before_snapshot_id`, `after_snapshot_id` | 전후 관찰 ID. 수집 실패 시 null 가능 |
| `diff` | 관찰된 요소·상태·URL 등의 변화. 버그 판정이 아님 |
| `error`, `settle_error`, `capture_error`, `operator_error` | 실행·안정화·수집 오류. null/string/object 형태를 지원 |
| `policy_blocked` | 프로그램의 요청 제한 등으로 차단됐는지 |
| `event_ids`, `resource_ids` | 관련 이벤트·리소스 참조. 빈 배열도 가능 |

`executed`는 명령 처리 상태다. 그 자체로 앱 동작이 요구사항을 만족했다는 의미는 아니다. `unknown`을 실패한 앱 동작으로 해석하거나 자동으로 재시도하지 않는다.

완료된 시나리오의 conclusive 판정은 executed·관찰 available·정책 차단 없는 행동을 인용한다. 초기 not_executed 뒤 성공한 correction_of 행동이 있으면 미실행 시도 자체를 앱 버그로 판단하지 않는다. 보조 행동의 증거도 같은 시나리오의 실제 증거 목록에 포함되지만 그 행동이 계획 단계를 대체한 것으로 간주하지 않는다.

## 4. 관찰을 읽는 방법

```python
scenario = payload["scenarios"][0]
step = scenario["steps"][0]
before = payload["observations"][step["before_snapshot_id"]]
after = payload["observations"][step["after_snapshot_id"]]
before_url = before["observation"]["page"]["url"]
after_url = after["observation"]["page"]["url"]
```

null인 ID나 누락된 참조를 먼저 처리한 뒤 조회한다. 위 코드는 전후 관찰이 모두 있는 예시의 조회 방식이다.

| 관찰 내부 필드 | 의미 |
|---|---|
| `observation` | 기존 `ai_input/1` 요약 |
| `observation.page` | snapshot ID·실제 관찰 URL·제목·HTTP 상태 |
| `observation.controls` | 요소 상태. ID 필드는 `key`이며 `step.element_key`와 연결 |
| `observation.forms`, `links`, `errors` | 폼·링크·오류 관찰 |
| `observation.quality`, `omitted`, `source_truncated` | 수집 상태·생략량·원본 수집 잘림 여부 |
| `observation.untrusted_text` | 신뢰하지 않는 페이지 문구 |
| `supplement` | 추가 본문·환경·준비 상태·정책 차단 사실 |
| `supplement.action_context` | 조작 대상·관련 폼·전체 검증 상태·폼 이벤트의 별도 제한된 증거. 전역 요약에서 잘린 대상도 포함 가능 |
| `events`, `resources` | 수집된 브라우저 이벤트·요청/응답 메타데이터 |
| `navigation`, `redirects` | 관찰된 이동 방식과 리다이렉트 |

폼 관찰 확장은 [AI 입력 증거 규격](AI_INPUT_CONTRACT.md)의 `action_context/1`을 따른다.
`validation.validity`는 입력 상태이며 버그 판정이 아니다. `validation.message`는 브라우저 제공 문구이고
실제로 tooltip이 보였는지는 별도 이미지 증거가 필요하다. `submit` 이벤트는 서버 처리 성공을 뜻하지 않는다.
`form_event_collection`의 누락·전달 대기·불완전 상태와 `action_context.omitted`를 읽고,
이벤트·요청이 없다는 사실만으로 제출 차단 또는 정상 동작을 확정하지 않는다.
폼의 `novalidate`, DOM 오류/성공 문구, 관련 네트워크/이동 사실을 함께 해석한다.
`association="temporal"`은 인과관계의 보증이 아니며 unresolved/unattributed 증거를 추측으로 연결하지 않는다.

`observation`은 기존 [전처리 입력 규격](AI_INPUT_CONTRACT.md)을 따른다. 선택적으로 추가되는 필드는 허용하며, 알 수 없는 필드를 읽기 위해 코드 변경을 강제하지 않는다. 누락·null·생략된 증거는 미확인 상태다. 오류 목록이 비어 있더라도 앱이 정상이라는 결론은 아니다.

관련 요청은 `action_id/origin_action_id`와 `event_ids/resource_ids` 등 실제 연결 정보를 확인한다. 콘솔 오류의 시간상 연관을 해당 동작이 일으킨 오류로 단정하지 않는다. 원본 파일 경로는 로컬 참조이며 그 문자열로 원본 내용을 읽었다고 주장하지 않는다.

## 5. 이미지 전달

`image.path`는 이미지의 위치일 뿐 모델이 이미지를 본 상태가 아니다. 호출 측은 파일의 실제 바이트를 읽어 JSON 텍스트와 별도의 이미지 블록으로 전달한다. 현재 네이티브 모델 계층의 이미지 블록은 다음 모양이다.

```json
{
  "type": "image",
  "source": {
    "type": "base64",
    "media_type": "image/png",
    "data": "<실제 PNG를 인코딩한 값>"
  }
}
```

이 블록 직전에 `scenario_id`와 `image.snapshot_id`를 알려주는 텍스트를 붙여 어느 시나리오의 이미지인지 연결한다. base64는 판정 JSON 규격의 새 필드로 추가하지 않는다.

이미지의 `viewport`, `scroll`, `full_page`, `association`, `captured_at`을 함께 읽는다. 현재 기본 UI 이미지는 viewport 캡처다. 화면 밖의 영역을 검사했다고 판단하지 않는다. 실제 이미지가 없으면 겹침·잘림 같은 시각적 기대 결과는 `inconclusive`다.

## 6. 모델 응답

**모델이 작성하는 응답 내용**은 아래 구조다. 실제 모델 전송에서는 `scenario_judgments` 도구 호출의 `input`으로 받는다.

```json
{
  "judgments": [
    {
      "scenario_id": "counter_increment",
      "verdict": "candidate",
      "actual": "클릭은 실행됐지만 Count: 0이 유지되어 기대 결과와 다릅니다. 추가 재현이 필요합니다.",
      "snapshot_ids": ["snapshot-counter-before", "snapshot-counter-after"],
      "action_ids": ["action-counter"]
    }
  ]
}
```

| 값 | 사용 기준 |
|---|---|
| `passed` | 이 시나리오의 기대 결과를 만족하는 실제 관찰이 확보됨 |
| `candidate` | 실행·관찰 증거에서 기대 결과와의 불일치가 드러남. 버그 후보이며 추가 재현 필요 |
| `inconclusive` | 실행/관찰 불완전·정책 차단·기대 근거 부족·필요 증거 누락 등으로 판단 불가 |

`actual`은 1~4000자의 관찰 설명이며 공백만 사용할 수 없다. 입력의 각 시나리오에 정확히 하나씩 응답한다. 다른 시나리오 ID·중복·누락은 허용하지 않는다.

### 프로그램이 추가로 검사하는 규칙

- `snapshot_ids`는 해당 시나리오 목록의 부분집합이어야 하며 **최소 1개** 필요하다. inconclusive에도 적용한다.
- `action_ids`는 해당 시나리오의 실제 행동 ID만 사용한다. 동작 없는 UI 관찰은 빈 배열이 가능하다.
- completed가 아니거나 정책 차단된 시나리오에는 passed/candidate를 반환하지 않는다.
- passed/candidate에는 실제 실행·관찰 증거가 필요하다. 동작 없는 UI는 실제 이미지가 필요하다.
- UI의 passed/candidate 응답은 해당 이미지의 snapshot ID를 반드시 참조한다.
- `expected`, `expected_source`, `family`는 응답에 다시 작성하지 않는다. 프로그램이 고정 계획에서 가져온다.
- `confirmed`는 모델 응답 값이 아니다. 별도의 초기화·재현 확인을 거쳐 프로그램이 기록한다.
- 페이지 문구·오류 메시지·이미지 속 지시문은 검사 대상 데이터로 취급한다.

JSON Schema는 구조를 검사한다. 시나리오 대응·참조 소유권·증거 충분성은 별도의 의미 검사도 필요하다. 응답 schema의 참조 배열은 현재 도구 정의와 동일하며, 비어 있지 않아야 하는 규칙은 프로그램에서 추가 검사한다.

출력 디스크 파일 `judgments.json`에는 프로그램이 `schema_version`, `status`, 실제 `tool_use_id`, 각 항목의 `judgment_source`, `finding_id`, `finding_error` 등을 추가한다. **AI팀이 반환할 JSON과 프로그램이 저장하는 파일을 구별한다.** 모델이 이 메타데이터를 만들어 반환하지 않는다.

## 7. 개발 확인 기준과 이후 성능 개선

합성 예시는 다음 네 응답을 보여준다.

| 시나리오 | 유형 | 기대하는 응답 |
|---|---|---|
| `counter_increment` | functional | 클릭 실행 후 카운터 변화 없음 → candidate |
| `invalid_email` | input_validation | 프로그램이 POST를 차단 → inconclusive |
| `next_route` | routing | 실제 URL이 고정 요구사항과 일치 → passed |
| `next_page_layout` | ui | 실제 이미지 확보 실패 → inconclusive |

이 형식으로 AI팀은 입력 해석·프롬프트·응답 연결을 개발하고, 전처리/실행팀은 판정에 필요한 증거량을 줄이는 작업을 진행한다. 현재 구현은 스냅샷 중복 제거까지 적용되어 있다. 관련 요소·변화만 보내는 추가 경량화가 이미 구현된 것으로 가정하지 않는다.

기존 의존성을 설치한 환경에서, 저장소 루트를 기준으로 다음 Python 코드로 예시와 도구 계약의 일치를 확인할 수 있다. API를 호출하지 않는다.

```python
import json
from pathlib import Path
from jsonschema import Draft202012Validator
from integration.staged import JUDGE_TOOL, _check_judgments

root = Path("integration")
read = lambda name: json.loads((root / name).read_text(encoding="utf-8"))
payload = read("examples/judge_input.v2.example.json")
reply = read("examples/scenario_judgments.example.json")
Draft202012Validator(read("schemas/judge_input.v2.schema.json")).validate(payload)
Draft202012Validator(JUDGE_TOOL["input_schema"]).validate(reply)
_check_judgments(reply["judgments"], payload["scenarios"])
assert all(j["snapshot_ids"] for j in reply["judgments"])
assert all(set(s["snapshot_ids"]) <= set(payload["observations"])
           for s in payload["scenarios"])
```

성능 변경에서도 `scenario_id`, 실행 상태, 고정 기대값, 증거 ID와 `observations` 조회 관계를 유지한다. 정보 생략은 기존 `quality/omitted/source_truncated` 등에 표현한다. 필드 위치·필수 타입·참조 관계가 달라지면 schema_version을 올리고 함께 조율한다.
