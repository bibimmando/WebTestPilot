# WebTestPilot 공용 개발·통합 가이드

작성일: 2026-10-08 · 기준: `development`의 페이지 전처리기 · 문서 버전: 1

각 팀이 AI로 개발할 때 이 문서를 먼저 읽히고, 아래 연결 계약에 맞춰 코드를 작성한다.
**현재 구현된 연결 계약**과 **계획·결과 형식의 합의 초안**을 구분한다. 초안은 아직 실행 코드가 지원하는 API가 아니다.

## 1. 공통 목표와 실행 흐름

```text
시작 URL → FIFO 큐 → 페이지 로드·전처리 → AI 검사 콜백 → 다음 URL
                       │                   │
                       │                   └─ 계획 → 행동 → 전후 증거 → 판정
                       └─ snapshot·ai_input·URL 그래프
실행 종료 → 수집·검사 결과 집계 → 보고서·벤치마크 평가
```

- 발견한 동일 출처 URL은 큐 순서대로 처리하며, 탐색 중 URL 그래프를 만든다. 사이트 전체 그래프를 미리 만들지 않는다.
- 중요도에 따른 페이지 생략은 현재 적용하지 않는다. 출처·robots·시간·페이지 수·문서 유형에 따른 제한은 적용한다.
- 검사 유형은 `functional`, `input_validation`, `routing`, `ui` 네 가지다.
- 페이지 수집 완료, 검사 행동 실행 완료, 검사 통과, 버그 확정은 각각 구분한다.

## 2. 팀별 담당 범위

| 팀 | 담당 | 다른 팀과 연결하는 부분 |
|---|---|---|
| 전처리·URL 관리·크롤링 2명 | 브라우저 수명, URL 큐·그래프, 범위·robots, 페이지 상태·요약·조작 증거 | `page_callback`, `ai_input/1`, `SnapshotAPI` |
| AI 검사·보고서 2명 | 모델 호출, 검사 계획, 계획 검증, 행동 실행, 결과 판정·보고서 | 제공받은 `page`와 증거 API를 사용하고 결과를 저장 |
| 테스트 페이지·벤치마크 2명 | 정상·결함 페이지, 테스트 데이터, 정답 목록, 재현·평가 | 실행 대상 URL과 기대 결과를 제공하고 증거 ID로 비교 |

팀별 폴더는 그대로 사용한다. 담당 영역 밖의 연결 계약을 바꿀 때는 해당 팀과 먼저 조율한다.
AI 검사기의 통합 경로에서는 별도 크롤러·URL 큐·DOM 수집기·브라우저 실행기를 만들지 않는다.
프로토타입용 단독 실행은 유지할 수 있으나, 공통 검사 로직을 통합 콜백에서 재사용할 수 있어야 한다.

## 3. 현재 기준 코드와 문서

- 설치 가능한 전처리 패키지: [`teams/member-01/page-preprocessor/`](../teams/member-01/page-preprocessor/)
- Python import: `wtp_preprocessor`
- 설치·실행·출력 안내: [member-01 README](../teams/member-01/README.md)
- 상세 데이터·증거 계약: [AI_INPUT_CONTRACT.md](../teams/member-01/page-preprocessor/docs/AI_INPUT_CONTRACT.md)
- 기존 `webtestpilot-crawler/`는 이전 구현이다. 이번 페이지 단위 통합의 기준은 위 패키지다.

이 문서와 실제 코드가 다르면 차이를 기록하고 조율한다. 다른 팀 AI가 작성한 코드에 맞춰 기존 필드나 함수 이름을 임의로 바꾸지 않는다.

## 4. 현재 구현된 페이지 콜백 계약

```python
async def inspect_page(page, initial_snapshot, evidence):
    ...
    return {"test_status": "not_run"}
```

| 인자 | 의미 |
|---|---|
| `page` | 크롤러가 이미 연 `playwright.async_api.Page`. 현재 화면에서 검사를 수행한다. |
| `initial_snapshot` | 해당 URL의 최초 상세 snapshot dict. `schema_version`은 `0.2`. |
| `evidence` | `SnapshotAPI` 객체. 요약·요소 조회, 추가 snapshot, 조작 전후 증거를 제공한다. |

