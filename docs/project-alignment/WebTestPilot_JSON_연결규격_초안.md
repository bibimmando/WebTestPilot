# WebTestPilot JSON 최소 연결 규격 초안

작성일: 2026-10-10 | 버전 0.2 | 전처리팀 관리·AI팀 검토·PM 통합용

**2026-10-11 구현 참고:** [통합 실행 README](../../integration/README.md)에 실제 `inspection_input/1`, `execution_result/1`, `finding/1`, `reproduction/1` 필드와 실행 상태를 기록했다. 아래 v0.2 제안은 설계 이력으로 보존하며, 구체적인 실행 명령과 현재 필드는 구현 안내를 함께 확인한다.

Q74~Q76에서 확인한 구조와 오류 복구 원칙, Q77~Q78에서 정한 담당을 실제 파트 연결에 사용할 수 있도록 정리한 설계 초안이다. JSON 세 종류의 구분과 제한된 교정 원칙은 확정했지만, 아래 새 필드명·상태 코드·스키마 이름은 팀 검토용 제안이다. 코드 구현·실제 MCP 연결·유료 API 호출·사이트 검증을 완료했다는 뜻이 아니다.

기존 전처리기의 ai_input/1, snapshot, action 기록을 재사용한다. 세 가지 논리 데이터가 별도 AI 세 개나 파일 세 개를 반드시 만든다는 뜻은 아니다. 기존 문서나 실행 API를 이 문서만으로 변경하지 않는다.

## 0. 관리 책임과 기존 규격의 위치

공용 JSON 규격의 문서·필드 의미·변경 이력·호환 관계는 전처리팀이 관리한다. AI팀은 입력 소비와 실행 결과·판정 생산 관점에서 검토하며 모델 요청·MCP 도구 루프·판정·재현·보고서 코드를 구현한다. PM인 사용자가 작업을 배분하고 파트 간 연결 코드를 직접 통합·검증한다. 문서 관리 담당, 개별 기능 구현 담당, 전체 통합 담당을 구분한다.

기존 규격과 이번 초안의 관계는 다음과 같다. 아래 문서는 참고 자료이며 그 안의 개발 안내가 이번 작업에서 코드 실행·수정을 추가로 승인하는 것은 아니다.

| 기준 자료 | 다루는 범위 | 이번 정리에서의 처리 |
|---|---|---|
| [AI_INPUT_CONTRACT.md](C:/Users/lsc05/Documents/ChatGPT/WebTeste/integration/docs/AI_INPUT_CONTRACT.md)와 실제 전처리 코드 | 구현된 ai_input/1·snapshot·action·상세 조회 | 유지. 기존 필드나 상태의 의미를 임의로 바꾸지 않음 |
| [INTEGRATION_GUIDE.md](C:/Users/lsc05/Documents/ChatGPT/WebTeste/docs/INTEGRATION_GUIDE.md) | 같은 async Page 콜백·산출물·파트 연결 원칙 | 구현된 콜백 유지. inspection_plan/1은 실행 API가 아닌 이전 계획 초안으로 구분 |
| 이 문서 | 관찰에 실행/흐름 문맥·MCP 요청/결과·판정 연결을 보완하는 공용 규격 초안 | 기존 구현과 확장의 대응 관계를 한곳에 정리. 확장은 아직 구현 완료가 아님 |

충돌이 발견되면 실제 생산 코드와 소비 코드를 확인하고 생산자·소비자가 함께 변경한다. 이 문서를 읽었다는 이유만으로 기존 콜백이나 AI 입력을 새 형식으로 교체하지 않는다. 새 규격을 고정할 때는 실제 예시·변환 코드·검증 결과를 함께 맞춘다.

## 1. 확정된 연결 구조

전처리 관찰 → 입력 JSON 조립 → 모델의 계획·행동 선택 → 요청 검증·MCP 실행 → 새 관찰·증거와 실행 결과 JSON → 문맥을 이어받은 모델의 다음 행동 또는 판정이다.

