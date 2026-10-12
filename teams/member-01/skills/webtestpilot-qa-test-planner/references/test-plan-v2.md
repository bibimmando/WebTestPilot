# 현재 test_plan/2 연결 규격

WebTestPilot `integration/plan_contract.py`와 `integration/staged.py`의 계획 작성 계약을 정리한 참고 자료다.
호출 시 제공되는 최신 도구 스키마와 권한·한도가 변경되면 그 내용을 우선한다.

## 모델이 반환할 객체

`qa_test_plan`의 인자는 다음 다섯 필드만 가진다.

| 필드 | 형식 | 목적 |
|---|---|---|
| page_summary | string | 관측한 페이지 기능 요약 |
| proposed_checks | string[] | 검사 제안, 현재 최대 10개 |
| open_questions | string[] | 기대 결과·준비 상태 등 미확인 사항, 현재 최대 10개 |
| scenarios | object[] | 실행 가능한 계획, 현재 최대 10개 |
| unplanned | object[] | 실행 계획으로 만들 수 없는 제안과 사유, 현재 최대 10개 |

최대 개수는 계약의 상한이다. 매번 같은 개수를 생성하거나 상한까지 채울 필요는 없다.
모델은 `schema_version`, `initial_snapshot_id`를 출력에 추가하지 않는다.
프로그램이 계획 검증 후 저장할 때 이 두 필드를 추가한다.

## scenarios 항목

| 필드 | 규칙 |
|---|---|
| scenario_id | 중복 없는 영문·숫자·밑줄·하이픈 ID, 1~64자 |
| proposal_index | proposed_checks의 0부터 시작하는 인덱스 |
| title | 비어 있지 않은 검사 제목 |
| family | functional / input_validation / routing / ui |
| expected | 실행 전에 정한 관측 가능한 기대 결과 |
| expected_source | 제공된 요구사항, 관측된 UI 또는 잠정적 추정이라는 근거 설명 |
| steps | 아래 동작 객체의 배열. 시나리오별 최대 20단계 |

현재 규격에 별도의 `preconditions`, `priority`, `step_expected`, `postconditions` 필드는 없다.
필요한 준비는 `steps`에 포함하고 확인할 중간·최종 상태는 `expected`에 명시한다.
UI 시나리오는 현재 화면 검사 목적일 때 빈 steps가 가능하며, 실행 단계가 실제 viewport 이미지를 수집한다.
그 외 유형에는 한 단계 이상이 필요하다.

## 허용 동작

| operation | 필수 값 | 선택 값 |
|---|---|---|
| click | element_key 또는 target_description | wait_ms |
| fill | element_key 또는 target_description, value | wait_ms |
| press | element_key 또는 target_description, value | wait_ms |
| navigate | url | wait_ms |

- `element_key`: 최초 `observation.controls`에 포함된 사용 가능한 키만 사용한다.
- `target_description`: 이전 동작 후 등장할 대상의 역할, 접근 가능한 이름, 등장 상태를 설명한다. 실행 AI가 현재 관측된 요소에 연결한다.
- `navigate.url`: 최초 `observation.links`에서 관측한 동일 origin URL만 사용한다. 목적지를 추정해 작성하지 않는다.
- `press.value`: 현재 `Enter`, `Tab`, `Escape`, `ArrowUp`, `ArrowDown`만 허용된다. Escape도 value가 필요하다.
- `fill.value`: 입력할 구체적인 문자열을 지정한다. 빈 값은 빈 문자열이다.
- `wait_ms`: 선택적인 0~3000 정수. 임의의 긴 대기로 기대 결과를 대신하지 않는다.
- 현재 password/file 컨트롤은 금지되어 있다. 후속 대상 설명으로 이 제한을 우회하지 않는다.
- 다른 operation에 속하는 필드와 추가 임의 필드를 넣지 않는다.
- 모든 시나리오의 steps 합계는 호출의 `limits.max_actions` 이하여야 한다.
- 상태를 바꾸는 검사는 호출에서 허용한 범위에 맞춘다.

## 제안 연결과 미계획 항목

각 proposed_checks 인덱스는 하나 이상의 scenarios 또는 한 개의 unplanned에 연결한다.
같은 인덱스를 시나리오와 unplanned에 동시에 넣지 않는다.
unplanned는 `proposal_index`, 비어 있지 않은 `reason`만 가진다.
대상 미관측, 기대 결과 미확인, 필요한 권한·준비 상태·도구 부족 등의 구체적인 이유를 남긴다.

## 입력 검증 시나리오 예시

아래 예시는 최초 관측에 `email-demo`, `submit-demo`라는 키를 가진 이메일 폼이 있고,
화면에 이메일 형식 검사 안내와 제출 버튼이 있는 경우에만 성립한다.
실제 계획에서는 해당 페이지에 관측된 키·안내·조건으로 작성한다.

```json
{
  "page_summary": "이메일 입력과 제출 기능을 가진 폼이다.",
  "proposed_checks": ["잘못된 이메일 형식을 제출했을 때 검증 상태와 사용자 안내를 확인한다."],
  "open_questions": [],
  "scenarios": [
    {
      "scenario_id": "IV-001",
      "proposal_index": 0,
      "title": "잘못된 이메일 입력 후 검증과 오류 안내 확인",
      "family": "input_validation",
      "expected": "제출 후 이메일 형식 오류가 관찰되고 사용자가 입력을 수정할 수 있는 안내가 제공된다. 안내는 페이지 메시지 또는 브라우저 기본 안내일 수 있다. 필드 검증 상태, 동작 전후 화면, 관측된 요청·응답을 함께 확인하며 서버 처리 여부는 수집된 근거로만 확인한다.",
      "expected_source": "관측된 이메일 필드 타입과 화면의 이메일 형식 검사 안내에 근거한다.",
      "steps": [
        {"operation": "fill", "element_key": "email-demo", "value": "not-an-email"},
        {"operation": "click", "element_key": "submit-demo"}
      ]
    }
  ],
  "unplanned": []
}
```

기능 검사는 옵션 선택 후 실제 결과까지 이어지도록 작성한다.
후속 화면의 컨트롤이 최초 관측에 없으면 예를 들어 `target_description`에
"정렬 메뉴를 연 뒤 표시되는 옵션 중 이름이 가격 낮은 순인 항목"처럼 현재 증거로 설명할 수 있는 대상을 기술한다.
UI 검사는 기대 결과에 가림·잘림·정보 전달 문제를 구체화하고, 제공되지 않은 디자인 수치를 기준으로 만들지 않는다.