- 콜백은 `async def`로 작성하고 브라우저 동작을 `await`한다.
- 콜백 안에서 `asyncio.run()`, `sync_playwright()`, 별도 브라우저 실행·종료를 하지 않는다.
- 크롤러가 시간 상한으로 콜백을 취소할 수 있다. 취소를 삼켜 성공으로 바꾸지 않는다.
- 각 URL은 현재 크롤러의 페이지에서 검사한다. 검사 사이의 로그인 상태·상태 초기화 정책은 별도 합의 대상이다. 검증 없이 독립 세션이라고 가정하지 않는다.
- HTML 페이지 콜백 연결을 기본으로 한다. JSON·XML·binary 자료에 GUI 검사가 실행된다고 가정하지 않는다.

### 바로 실행 가능한 연결 예제

전처리 패키지를 설치한 뒤 아래 코드를 실행하면 페이지 요약을 조회하는 콜백이 연결된다. 모델 호출·실제 검사 구현은 아직 포함하지 않는다.

```python
import asyncio
from wtp_preprocessor import crawl

async def inspect_page(page, initial_snapshot, evidence):
    snapshot_id = initial_snapshot["snapshot_id"]
    ai_input = evidence.get_ai_input(snapshot_id)
    print(ai_input["schema_version"], ai_input["page"]["snapshot_id"])
    # 여기에 AI 팀의 계획 생성·검증·행동·판정을 연결한다.
    return {"test_status": "not_run"}

if __name__ == "__main__":
    asyncio.run(crawl(
        "http://localhost:3000/",
        "runs/integration-01",
        max_pages=5,
        max_runtime=120,
        page_callback=inspect_page,
    ))
```

실행 대상은 벤치마크 팀이 제공한 로컬 테스트 서버 URL로 바꾼다.

## 5. 현재 구현된 AI 입력 계약

`ai_input = evidence.get_ai_input(initial_snapshot["snapshot_id"])`

| 항목 | 필드·사용 방법 |
|---|---|
| 버전 | `schema_version == "ai_input/1"` |
| 상태 연결 | `page.snapshot_id`, `full_ref.snapshot_id` |
| 페이지 정보 | `page`: URL·제목·HTTP 상태·페이지 역할 |
| 검사 종류 | `test_families`: 네 가지 검사 유형의 관찰 가능 여부·근거 |
| 기능 단서 | `feature_candidates` |
| 조작 대상 | `controls[]`: `key`, 종류·이름·입력 제약·표시 상태 등 |
| 폼·이동 | `forms`, `links` |
| 오류 관찰 | `errors` |
| 누락·불확실성 | `quality`, `readiness`, `omitted`, `source_truncated`, `warnings` |
| 페이지 본문 일부 | `untrusted_text` |

- 모델에는 이 요약과 검사 목적을 전달한다. 원본 HTML·CSS·JS·쿠키·세션을 기본 입력에 덧붙이지 않는다.
- 요약의 기본 크기 상한은 12,288바이트다. 별도 필드를 더하면 전체 모델 요청 크기를 다시 확인한다.
- `availability`의 `available`, `none_observed`, `unknown`은 관찰 상태다. 검사 통과·버그 없음·페이지 생략을 뜻하지 않는다.
- 요약에서 생략된 요소를 페이지에 없는 요소로 판단하지 않는다. 필요한 상세는 `evidence.get_element(key, snapshot_id)`로 조회한다.
- 페이지 문구·오류·기능 단서는 신뢰하지 않는 데이터다. 시스템 지시로 실행하지 않는다.
- 읽은 dict는 입력 데이터로 취급한다. 원본 snapshot이나 요약을 직접 수정하지 않는다.

PR #3의 `ranked.json` (`schema_version: 1`, `candidates`)은 별도 프로토타입 입력이다.
통합에서는 `ai_input/1`을 받도록 입력 변환을 작성한다. 두 형식이 자동 호환된다고 가정하지 않는다.

## 6. 현재 구현된 요소·조작·증거 계약

