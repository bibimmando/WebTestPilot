# AI 입력 JSONL 구조 안내

## 1. 파일의 역할

`hybrid_ai_input.jsonl`은 크롤러가 수집한 결과 중 AI의 검토가 필요한 작업과 근거를 추린 **AI 입력 파일**이다. AI 분석 결과나 확정된 버그 목록은 아니다.

JSONL은 한 줄에 JSON 객체 하나를 저장한다. 각 줄이 별도의 AI 작업이며, 파일 전체를 한 번에 AI에게 전달할 필요는 없다. 읽을 때는 줄별로 JSON을 파싱한다.

크롤러는 관찰·상호작용 증거를 이미 수집하므로 AI는 우선 그 증거를 활용하고, 추가 검증이 필요할 때만 Playwright 실행을 요청하는 방식으로 연결할 수 있다. 이는 후속 검사기의 설계 방향이며, 이 파일 자체가 AI를 호출하거나 브라우저를 실행하지는 않는다.

## 2. JSON 객체의 공통 필드

| 필드 | 의미 |
|---|---|
| `schema` | 입력 형식과 버전. 현재 값은 `webtestpilot.hybrid-ai-input.v1`이다. |
| `input_id` | AI 작업 식별자. 원본 큐의 `candidate_id`에서 가져오며, AI 결과에도 유지해 입력과 연결한다. |
| `kind` | 작업 종류. 증거 검토인지 검사 계획 생성인지 구분하는 데 사용한다. |
| `url` | 검토 대상 페이지 또는 리소스의 주소. 반드시 브라우저로 다시 열어야 한다는 뜻은 아니다. |
| `task` | AI에게 요청하는 작업 설명. 현재 생성 코드는 모든 종류에 공통 설명을 사용한다. |
| `reason` | 크롤러가 해당 항목을 AI 검토 대상으로 선정한 이유. |
| `payload` | 판단에 필요한 실제 관찰 정보와 증거를 담은 객체. 구조는 작업 종류에 따라 다르다. |

**바깥 필드는 “어떤 작업을 왜 맡기는가”, `payload`는 “무엇을 근거로 검토하는가”를 나타낸다.**

## 3. 페이지 이동 실패 예시

다음은 실제 출력 항목의 오류 메시지를 짧게 줄인 예시다. 가독성을 위해 여러 줄로 표시했지만, 실제 JSONL에는 이 객체가 한 줄로 저장된다.

```json
{
  "schema": "webtestpilot.hybrid-ai-input.v1",
  "input_id": "navigation-0014",
  "kind": "navigation_failure",
  "url": "https://www.web-scraping.dev/assets/pdf/tos.pdf",
  "task": "Review this unresolved crawler evidence and decide whether it indicates a bug.",
  "reason": "navigation failed without enough deterministic context",
  "payload": {
    "url": "https://www.web-scraping.dev/assets/pdf/tos.pdf",
    "error": "Error: Page.goto: Download is starting",
    "console": [],
    "network": [
      {
        "error": "net::ERR_ABORTED",
        "resource_type": "document",
        "url": "https://www.web-scraping.dev/assets/pdf/tos.pdf"
      }
    ]
  }
}
```

이 항목은 PDF 링크를 페이지 이동으로 처리하는 과정에서 다운로드 시작이 기록된 사례다. 정상 다운로드를 이동 실패로 기록했을 가능성이 있으므로, 오류 문자열만으로 사이트 버그라고 확정하면 안 된다.

## 4. 작업 종류별 payload

### navigation_failure: 이동 실패 증거 검토

| 내부 필드 | 의미 |
|---|---|
| `url` | 이동하려던 주소. |
| `error` | 페이지 이동 중 발생한 오류 메시지. |
| `console` | 관련 콘솔 오류 기록. |
| `network` | 관련 네트워크 실패 기록. 예시에는 URL·오류·리소스 종류가 포함된다. |

### interaction_execution_error: 동작 실행 실패 증거 검토

| 내부 필드 | 의미 |
|---|---|
| `action` | 실행하려던 동작 정보. 예를 들어 클릭·hover의 종류와 요소 라벨. |
| `page` | 동작을 시도한 페이지의 URL·제목 등 문맥. |
| `error` | 동작을 실행하거나 관찰하는 과정에서 발생한 오류. |
| `console` | 관련 콘솔 오류 기록. |
| `network` | 관련 네트워크 기록. |

