# member-06 Playwright MCP 연결 코드 리뷰

작성일: 2026-10-10. 검토한 코드의 업로드 커밋은 2026-10-09 기준이다.

- 검토 대상: [development c5290bb6ca3efeb51296e37a0efdffdbc4176dd7](https://github.com/bibimmando/WebTestPilot/tree/c5290bb6ca3efeb51296e37a0efdffdbc4176dd7/teams/member-06/ai-inspector).
- 목표: 전처리 입력 → AI 계획 → 실제 MCP 행동 → 결과 관찰/후처리 → AI의 다음 판단.
- 원격 소스를 `.tools/member06-review-c5290bb/`에 복사해 읽고 오프라인 검증했다. 원본 제품 코드는 수정하지 않았다.
- 기존 member-02와 같은 커밋의 blob을 대조했다. 입력 변환, 증거 분석/판정, observer, MCP 어댑터 등은 재사용 사본이며 실제 MCP client와 CDP runtime을 추가한 구조다.

## 1. 현재 완성 수준

**등록한 검사·요소·동작을 바탕으로 계획 JSON을 만들고 실제 MCP로 실행한 뒤, 같은 탭을 다시 관찰해 Planner에 반환하는 제한된 실행 연결본**이다.

실제 MCP 세션을 여는 코드와 도구 호출이 있다. 동시에 현재는 사람이 미리 등록한 컨트롤·입력값·검사 기준에 의존하며, 일반 페이지에서 스스로 기능과 대상을 발견하고 네 종류의 버그를 판단하는 전체 시스템까지 완성된 상태는 아니다.

| 목표 단계 | 현재 상태 |
|---|---|
| 기존 전처리 JSONL 읽기 | schema/kind/input_id/URL/payload 검증과 문맥 변환 있음 |
| 전처리 정보를 AI에 전달 | 분석 모드에는 전달됨. 실행 루프에서는 최초 payload를 새 관찰로 덮어쓰는 결함 확인 |
| AI가 검사 계획 작성 | 등록한 check/control ID를 선택하는 구조화된 계획 요청 구현 |
| 실제 Playwright MCP 실행 | stdio 세션, 도구 조회/스키마 검증, click/fill/press 연결 구현 |
| 같은 탭 결과 수집 | 본문·URL·제목·viewport/스크롤·viewport PNG 관찰 구현 |
| 결과를 다음 AI 요청으로 반환 | 새 관찰과 실제 행동 이력을 다음 Planner에 전달하는 반복 루프 구현 |
| 결과 후처리·판정 | 사전 등록된 문구 포함/URL 일치의 로컬 판정. 일반적인 AI 결과 판정은 추가 필요 |
| 기존 자연어 검사 제안 연결 | 정확한 문자열 매핑 방식. semantic planning의 proposed_checks 미지원 문제 확인 |
| 자동 추가 재현·최종 보고서 | 미구현, not_attempted / not_generated |

## 2. 실행 구조

### 입력과 설정

입력은 `webtestpilot.hybrid-ai-input.v1` JSONL이다. navigation_failure, interaction_execution_error, ambiguous_interaction, semantic_test_planning을 받는다.

`payload.inspection_context`가 있으면 사이트 문맥·페이지 관찰·흐름으로 나눈다. 없으면 빈 문맥과 입력 URL로 시작한다. 기존 payload는 `page_observation.collected_evidence`에 보관하도록 설계돼 있다.

별도의 신뢰하는 `runtime.json`에는 다음을 준비해야 한다.

- MCP 프로세스 실행 파일·인자, 연결 timeout.
- 선택 사항인 로컬 CDP endpoint.
- `controls`: control_id → 미리 검토한 CSS selector.
- `permissions`: control별 click/fill/press 및 허용 테스트 값.
- `checks`: 기대 결과의 유형·값·출처·근거 참조.
- 선택 사항인 `suggestion_bindings`: 분석 제안의 정확한 문자열 → check_id.

기존 전처리의 controls/key/locator에서 이 설정을 자동 조립하는 연결은 없다.

### 모델이 만드는 계획

ClaudePlanner는 일반 Messages API 요청의 JSON 응답 스키마를 사용한다. Claude 표준 tool_use/tool_result를 직접 왕복시키는 방식은 아니며, 프로그램이 계획 JSON을 도구 호출로 변환한다.

```json
{
  "decision": "act",
  "check_id": "echo",
  "steps": [
    {"action": "fill", "control_id": "field", "value": "pilot"},
    {"action": "press", "control_id": "field", "value": "Enter"}
  ]
}
```

`finish`는 빈 check_id와 빈 steps로 종료를 요청한다. 프로그램은 등록한 검사·컨트롤·허용 값·동작을 검증한다. 지원 동작은 click/fill/press, 지원 키는 Enter/Tab/Escape다. 자유로운 테스트 스크립트나 임의 JavaScript를 생성·실행하지 않는다.

### MCP와 같은 브라우저 연결

`LocalMCPClient`는 별도 스레드의 비동기 루프에서 공식 MCP Python SDK의 stdio 세션을 관리한다. 초기화 후 도구 목록과 inputSchema를 조회하고 호출 인자를 검증한다. 코드에서 기대하는 서버 스키마가 아니면 실행을 거절한다.

`PlaywrightMCPExecutor`는 CDP로 브라우저에 연결한다.

- endpoint가 없으면 격리된 Chromium을 직접 시작하고 입력 URL로 이동한다.
- endpoint가 있으면 준비된 브라우저에 연결하며 context와 탭이 각각 하나여야 한다.
- 기존 탭의 URL이 JSONL 입력 URL과 정확히 같아야 한다.
- 임시 제목 표식을 MCP snapshot에서 확인해 observer와 MCP가 같은 탭인지 검증하고 제목을 복원한다.
- 행동 직전에 selector가 유일·가시·활성인지 재검사한다.

실제 매핑은 click → browser_click, fill → browser_type, press → browser_press_key다. 키 동작의 focus는 Python Playwright가 준비하고 키 입력은 MCP로 수행한다.

이 구조는 같은 탭의 MCP 동작과 Python 관찰을 연결할 기반이다. 현재 전처리의 async `crawl()`이 CDP endpoint를 제공하고 이 동기 runtime과 공통 실행 경로를 구성하는 통합은 별도 작업이다.

### 실행 후 관찰과 반환

`SharedPageObserver`는 다음을 수집한다.

- URL과 제목.
- body의 inner_text, 최대 10,000자 및 잘림 표시.
- 화면 크기와 스크롤 좌표.
- 현재 화면 PNG 경로와 촬영 성공/실패.

각 행동의 before/after와 MCP 도구 이름을 기록한다. 다음 Planner 요청에는 새 관찰과 실제 행동 이력이 들어간다. 사진은 로컬 경로로 기록하며 현재 API 메시지에 실제 이미지 바이트를 넣는 연결은 없다.

이는 기존 SnapshotAPI.action/get_ai_input/diff를 재사용한 관찰은 아니다. 폼·컨트롤·입력 제약·콘솔/JS 오류·전처리 diff를 실행 후 다시 생성하는 연결은 필요하다. MCP 도구의 상세 응답은 receipt에 보존하지 않고 도구 성공 여부·이름과 별도 observer 관찰을 사용한다.

### 판정과 저장

`judge_observation()`은 등록된 조건을 코드로 판정한다.

- text_contains: 기대 문구가 수집한 본문에 있는가.
- url_equals: 실제 URL이 기대 URL과 정확히 같은가.
- unknown 또는 추정 근거: review_required.
- 불일치: candidate. 본문이 잘렸으면 incomplete로 구분.

따라서 현재 판정 결과는 AI가 스크린샷·전후 상태를 종합해 판단한 결과가 아니다. 후속 Planner가 관찰을 보고 행동을 다시 선택할 수는 있지만 별도 AI 판정 응답 규격은 없다.

`inspection_results.jsonl`과 `inspection_run.json`에는 원래 input_id, plans, actions의 before/after/receipt, judgments, 종료 이유, 사용량, 미처리 입력 등을 저장한다. 기존 snapshot_id·action_id 기반 전처리 증거와 자동 연결되지는 않는다.

## 3. 확인한 문제

### [P1] 실행 모드에서 전처리 payload가 Planner 입력에서 사라진다

- 위치: [inspection_runtime.py 200~202](https://github.com/bibimmando/WebTestPilot/blob/c5290bb6ca3efeb51296e37a0efdffdbc4176dd7/teams/member-06/ai-inspector/src/ai_inspection/inspection_runtime.py#L200).
- `adapt_inspection_context()`는 전처리 payload를 page_observation.collected_evidence에 넣는다.
- 그러나 첫 Planner 호출부터 `context["page_observation"] = current`가 해당 객체를 observer의 본문/URL/이미지 경로로 교체한다.
- observer가 collected_evidence를 반환하지 않으므로 폼·제약·컨트롤·품질·생략 정보가 모델 요청에 없다.
- payload에서 제공한 페이지 관찰/기대 근거도 별도 보존하지 않으면 같은 방식으로 빠진다.
- 영향: 목표의 ‘전처리 → AI 입력’이 실행 모드에서는 이어지지 않는다.
- 수정 방향: 전처리 근거와 최신 실행 관찰을 명시적으로 분리/병합하고, 행동 후에는 같은 탭에서 새 전처리 관찰을 갱신한다. 이전 snapshot의 대상이 계속 유효하다고 가정하지 않는다.

오프라인 재현에서 adaptation 직후에는 collected_evidence가 있었고 실제 Planner 요청에는 없었다. 테스트용 pattern과 omitted 정보도 전달되지 않았다. 이 부분은 재사용된 실행 루프에 있는 연결 문제다.

### [P1] semantic planning의 proposed_checks는 실행 검사로 연결되지 않는다

- 위치: [playwright_mcp_runtime.py 26~39](https://github.com/bibimmando/WebTestPilot/blob/c5290bb6ca3efeb51296e37a0efdffdbc4176dd7/teams/member-06/ai-inspector/src/ai_inspection/playwright_mcp_runtime.py#L26).
- `--analysis-results`는 분석 결과의 suggested_checks만 읽는다.
- 기존 semantic_test_planning 응답은 proposed_checks와 open_questions다.
- 같은 input_id, completed 상태, 정확한 suggestion_bindings가 있어도 proposed_checks를 넣으면 빈 검사 목록이 된다.
- 이어서 create()가 등록할 검사가 없다는 오류로 중단한다.
- 영향: 지난번 실행한 페이지별 시나리오 제안 결과를 이 옵션으로 바로 연결할 수 없다.
- 수정 방향: 입력 kind/work_type과 출력 계약에 맞춰 제안 필드를 처리하고, 제안과 실행 가능한 검사의 연결을 명시한다. 자연어 문자열을 곧바로 selector/권한으로 바꾸지 않는다.

오프라인 검증에서 동일 문자열의 proposed_checks는 빈 목록, suggested_checks는 등록된 검사 한 건으로 선택됐다.

### [P2] Planner에게 허용 동작·입력값·컨트롤 의미가 충분히 제공되지 않는다

- 위치: [inspection_runtime.py 69~79](https://github.com/bibimmando/WebTestPilot/blob/c5290bb6ca3efeb51296e37a0efdffdbc4176dd7/teams/member-06/ai-inspector/src/ai_inspection/inspection_runtime.py#L69).
- 요청의 controls는 ID 목록뿐이다. 실제 실행기의 permissions.actions/values는 포함되지 않는다.
- 입력값은 정확한 허용 목록을 따라야 하는데 모델은 그 목록을 알 수 없다. 페이지/명세에서 추측한 합리적인 값도 실행 단계에서 거절될 수 있다.
- 컨트롤 설명도 부족하며 위 payload 누락이 이를 더 악화시킨다.
- smoke의 Claude 경로는 프롬프트에 click/fill pilot/Enter를 직접 알려주므로 이 문제를 일반 페이지에서 검증하지 않는다.
- 수정 방향: 관찰에서 나온 컨트롤 설명·대상 참조와 안전하게 공개 가능한 허용 동작/테스트 값·제약을 요청에 전달한다. 비밀값은 제외하고 권한 강제는 실행기에서 유지한다.

## 4. 의도적으로 제한된 범위와 후속 작업

다음은 현재 문서에 적힌 제한이다. 모두 코드 결함으로 취급할 필요는 없지만 전체 계획에서는 보완 대상이다.

| 제한 | 전체 목표에 미치는 영향 |
|---|---|
| 고정 controls/checks | 일반 페이지의 자율 기능 발견·검사 조건 생성은 미완성 |
| 정확한 자연어 문자열 매핑 | 모델이 같은 의미를 다르게 표현하면 매핑되지 않음 |
| 현재 URL 변경 후 이전 control 실행 거절 | 짧은 다중 페이지 시나리오는 새 관찰·대상 갱신을 연결해야 함 |
| GET/HEAD/OPTIONS 외 요청 차단 | POST 기반 검색·검증·로그인 등의 기능은 검사되지 않거나 정책 때문에 실패할 수 있음 |
| 자격증명/결제 컨트롤 거절 | 기본 로그인 준비는 전처리/실행 환경의 별도 경로 필요 |
| 같은 탭 관찰이 본문/PNG 중심 | 구조화된 전후 변화·오류·제약을 반영한 판단 자료가 부족 |
| PNG 경로만 API JSON에 전달 | 실제 시각 정보 기반 UI 판정은 연결되지 않음 |
| 같은 control catalog 유지 | 메뉴/모달·페이지 이동 후 새 대상 발견을 지원하지 않음 |
| 자동 재현 미구현 | candidate를 추가 재현이 확인된 결함으로 표현할 수 없음 |

실행 한도는 기본 3 rounds, 10 actions, 60 seconds이며 반복 단계 사이에서 확인한다. 연결·모델·도구 호출 자체의 timeout은 별도로 존재한다. 전체 60초가 모든 호출을 즉시 취소하는 강제 deadline이라고 해석하지 않는다.

차단 요청 정보는 receipt에 기록된다. 정책으로 요청이 막혀 생긴 화면 결과를 사이트 결함으로 오인하지 않도록 이후 판정에서 이 정보를 함께 사용해야 한다.

## 5. 검증 범위

작성자 문서는 48개 테스트와 실제 MCP Mock의 클릭·입력·Enter 3개 성공을 보고한다. 실제 유료 Claude Planner 검증은 미완료라고 명시한다.

이번 리뷰에서는 내려받은 c5290bb 원본 소스로 다음을 실행했다.

- unittest: 48개 중 44개 통과, 브라우저/MCP opt-in 4개 건너뜀.
- 첫 시험의 임시 디렉토리 권한 오류는 리뷰 환경 문제였다. workspace 내부 임시 경로로 바꿔 위 결과를 확인했다.
- 오프라인 연결 probe: payload 유실, proposed/suggested 필드 차이, 허용 값 미전달 확인.
- 실제 외부 사이트 검사·MCP 서버 기동·유료 Claude 호출은 수행하지 않았다.

재현 자료:

- [probe 코드](../../.tools/member06-review-c5290bb/review_probes.py).
- [probe 결과 JSON](../../.tools/member06-review-c5290bb/probe-results/review_probe_results.json).
- 로컬 소스 사본: `.tools/member06-review-c5290bb/teams/member-06/ai-inspector/`.

## 6. 권장 통합 순서

1. 전처리 원본과 최신 관찰을 보존해 실제 Planner 입력의 payload 누락을 해결한다.
2. proposed_checks/suggested_checks 연결과 실행 가능한 검사 계약을 맞춘다.
3. 전처리의 element_key/locator/관찰 설명을 실행 컨트롤과 연결하고 허용 동작·안전한 값/제약을 모델 요청에 제공한다.
4. 전처리가 준비한 CDP 탭과 MCP를 공동 사용하고 모든 실제 행동을 SnapshotAPI의 전후 증거 기록에 연결한다. 사진·JSON·input_id·snapshot_id·action_id의 대응을 확인한다.
5. 행동 후 같은 탭의 새 ai_input와 diff·오류·증거 참조를 만들어 결과 해석/후속 행동 모델에 반환한다.
6. 첫 사례에서 정상·결함 독립 실행과 추가 1회 재현·결과 JSON을 연결한다.

현재 구현은 재사용 가능한 MCP 실행 기반을 제공한다. 다음 통합 작업의 핵심은 전처리 입력 보존, 동적 대상/결과 관찰, 등록된 단순 조건을 넘어서는 근거 있는 AI 판단, 재현이다.