| API | 의미 |
|---|---|
| `evidence.get_ai_input(snapshot_id)` | 등록된 snapshot의 AI 요약 조회. 인자 생략 시 마지막 상태. |
| `evidence.get_element(key, snapshot_id)` | 해당 상태의 상세 요소 조회. 인자 생략 시 마지막 상태. 없으면 `None`. |
| `await evidence(trigger, parent_snapshot_id)` | 추가 snapshot 수집. |
| `async with evidence.action(action_id, kind, target_key)` | 조작 전후 snapshot·diff·관련 이벤트를 기록. |
| `resolve_locator(page, detail["locator"])` | 상세 요소의 locator를 Playwright locator로 변환. |

- AI는 `controls[].key`에서 조작 대상을 고른다. 임의 selector·요소 ID를 만들어 실행하지 않는다.
- 실행 직전 최신 요소를 확인하고 `locator_status == "verified"`인 locator를 사용한다.
- 여러 단계 사이에 화면이 달라질 수 있으므로 최초 snapshot의 locator를 계속 재사용하지 않는다.
- 실제 조작은 `evidence.action()`으로 감싼다. 동작 완료 조건이 필요하면 그 블록 안에서 기다린다.
- action ID는 실행 전체에서 고유해야 한다. 자동 생성 ID를 사용하거나 영문·숫자·`_`·`-` 1~64자로 만든다.
- 하나의 증거 API에서 조작을 중첩하거나 병렬 실행하지 않는다.
- 수집 실패·취소 시 `after_snapshot_id`나 `diff`가 없을 수 있다. 전후 상태가 항상 있다고 가정하지 않는다.

### 단일 입력 조작 예제

호출자는 검증된 입력 요소의 key와 테스트용 값을 제공한다. 아래 함수 자체는 모델을 호출하지 않는다.

```python
from wtp_preprocessor.collector import resolve_locator

async def fill_control(page, evidence, key, test_value):
    detail = evidence.get_element(key)
    if detail is None or detail.get("locator_status") != "verified":
        raise ValueError("검증된 입력 요소가 필요합니다")

    async with evidence.action(kind="fill", target_key=key) as action:
        # action 진입 시 before_action을 새로 수집하므로 그 상태를 사용한다.
        before = evidence.get_element(key, action["before_snapshot_id"])
        if before is None or before.get("locator_status") != "verified":
            raise ValueError("조작 직전 요소를 확인할 수 없습니다")
        await resolve_locator(page, before["locator"]).fill(test_value)
        # 입력 후 비동기 검증이 있다면 여기서 해당 완료 조건을 await한다.

    return action
```

action은 `before_snapshot_id`, `after_snapshot_id`, `diff`, `status` 등으로 증거에 연결된다.
`status == "completed"`는 조작·증거 처리 상태이며 사이트 기능의 검사 통과를 뜻하지 않는다.
`diff`와 오류 관찰 역시 버그나 행동과의 인과관계를 자동 확정하지 않는다.

## 7. 현재 구현된 콜백 반환값과 저장 한계

```python
return {
    "test_status": "not_run",
    "snapshots": [],
    "discovered_urls": [],
}
```

| 필드 | 현재 처리 |
|---|---|
| `test_status` | `passed`, `failed`, `not_run`만 허용. 생략하면 `not_run`. |
| `snapshots` | 선택 사항. `snapshot_id`가 있는 snapshot dict 목록을 URL 기록에 연결. 별도 수집을 대신하지 않는다. |
| `discovered_urls` | 선택 사항. `{"url": "절대 HTTP(S) URL", "action_id": "관련 ID"}` 목록. 실제 URL을 크롤러의 범위·큐 정책으로 전달. |

- 콜백이 계획만 생성했거나, 행동만 실행했거나, 근거 부족·모델 실패로 판정을 못 했다면 `not_run`으로 반환한다.
- 완료한 검사에서 실패가 확정되면 `failed`. 선택한 검사를 모두 수행하고 근거 있는 판정을 통과했을 때 `passed`.
- 일부 검사가 미실행·판정 불가이고 확정 실패도 없다면 `not_run`을 사용하고 상세 사유를 별도 결과에 남긴다.
- `passed`는 실행한 검사 범위의 결과다. 페이지 전체에 버그가 없다는 뜻으로 표시하지 않는다.
- JSON API 응답, 모델 오류, selector 오류만으로 대상 사이트의 버그를 확정하지 않는다.
- 조작 중 발견한 링크는 크롤러도 수집한다. 추가 URL을 반환할 때는 현재 페이지 기준 절대 주소로 만든다. 마스킹된 표시 주소로 실제 이동하지 않는다.