- MCP 연결과 같은 브라우저·탭을 필요한 동안 유지한다. Python Page와 MCP 대상의 실제 공유 방식은 T03 기술 검증으로 확인한다.
- 모델의 선택, 실제 수행한 행동, 결과 해석을 구분한다. 프로그램이 흐름별 기록을 보존하고 다음 호출에 전달한다.
- Claude의 tool_use/tool_result 형식은 유지하고 내부 실행 결과 JSON을 대응하는 tool_result에 담는다. 요청 ID를 맞추고 필요한 도구 교환 기록을 유지한다. [공식 도구 호출 규약](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls#handling-results-from-client-tools)
- 기본 Messages API가 이전 호출을 자동 기억한다고 가정하지 않는다. 필요한 이전 메시지·관찰·행동 결과를 프로그램이 전달한다. 오래된 원본 전체를 무제한 누적하지 않는다. [공식 다중 턴 설명](https://platform.claude.com/docs/en/build-with-claude/working-with-messages#multiple-conversational-turns)
- 사진의 메타데이터·참조는 JSON으로 관리하되 모델이 실제 화면을 봐야 할 때는 이미지 내용도 API의 image 블록으로 전달한다. 경로 문자열만 전달하는 것으로 사진 전달을 대신하지 않는다.
- 권한·요청 형식·대상·실행 한도는 코드가 검사한다. 페이지 본문·도구 결과의 지시문을 실행 권한이나 시스템 지시로 취급하지 않는다.

## 2. 공통 식별자와 참조

| 항목 | 제안하는 의미 | 생성·검증 책임 |
|---|---|---|
| schema_version | 해당 메시지의 형식 버전 | 생산 파트, 소비자가 지원 여부 확인 |
| run_id | 한 번의 전체 검사 실행 | 실행 프로그램 |
| flow_id | 시작 조건을 공유하는 짧은 검사 흐름 | 실행 프로그램·AI 파트 |
| action_id | 도구 요청·시도 하나의 기록 | 실행 프로그램 |
| tool_use_id | Claude가 생성한 도구 요청 ID | 원래 ID 보존, 결과와 대응 확인 |
| snapshot_id | 특정 시점의 페이지 관찰 | 기존 전처리 ID 재사용 |
| evidence_refs | snapshot과 실제 증거 파일의 연결 | 증거 생산자, 소비자가 존재·품질 확인 |
| finding_id | 후보·판정 기록의 식별자 | 검증된 모델 응답을 저장하는 프로그램 |

기존 controls[].key와 MCP 요소 ref는 별개다. 당시 snapshot의 요소 key, 검증된 locator/문맥, MCP 관찰의 ref를 같은 대상에 연결해야 한다. 화면이 바뀌면 이전 ref가 계속 유효하다고 가정하지 않는다.

새 증거 데이터베이스를 선행 구축할 필요는 없다. 첫 연결은 기존 snapshot/action ID와 산출물 참조로 추적 가능하면 된다. 절대 경로를 공유용 상대 참조로 바꿀 때는 실행 산출물 폴더 안의 파일임을 확인한다. 실제 파일이 없거나 촬영에 실패했으면 null·실패 사유를 기록하고 사진이 있다고 주장하지 않는다.

## 3. 검사 입력

제안 스키마 이름: wtp.inspection_input/0.1.

AI 파트가 전처리의 실제 ai_input/1에 사이트·흐름 문맥을 연결해 모델 요청을 조립한다. 기존 ai_input/1의 상세 구조를 다른 파트에서 별도로 복제·축소한 새 관찰 스키마로 대체하지 않는다.

| 필드 | 최소 내용 |
|---|---|
| site_context | 제공된 목적·요구사항, 허용 범위·행동, 준비 가능한 상태 참조 |
| flow | 현재 목표, 시작 조건 참조, 이전 행동·결과의 요약과 참조 |
| observation | 현재 실제 ai_input/1 객체 |
| evidence_refs | 현재 관찰에 연결된 이미지·상세 증거 참조 |

공통 지시·현재 관찰·이전 흐름 기록을 구분한다. 제공된 정보·직접 관찰·추론을 섞지 않고 기대 동작의 출처를 남긴다. 남은 실행 한도는 프로그램의 실제 상태를 사용하며 사용자에게 필수로 입력시키지 않는다.

아래 세 JSON은 가상 더 보기 버튼을 사용한 합성·축약 예시다. URL·ID·참조 파일·관찰은 실제 실행 자료가 아니고, 특정 프로젝트 결함을 첫 사례로 고정하는 뜻도 아니다. 특히 observation은 ai_input/1의 일부만 표시한 것이므로 이 예시 자체를 완성된 전처리 스키마나 Claude API 요청으로 사용하지 않는다. 실제 요청에는 전처리에서 반환한 객체와 필요한 이미지·메시지 블록을 사용한다.

```json
{
  "schema_version": "wtp.inspection_input/0.1",
  "run_id": "example-run-001",
  "flow_id": "example-flow-001",
  "site_context": {
    "description": "가상 설명 페이지",
    "expectations": [
      {
        "statement": "더 보기 버튼을 누르면 도움말 영역이 표시된다.",
        "source": "user_provided",
        "source_ref": "example-requirement-001"
      }
    ]
  },
  "flow": {
    "goal": "현재 페이지의 조작 가능한 기능을 확인한다.",
    "initial_state_ref": "example-start-001",
    "history_summary": "페이지 최초 방문. 아직 행동하지 않음.",
    "recent_action_ids": []
  },
  "observation": {
    "schema_version": "ai_input/1",
    "page": {
      "url": "https://qa.example.invalid/demo",
      "snapshot_id": "example-snapshot-001"
    },
    "controls": [
      {
        "key": "example-button-help",
        "tag": "button",
        "role": "button",
        "text": "더 보기",
        "visible": true,
        "disabled": false
      }
    ]
  },
  "evidence_refs": [
    {
      "snapshot_id": "example-snapshot-001",
      "kind": "screenshot",
      "ref": "evidence/example-before.png"
    }
  ]
}
```

## 4. 실행 결과

제안 스키마 이름: wtp.execution_result/0.1.

모델의 원 도구 요청과 실제 실행·전후 관찰을 연결한다. 실제 도구명·인자·비민감 테스트 값 또는 안전한 참조를 보존한다. API key·비밀번호·토큰을 모델 입력·공유 JSON·로그에 평문으로 복사하지 않는다. 원본 보존 원칙도 비밀값 무제한 저장을 허용하는 뜻은 아니다.

| 구분 | 제안 내용 | 주의 |
|---|---|---|
| tool_request | tool_use_id, 도구명·인자, 관찰된 대상 참조 | 원 요청과 실행한 인자가 다르면 차이를 기록 |
| execution | 실행 상태, 실행 여부의 확실성, 실행 오류 | completed도 기능 정상의 뜻은 아님 |
| observation | 전후 snapshot, 새 ai_input 참조, 관찰·수집 품질, 실제 변화 | 촬영 실패·생략·준비 실패를 함께 기록 |
| evidence_refs | 최초/이후 실제 증거 | 존재하지 않는 증거 참조를 확정하지 않음 |
| recovery | 교정 횟수·허용 여부·원 시도 참조 | 프로그램이 결정, 모델이 횟수를 초기화하지 않음 |

execution_certainty의 제안 값은 executed/not_executed/unknown이다. 이는 실제 행동을 수행했는지의 구분이며 업무상 기대 결과가 성공했는지의 구분이 아니다. 예외가 발생했다는 이유만으로 not_executed로 설정하지 않는다.

기존 action의 completed/failed/cancelled/capture_failed와 새 필드를 연결하는 변환은 공동 검토·구현 대상이다. 기존 completed에도 snapshot의 스크린샷 실패가 있을 수 있으므로 quality.collection_errors와 artifacts.screenshot도 확인한다. failed만으로 재시도 안전성을 판단하지 않는다.

```json
{
  "schema_version": "wtp.execution_result/0.1",
  "run_id": "example-run-001",
  "flow_id": "example-flow-001",
  "action_id": "example-action-001",
  "tool_request": {
    "tool_use_id": "toolu_example_001",
    "tool_name": "browser_click",
    "arguments": {
      "element": "더 보기 버튼",
      "ref": "e1"
    },
    "target_key": "example-button-help",
    "target_snapshot_id": "example-snapshot-001"
  },
  "execution": {
    "status": "completed",
    "execution_certainty": "executed",
    "error": null
  },
  "observation": {
    "before_snapshot_id": "example-snapshot-001",
    "after_snapshot_id": "example-snapshot-002",
    "after_ai_input_ref": "ai_inputs/example-snapshot-002.json",
    "capture_status": "partial",
    "collection_errors": ["screenshot_failed"],
    "summary": "클릭은 완료했지만 결과 영역의 확인 자료가 불충분함."
  },
  "evidence_refs": [
    {
      "snapshot_id": "example-snapshot-001",
      "kind": "screenshot",
      "ref": "evidence/example-before.png"
    },
    {
      "snapshot_id": "example-snapshot-002",
      "kind": "screenshot",
      "ref": null,
      "error": "screenshot_failed"
    }
  ],
  "recovery": {
    "retry_allowed": false,
    "retry_count": 0,
    "retry_of_action_id": null,
    "reason": "행동은 이미 실행됨. 부족한 관찰 때문에 클릭을 반복하지 않음."
  }
}
```

새 관찰을 모델에 전달할 때 after_ai_input_ref 문자열만 던져 두지 않는다. AI 입력 조립자가 그 참조의 실제 요약을 읽어 다음 요청에 포함하거나, 모델이 사용할 수 있는 제한된 상세 조회로 연결한다. 원 MCP 결과·상세 증거는 기존 산출물과 연결해 보존하되 매번 전체 원본을 모델 입력에 넣지 않는다.

## 5. 판정 기록

제안 스키마 이름: wtp.finding/0.1.

정상 검사 결과와 버그 후보의 최종 판정은 구분한다. 여기서는 후보·검토/미완료 항목을 저장하는 최소 구조를 보여 준다. 정상 검사의 수행·관찰 기록도 coverage와 flow 결과에 보존하되 버그 수에 넣지 않는다.

| 필드 | 제안 내용 |
|---|---|
| family, page_url | 지원 검사 범주와 실제 발생 페이지 |
| expected | 기대 결과·출처·근거 참조 |
| actual | 실제 관찰과 실행한 행동·snapshot 참조 |
| status, reason | 확인/오탐/검토/미완료 구분과 근거 |
| reproduction | 실제 추가 재현의 상태·행동·증거·못한 이유 |
| evidence_refs | 실제 증거와 판정의 연결 |

상태 코드 이름은 아직 제안이다. 확인은 기대 근거와 실제 실패·재현을 대조하고, 추론뿐인 기대나 재현 실패는 검토 대상으로 남긴다. 도구·준비·필수 관찰 실패는 미완료로 구분한다. 다시 실행했지만 실패를 보지 못했다는 이유만으로 최초 후보를 삭제하거나 오탐 확정하지 않는다.

```json
{
  "schema_version": "wtp.finding/0.1",
  "run_id": "example-run-001",
  "flow_id": "example-flow-001",
  "finding_id": "example-finding-001",
  "family": "functional",
  "page_url": "https://qa.example.invalid/demo",
  "expected": {
    "statement": "더 보기 버튼을 누르면 도움말 영역이 표시된다.",
    "source": "user_provided",
    "source_ref": "example-requirement-001"
  },
  "actual": {
    "summary": "행동은 완료했으나 결과 영역의 충분한 관찰을 확보하지 못함.",
    "action_ids": ["example-action-001"],
    "snapshot_ids": ["example-snapshot-001", "example-snapshot-002"]
  },
  "status": "incomplete",
  "reason": "관찰 자료 부족이며 사이트 버그로 확정하지 않음.",
  "reproduction": {
    "status": "not_run",
    "action_ids": [],
    "reason": "이 합성 예시에서는 재현 단계에 진입하지 않음."
  },
  "evidence_refs": [
    {
      "snapshot_id": "example-snapshot-001",
      "kind": "screenshot",
      "ref": "evidence/example-before.png"
    }
  ]
}
```

모델이 반환한 판정은 프로그램이 형식·참조·근거 존재 여부를 확인한 뒤 저장한다. 모델이 만든 설명만으로 실제 행동·사진·재현 성공을 생성하지 않는다. 유효한 판정 JSON을 받지 못하면 원 응답과 실제 자료를 보존하고 판정 처리 실패로 기록한다. 이를 이유로 사이트 행동을 다시 실행하지 않는다.

## 6. Q76 오류 복구 규칙 — 확정 원칙

| 상황 | 처리 |
|---|---|
| 실행 전 요청 형식 오류 등 미실행이 확인된 단순 오류 | 한도 안에서 수정 기회 최대 1회 |
| 대상 없음이 확인되고 행동도 미실행으로 확인됨 | 최신 관찰을 받아 대상/요청을 교정할 기회 최대 1회 |
| timeout·통신 오류 등 실행 여부가 불명확함 | 실행 여부·현재 상태를 먼저 관찰. 변경 결과가 불확실하면 자동 반복 금지 |
| 행동은 실행됐고 후속 사진·관찰만 부족함 | 안전한 관찰 보완을 검토하되 같은 행동을 자동 반복하지 않음 |
| 권한 거절·금지된 도구·실행 한도 만료 | 교정으로 우회하지 않음. 기존 승인 정책이나 미완료 처리 적용 |
| 교정 1회 뒤에도 실패 | 해당 검사 미완료와 원인 보존. 가능한 독립 검사는 기존 범위 안에서 진행 |

최대 1회는 동일한 실패 요청/원 시도에 대한 교정이다. 대상명·도구 호출 ID가 바뀌었다고 교정 횟수를 새로 0으로 만들지 않는다. 새 시도에는 새 action_id를 부여하고 원 시도와 연결한다. 교정의 모델 호출·행동·시간도 전체 실행 한도에 포함한다.

이 교정은 버그를 확인하기 위한 추가 재현 1회와 별개다. 추가 재현은 승인된 같은 시작 조건을 준비하고 실제 실행한 행동을 기록대로 재생한다. 미실행 요청을 실제 행동으로 재생하지 않으며, 새 AI 탐색을 재현이라고 부르지 않는다. 최초 증거는 초기화 전에 보존한다.

## 7. 기존 코드와 연결할 책임

| 항목 | 주도·협업 | 첫 검토 결과 |
|---|---|---|
| 공용 규격 문서·기존/확장 대응·변경 이력 | 전처리팀 관리, AI팀 검토, PM 영향 조율 | 같은 필드의 의미·호환 범위와 미구현 부분이 명확한 기준 문서 |
| 실제 ai_input/1·snapshot·이미지/품질 참조 | 전처리, AI 소비자 검토 | 원 구조를 보존한 입력 예시 |
| 문맥·대화 이력·tool_use/tool_result 연결 | AI | 실제 요청/결과 ID가 대응하는 기록 |
| MCP 같은 탭·대상 연결과 action 증거 감싸기 | AI·전처리 공동 | 모델 없는 행동과 동일 상태의 전후 관찰 |
| 실행 여부·교정 횟수·권한·한도 검사 | AI 실행 루프, 전처리 상태/관찰 협업 | 불명확한 결과에서 재실행하지 않는 확인 |
| 상세 판정·재현·최종 JSON 저장 | AI, 전처리 증거 연결 | 원 사실·증거와 추적 가능한 결과 |
| 전체 실행 진입점·파트 간 연결 코드·통합 검증 | PM 직접 주도, 각 파트 구현 협업 | 하나의 실제 실행에서 입력·행동·관찰·판정·증거·종료 결과가 연결됨 |

기존 콜백은 test_status, snapshots, discovered_urls 중심이다. 상세 plan/findings/report를 반환하는 것만으로 저장되는 것은 아니다. 상세 저장과 기존 콜백 결과로의 변환을 명시한다. 현재 기존 문서·콜백을 자동으로 새 API로 바꾸지 않는다.

### 7.1 구현된 전처리와 새 초안의 대응

| 기존 구현 | 공용 규격에서의 처리 | 상태 |
|---|---|---|
| ai_input/1의 page·controls·forms·links·errors·quality·readiness·omitted 등 | 검사 입력의 observation에 실제 객체를 보존 | 기존 구현 유지 |
| controls[].key, page/full_ref의 snapshot_id | 관찰·행동·판정의 대상과 상태 참조에 재사용 | 기존 구현 유지. MCP ref와 동일하다고 가정하지 않음 |
| action의 kind·target_key·전후 snapshot/ai_input_ref·diff·이벤트/리소스 ID | 실행 결과가 원 action과 증거를 참조하도록 연결 | 기존 기록 유지, 공용 구조로의 변환은 추가 작업 |
| action의 completed/failed/cancelled/capture_failed·operator_error·capture_error | 실행 오류와 관찰 오류를 분리해 보존 | 기존 상태 유지. failed를 미실행으로, completed를 검사 통과로 자동 변환하지 않음 |
| snapshot의 artifacts.screenshot·quality.collection_errors | 실제 증거 참조와 촬영/부분 수집 상태에 연결 | 기존 full-page 증거 유지. viewport 관찰은 추가 작업 |
| 콜백 test_status·snapshots·discovered_urls | 상세 저장과 별개로 기존 콜백에 필요한 결과를 반환 | 기존 계약 유지. passed는 사이트 전체 정상의 보장이 아님 |
| 사이트 설명·허용 범위·흐름 목표·기대 근거·이력 | site_context·flow 등에 출처와 함께 추가 | 새 확장. 기존 ai_input/1만으로 모두 얻을 수 없음 |
| run_id·flow_id·tool_use_id·실제 MCP 도구명/인자·안전한 재생 값/참조 | 실행 문맥·요청·행동·증거를 연결 | 새 확장. 기존 action만으로 완성되지 않음 |
| 실행 확실성·교정 횟수·판정·추가 재현·최종 결과 | 실제 실행과 근거를 검증해 저장 | 새 확장. 없는 사실을 모델 설명으로 채우지 않음 |

기존 action wrapper는 전후 증거를 감싸는 기능이며 스스로 클릭·입력을 수행하지 않는다. MCP를 호출하는 코드가 wrapper 안에서 실제 행동을 수행해야 한다. 중첩·동시 action을 허용하지 않는 기존 제약을 보존한다. 기존 action_id 형식·길이·실행별 고유성 조건도 따른다.

### 7.2 member-06 검토본과의 변환 지점

아래는 로컬 검토본 commit c5290bb6ca3efeb51296e37a0efdffdbc4176dd7 기준이다. 현재 원격 최신 상태·통합 완료·실제 모델 성능을 뜻하지 않는다. 코드를 없던 것으로 취급하지 않되 다음 차이를 해결해야 한다.

- 기존 입력은 schema=webtestpilot.hybrid-ai-input.v1과 input_id/kind/url/payload를 갖는 JSONL이다. 새 검사 입력의 schema_version/run_id/flow_id/observation을 그대로 읽는 구조가 아니다. JSONL이라는 저장 형식과 메시지의 의미상 호환을 구분한다.
- payload.inspection_context의 site_context/page_observation/inspection_flow는 이 초안의 site_context/observation/flow와 대응시킬 수 있다. 명시적 변환과 출처 보존이 필요하다. 현재 루프가 page_observation을 별도 실시간 관찰로 통째로 덮어쓰므로, 실제 ai_input/1의 요소·폼·제약·품질 정보가 후속 요청에서 사라지지 않도록 갱신 경계를 맞춘다.
- 기존 control_id는 등록된 selector를 찾는 로컬 키다. 전처리 controls[].key, MCP ref와 같은 값으로 간주하지 않는다. 가이드의 control_id→control_key 또는 navigation→routing은 이름 대응 제안이지 실제 대상·판정의 일치 검증이 아니다.
- 기존 decision/check_id/steps 계획을 프로그램이 MCP 호출로 바꾸는 방식은 Claude 표준 tool_use/tool_result 자체가 아니다. 클라이언트·연결·기록 기능은 재사용 후보로 두되 Q72~Q74의 표준 도구 루프에 맞춰 연결한다. 도구 선택과 실행 후 관찰·권한/한도 검증을 생략하지 않는다.
- 기존 trace의 step/before/after/execution_status/receipt는 원 자료로 보존한다. 새 action/snapshot/tool_use 식별자·실제 요청 인자·실행 확실성·교정 이력과 연결하는 변환이 필요하다. judgments의 passed/candidate/review_required/incomplete를 최종 버그 확인으로 자동 승격하지 않으며, reproduction_status=not_attempted를 재현 성공으로 바꾸지 않는다.

AI팀은 위 입력·요청/결과·판정 변환을 구현하고, 전처리팀은 관찰·대상·증거 연결을 맞추며 공용 규격에 반영한다. PM은 실제 통합 대상 코드를 선택해 전체 실행에 연결한다. 예전 형식을 모두 동시에 지원하는 범용 호환 계층을 선행 구축하지 않고, 실제 연결에 필요한 경계부터 맞춘다.

### 7.3 규격 변경과 완료 판단

규격 변경에는 기존/새 필드의 대응·필수/nullable 조건·오류 의미·변경 영향을 적고 AI팀의 소비/생산 검토를 받는다. PM은 실행 연결과 다른 파트 영향을 확인한다. 코드 변경은 담당 파트가 수행하고 실제 예시·검증 자료와 함께 통합한다. 문서만 바꾼 상태를 코드 통합 완료로 표시하지 않는다.

소스 확인 근거:

- [preprocess.py](C:/Users/lsc05/Documents/ChatGPT/WebTeste/integration/preprocessor/preprocess.py:447): ai_input/1, 기존 관찰·요소 key.
- [evidence.py](C:/Users/lsc05/Documents/ChatGPT/WebTeste/integration/preprocessor/evidence.py:180): 행동 기록과 전후 참조. action wrapper는 자체 조작 실행기가 아니다.
- [collector.py](C:/Users/lsc05/Documents/ChatGPT/WebTeste/integration/preprocessor/collector.py:535): 개별 screenshot 실패·부분 수집. 현재 사진은 full-page이며 viewport/scroll 보완은 별도 작업이다.
- [crawl.py](C:/Users/lsc05/Documents/ChatGPT/WebTeste/integration/preprocessor/crawl.py:574): 현재 콜백의 실제 소비 필드.
- [inspection_input.py](C:/Users/lsc05/Documents/ChatGPT/WebTeste/.tools/member06-review-c5290bb/teams/member-06/ai-inspector/src/ai_inspection/inspection_input.py:49): 검토본의 hybrid 입력 형식. 같은 파일의 inspection_context 확장도 확인했다.
- [inspection_runtime.py](C:/Users/lsc05/Documents/ChatGPT/WebTeste/.tools/member06-review-c5290bb/teams/member-06/ai-inspector/src/ai_inspection/inspection_runtime.py:200): 후속 관찰 교체. 계획·trace·판정의 별도 구조는 같은 검토본을 기준으로 한다.

## 8. 초안 검토와 연결 완료 기준

전처리팀이 공용 규격을 관리하고 AI팀과 같은 입출력 예시를 읽으며 필수 필드·nullable 값·ID·오류 의미를 맞춘다. PM이 전체 코드를 연결·검증한다. 가상 JSON 예시는 구조 설명용이며 실제 산출물로 교체해서 확인한다. 구체 공유 브라우저 연결 방법은 T03의 결과를 반영한다.

첫 연결 검수에는 다음을 포함한다.

1. 원 ai_input/1과 입력 문맥을 소비자가 읽을 수 있고, 참조가 실제 관찰에 연결됨.
2. 모델이 선택한 행동과 같은 탭의 실제 실행·전후 관찰·tool_use ID가 연결됨.
3. 실행 완료와 관찰 실패를 구분하고, 사진 실패를 사이트 결함으로 보고하지 않음.
4. 확실한 미실행 단순 오류에는 최대 1회 교정하고, 실행 여부가 불명확하면 변경 행동을 반복하지 않음.
5. 후속 모델 요청에 실제 결과·필요한 앞선 문맥이 들어가고, 계획만으로 통과를 주장하지 않음.
6. 후보의 실제 추가 재현 또는 미완료 이유와 JSON·증거를 보존함.

이 기준은 특정 F3를 반드시 발견해야 한다는 조건이 아니다. 기존 승인 테스트 페이지에서 짧은 실제 흐름부터 연결하고 페이지·결함 개발과 함께 개선한다. 정답·정상/결함 환경이 확보된 범위는 독립 실행해 대조하되, 연결 성공을 전체 탐지 성능으로 주장하지 않는다.

최종 필수 범위인 네 범주·로그인·모바일 UI·단일 PDF·웹 화면은 후속 계획대로 유지한다. 문서 예시의 JSON 구문·참조 관계를 확인하는 것과 실제 코드·MCP·모델 통합을 검증하는 것은 별개다.