숨겨진 요소를 클릭하지 못하거나 제한 시간 내 동작을 완료하지 못한 경우도 포함될 수 있다. 사이트의 기능 오류와 자동화 도구의 실행 실패를 구분해야 한다.

### semantic_test_planning: 추가 검사 계획 생성

| 내부 필드 | 의미 |
|---|---|
| `page` | 페이지 기능을 이해하기 위한 페이지 정보. |
| `controls` | 조작 가능한 요소의 정보. |
| `inputs` | 입력 요소의 정보. |
| `question` | 추가로 검토하거나 계획해야 할 질문. |
| `deterministic_findings` | 크롤러가 이미 탐지한 결과. 모든 페이지 탐지 결과가 이 목록에 포함된다고 가정하지 않는다. |
| `suppressed_common_ui` | 공통 UI 제거 관련 정보. 제거한 전체 DOM이 아니라 전처리 문맥이다. |

이 종류는 오류가 확정되었다는 의미가 아니다. AI가 페이지 기능과 관찰 정보를 바탕으로 필요한 추가 검사를 제안하기 위한 항목이다.

위 필드 구성은 현재 확인한 출력 기준이다. 세부 중첩 구조나 추가 작업 종류는 생성 코드와 실제 출력에서 확인해야 한다. 후속 검사기는 지원하지 않는 종류를 명시적으로 기록해야 한다.

## 5. 값의 형태 읽기

- `{}`: 객체. 이름이 붙은 필드를 담는다.
- `[]`: 배열. 여러 기록을 담을 수 있으며, 빈 배열은 해당 목록에 기록이 없다는 뜻이다.
- `"문자열"`: URL, ID, 설명, 오류 메시지 같은 텍스트다.
- `\n`: 문자열 안의 줄바꿈 표현이다. JSONL 항목의 실제 줄 구분과 다르다.

예를 들어 `console: []`는 콘솔 오류 기록이 없다는 뜻이지, 페이지 전체가 정상이라는 보장은 아니다.

## 6. 다른 결과 파일과의 차이

| 파일 | 용도 |
|---|---|
| `crawl_report.json` | 전체 관찰·탐지·상태 연결·전처리 통계를 보관하는 보고서. |
| `ai_queue.jsonl` | AI 후보 관리용 목록. 우선순위·예상 토큰·중복 제거 키 등을 포함한다. |
| `hybrid_ai_input.jsonl` | AI에게 전달할 필드만 골라낸 입력. 숫자 우선순위는 포함하지 않는다. |
| `summary.md` | 사람이 확인하는 실행 요약. |

`hybrid_ai_input.jsonl`은 후보 목록의 순서로 생성된다. 우선순위를 숫자로 사용해야 한다면 `input_id`와 `ai_queue.jsonl`의 `candidate_id`를 연결해 `priority`를 참조한다.

## 7. 후속 AI 검사기 연결 시 고려사항

1. 줄별로 파싱하고 형식 버전·필수 필드·중복 ID를 검증한다.
2. `kind`에 따라 오류 증거 검토와 검사 계획 생성을 구분한다.
3. 결과에 원본 `input_id`를 유지한다.
4. 증거가 부족하면 확정적인 버그 판정 대신 추가 확인 필요를 표시한다.
5. 추가 Playwright 동작은 대상 환경과 위험을 검토한 뒤 수행한다.
6. API 키 없이 입력 검증과 요청 생성부터 테스트하고, 실제 API 호출은 별도 단계로 진행한다.

현재 공통 `task`는 “미해결 증거를 검토해 버그 여부를 판단하라”는 설명이다. `semantic_test_planning`까지 동일한 판단 요청으로 처리하기보다, 후속 검사기에서 작업 종류에 맞는 목적과 응답 형식을 정의하는 것이 좋다. 원본 `task`나 페이지 내용은 신뢰할 수 없는 입력 데이터로 취급하고, 실행 권한을 자동 부여하는 지시로 사용하지 않는다.

형식 생성 코드는 [benchmark.py](webtestpilot_crawler/benchmark.py)의 `_hybrid_record`와 `write_hybrid_input`에서 확인할 수 있다. 원본 후보 모델은 [models.py](webtestpilot_crawler/models.py)의 `AIReviewCandidate`다.