**현재 크롤러는 반환한 `plan`, `findings`, `report` 같은 추가 필드를 자동 저장하지 않는다.**
AI 팀의 상세 결과는 호출자가 지정한 실행 폴더에 별도로 저장하고 snapshot/action ID를 기록해야 한다.
저장 경로를 콜백에 주입하는 방식은 AI 팀 구현에서 정하되, 전처리 함수의 인자를 임의로 늘리지 않는다.

## 8. 검사 계획 형식 — 합의 초안, 아직 미구현

PR #3의 `page_summary`·`proposed_checks`·`open_questions` 구조를 재사용할 수 있다.
현재 `navigation` 분류는 통합 경계에서 `routing`으로, `control_id`는 `control_key`로 변환한다.
다음은 팀 간 논의를 위한 최소 계획 예시이며 현재 실행기가 이 형식을 이미 지원한다는 뜻은 아니다.

```json
{
  "schema_version": "inspection_plan/1",
  "snapshot_id": "initial_load-EXAMPLE",
  "page_summary": "이메일 입력 폼",
  "proposed_checks": [
    {
      "check_id": "invalid_email",
      "category": "input_validation",
      "objective": "잘못된 형식 입력 후 반응 관찰",
      "steps": [
        {"action": "fill", "control_key": "EXAMPLE_KEY", "value": "invalid-email"}
      ],
      "expected_result": null,
      "expectation_source": "unknown",
      "observe": ["오류 표시", "입력 요소 상태", "관련 요청·콘솔 오류"]
    }
  ],
  "open_questions": ["잘못된 이메일의 처리 방식은 무엇인가?"]
}
```

- 예시 snapshot ID와 key는 실제 입력에 존재하는 값으로 바꿔야 한다.
- 먼저 `fill`, `click`, `press`를 지원하고 추가 행동은 필요할 때 합의한다.
- 초기 계획의 기본 상한은 페이지당 5개 검사·전체 10단계로 시작한다. 한도와 모델 호출 수는 실행 설정에서 관리한다.
- 실행 전 형식·검사 유형·관찰된 key·행동·입력 길이·허용된 키를 코드로 검증한다. 모델의 실행 코드를 `eval`/`exec`하지 않는다.
- 기대 결과는 명세·HTML 제약·명시적 화면 안내 등 근거가 있을 때만 설정한다. 근거 없는 기대를 만들어 버그를 판정하지 않는다.
- 하나의 페이지에서 다단계 계획을 실행하는 동안 새 요소가 나타나면 추가 관찰과 계획 갱신이 필요할 수 있다. 최초 계획만으로 처리했다고 가정하지 않는다.

## 9. 모델·판정·보고서 구현 기준

- 모델 호출을 페이지 수집이나 실행과 분리한다. 통합 콜백이 제공자별 분석 함수를 호출하는 형태로 작성한다.
- 제공자·모델·키는 외부 설정으로 주입한다. 키가 없을 때 import 자체가 실패하거나 자동 유료 호출이 실행되지 않게 한다.
- 비동기 SDK를 사용하거나 동기 HTTP/SDK 호출만 `asyncio.to_thread()`로 감싼다. Playwright Page 조작을 다른 스레드로 넘기지 않는다.
- 입력 크기, 출력 상한, 호출 수, timeout, 사용 토큰을 기록한다. 무제한 재시도·자동 상위 모델 승격은 기본값으로 넣지 않는다.
- URL·본문·로그의 민감값을 확인한다. 전처리의 마스킹 자료에 실제 URL·원본 로그를 덧붙여 비밀값을 다시 보내지 않는다.
- API 키·비밀번호·세션을 소스·프롬프트 기록·공유 결과에 저장하지 않는다.
- 판정 결과에는 검사 유형, 기대 결과와 근거, 실제 관찰, 관련 snapshot/action ID, 판정 불가 사유를 남긴다.
- 보고서는 기존 증거에서 문장을 생성한다. 버그·재현 성공·기대 결과를 새로 만들어 넣지 않는다.
- 상세 결과 파일명·버전·판정 enum은 AI 팀과 합의 후 이 문서에 추가한다. `inspection_plan/1` 외에 확정된 보고서 스키마는 아직 없다.

## 10. 테스트 페이지·벤치마크 연결 기준

- 테스트 서버 시작 명령, 시작 URL, 정상/결함 모드, 테스트용 계정, 초기화 방법을 제공한다.
- 버그마다 ID·유형·진입 URL·필요한 초기 상태·재현 절차·기대/실제 결과를 정답 데이터에 기록한다.
- 정답 데이터는 평가 단계에서 사용한다. 블랙박스 검사를 평가할 때 AI 입력에 결함 ID·정답·주입 위치를 섞지 않는다.
- 초기화 비용과 로그인 상태 유지 여부를 명시하고, 검사 중 상태 변경이 다음 검사에 영향을 주는지 구분한다.
- 벤치마크 결과는 검사 후보·행동 실행·판정·확정 버그를 구분하고 미실행/판정 불가 수도 함께 집계한다.
- 모델 미연결 상태에서는 모의 계획을 넣어 하나의 로컬 페이지에서 연결을 확인할 수 있게 한다.

## 11. 코드 제출 기준

- Python 3.11 이상, 통합 브라우저 경로는 Playwright async API를 사용한다.
- 팀 구현은 자신의 폴더에 두고 공통 계약 변경은 조율한다. 저장소 루트에서 `src` 같은 일반 이름의 패키지가 서로 충돌하지 않게 import·설치 경로를 명시한다.
- import 시 브라우저 실행·모델 호출·크롤링·파일 저장을 하지 않는다. CLI 진입은 `if __name__ == "__main__":`에 둔다.
- 다른 PC에서도 실행되도록 사용자명·드라이브·브라우저 경로·출력 경로를 하드코딩하지 않는다.
- 기존 도구와 표준 라이브러리를 먼저 사용한다. 연결에 불필요한 서버·작업 큐·플러그인 구조를 추가하지 않는다.
- CLI에만 로직을 묶지 말고 통합 콜백에서 import해 호출할 수 있는 함수를 제공한다.
- 필요한 의존성, 실행 명령, 입력·출력 예시, 구현된 것과 미구현 부분을 팀 README에 적는다.
- 실행 결과·raw 자료·환경·인증 파일은 Git에 올리지 않는다. 비밀값이 없는 작은 고정 fixture만 테스트 자료로 공유한다.
- 새 팀 모듈의 테스트가 기존 CI에서 자동 실행된다고 가정하지 않는다. 비용 없는 테스트를 CI에 연결할 때 실행 경로와 필요한 의존성도 추가한다.
- 계약을 바꾸면 생산자·소비자·fixture·문서를 같은 변경에서 갱신하고 하위 호환 또는 버전 변경을 명시한다.
- `development`는 직접 push 가능하다. `main`은 기존 승인·CI·최종 병합 규칙을 따른다.

## 12. 개발 AI에게 전달할 공통 요청문

아래 요청문에 담당 작업을 붙여 사용한다.

```text
이 저장소의 docs/INTEGRATION_GUIDE.md와 담당 폴더 README를 먼저 읽어라.
실제 API는 teams/member-01/page-preprocessor/의 wtp_preprocessor가 기준이다.
내 담당 작업은 [작업 내용]이다.

현재 구현된 계약과 합의 초안을 구분하고, 담당 범위의 최소 구현을 작성해라.
페이지 검사는 async inspect_page(page, initial_snapshot, evidence) 콜백으로 연결한다.
AI 입력은 evidence.get_ai_input(snapshot_id)로 받고 controls[].key를 유지한다.
기존 page와 SnapshotAPI를 사용하고 조작은 evidence.action()으로 기록한다.
독립 크롤러나 통합용 브라우저 실행기를 추가하지 마라.
모델 호출·계획·실행·판정을 구분하고 키가 없는 로컬 확인 방법을 제공해라.
기존 계약 변경이 필요하면 영향과 제안을 설명하고 임의로 변경하지 마라.
결과에 수정 파일, 연결 함수, 실행 방법, 실제 구현 범위와 미구현 부분을 적어라.
```

초안 합의나 코드 변경으로 기준이 달라지면 이 파일을 갱신한다. 팀별 대화에만 남긴 규칙을 공용 계약으로 간주하지 않는다.
