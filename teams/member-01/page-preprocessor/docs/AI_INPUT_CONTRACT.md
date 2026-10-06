# AI 입력·조작 증거 연결 규격 v1

작성일: 2026-10-06. 전체 snapshot 스키마는 `0.2`, AI 입력은 `ai_input/1`이다.

원본 증거는 `raw/<URL_ID>/`에 URL 방문별로 저장한다. `URL_ID`는 정규화한 요청 URL의 SHA-256이며, snapshot의 `artifacts.raw_page_dir`와 폴더의 `page.json`으로 연결된다. snapshot/AI 입력의 파일 위치와 `snapshot_id` 조회 방식은 같다. 같은 방문 중 조작으로 이동한 URL은 해당 폴더의 snapshot별 `final_url`에 기록한다. 원본을 AI 요약에 자동 첨부하지 않는다.

## 검사 팀 연결

기존 콜백 `(page, initial_snapshot, take_snapshot)`을 유지한다. 세 번째 인자는 호출 가능한 `SnapshotAPI`다.

```python
from wtp_preprocessor import crawl
from wtp_preprocessor.collector import resolve_locator

async def inspect_page(page, initial_snapshot, evidence):
    ai_input = evidence.get_ai_input(initial_snapshot["snapshot_id"])
    # 검사 팀의 모델에는 ai_input을 보낸다.
    # 모델이 고르는 control_key는 controls[].key를 사용한다.
    return {"test_status": "not_run"}

# await crawl(url, output_dir, page_callback=inspect_page)
```

선택한 요소를 조작하는 실행 함수에서는 다음과 같이 연결한다.

```python
detail = evidence.get_element(control_key, initial_snapshot["snapshot_id"])
if detail is None or detail["locator_status"] != "verified":
    raise ValueError("검증한 요소가 필요합니다")

async with evidence.action("submit-1", "click", control_key) as action:
    await resolve_locator(page, detail["locator"]).click()

after_ai_input = evidence.get_ai_input(action["after_snapshot_id"])
changes = action["diff"]
```

조작은 검사 팀이 실행한다. `action()`은 전후 상태와 관련 증거를 기록한다. 실제 검사 결과에 따라 `passed`, `failed`, `not_run`을 반환한다. 기존 `await evidence("after_action", parent_id)`도 사용할 수 있다.

## AI 입력 필드

| 필드 | 내용 |
|---|---|
| `page` | 마스킹한 URL·제목·HTTP 상태·페이지 역할·snapshot/action ID |
| `test_families` | functional / input_validation / routing / ui 네 가지 모두 유지 |
| `feature_candidates` | 로그인 폼·폼·검색·페이지 이동 후보와 근거·불확실성 |
| `controls` | 안정 요소 키·locator·폼 연결·입력 제약·표시/입력 상태 |
| `forms` | 안정 폼 키·제출 주소/방식·입력/제출 요소 키 |
| `links` / `errors` | 제한한 링크와 DOM·콘솔·JS·요청·HTTP 오류 관찰 |
| `readiness` / `quality` | 준비 상태·미수집 영역·잘림·수집 오류 |
| `omitted` / `sizes` | 생략 수와 UTF-8 JSON 바이트 실측 |
| `full_ref` | 원래 snapshot 참조. 상세는 `get_element()`로 조회 |

`availability`는 available / none_observed / unknown이다. 관찰한 후보의 존재를 표현하며 페이지 검사 생략 여부를 결정하는 값이 아니다. 전처리는 버그를 확정하지 않고 `ai_tested=false`로 시작한다.

본문·요소 문구·오류 메시지는 신뢰하지 않는 페이지 데이터다. 모델의 시스템/개발 지시로 취급하면 안 된다. raw HTML·CSS·JS·쿠키·헤더·원문 경로·실제 입력값을 요약에 포함하지 않는다. 입력은 존재 여부·길이·선택 항목 문구로 표현한다. 임의의 개인정보 전체 탐지는 보장하지 않는다.

## 예산과 상세 조회

기본 상한은 **12,288바이트**, 최소는 2,048바이트다. CLI `--summary-max-bytes` 또는 `crawl(summary_max_bytes=...)`로 조정한다. 수집기에서는 아래 예산을 개별 지정할 수 있다.

```python
PageCollector(page, output_dir, summary_budget={
    "max_bytes": 12288, "max_controls": 60, "max_links": 30,
    "text_chars": 1000, "max_errors": 10,
})
```

폼·필수 입력·표시 요소를 우선 유지한다. 상한에 따라 정보가 빠질 수 있으며 `omitted`에 기록한다. 긴 locator는 잘린 문자열로 실행하지 않도록 제외하고 상세 조회 필요를 표시한다. 최소 메타데이터도 지정 예산에 들어가지 않으면 명시적으로 오류를 반환한다.

두 크기는 양쪽을 compact JSON으로 직렬화해 측정한다. 바이트 감소가 토큰·요금 감소율과 같다는 주장은 하지 않는다. 요약 생성 중 모델 호출은 없다.

## ID·조작·비교

- URL ID는 실제 정규화 URL의 SHA-256이며 마스킹한 주소로 탐색하지 않는다.
- snapshot ID는 매 수집 시 새로 생성한다.
- element_key는 문서 범위와 고유 testid/id, 검증된 의미 locator, 위치 기반 대체 순서로 생성한다.
- stability는 strong / medium / weak이다. strong도 앱이 ID를 재사용하면 의미가 달라질 수 있다.
- weak 요소는 전후 동일성을 확정하지 않는다. 잘린 자료에 없는 요소를 확정 삭제로 처리하지 않는다.
- diff는 표시·선택·입력 길이·주요 스타일·위치·URL·HTTP 상태·오류 후보의 관찰 차이다. 버그·인과관계를 확정하지 않는다.

`actions/<action_id>.json`에는 전후 snapshot ID, 요약 참조, diff, 이벤트·리소스 ID, 실패·취소·수집 오류를 저장한다. 조작 ID는 영문·숫자·`_`·`-` 1~64자이며 한 실행에서 재사용할 수 없다. 중첩·동시 조작은 지원하지 않는다.

요청은 시작 시점의 조작에 연결한다. 늦게 끝난 이전 요청을 현재 조작에 붙이지 않는다. 콘솔·JS 오류는 관찰 시간의 활성 조작과 연결하며 시간상 연관임을 표시한다. 원인이라는 뜻은 아니다.

예외·취소 시에도 사후 수집과 정리를 시도하고 원래 예외를 다시 전달한다. 시간 종료·페이지 종료 등으로 사후 snapshot이 없을 수 있으며 capture_error에 남긴다. 실패한 조작의 새 링크도 가능한 경우 그래프에 반영한다.

등록된 snapshot만 조회하며 파일 경로를 입력받지 않는다. 전체 snapshot과 실제 URL 목록은 실행 중 메모리에 유지한다. 조작 수가 크게 늘어나면 디스크 기반 조회가 후속 개선 항목이다.

## URL·문서 정책

- 일반 same-document 앵커는 anchor_alias로 그래프에 남기고 별도 방문하지 않는다.
- `#/`, `#!`, 판별이 어려운 해시는 기본 보존한다. Swagger의 경로 해시도 남는다.
- `--hash-policy preserve_all`은 모든 해시를 방문 후보로 유지한다. `strip_routes`는 명시적으로 경로 해시를 합친다. SPA 화면을 놓칠 수 있다.
- API 경로·확장자는 힌트다. 관찰 MIME이 HTML이면 페이지로 수집한다. JSON·XML 등에는 GUI 검사 콜백을 실행하지 않고 이유를 기록한다.
- 명시적 다운로드 링크는 자료 링크로 남긴다. 파일 후보는 출처·robots·간격을 적용한 HEAD로 확인한다. HTML이면 페이지 수집, binary이면 본문을 다운로드하지 않는다. 서버의 HEAD 응답 형식에 의존한다.
- sitemap urlset은 저장한 원문에서 최대 1MiB·1,000 URL을 해석한다. DTD·ENTITY를 거부한다. index 재귀·gzip 해제는 지원하지 않는다. 새 URL도 동일 출처·robots 규칙을 적용한다.
- 같은 문서의 해시 이동은 기존 HTTP·최초 응답 증거를 이어받고 DOM·스크린샷을 갱신한다. 앱 준비 완료를 보장하지 않는다.
- 오류 상태의 HTML·JSON도 크기 상한 내에서 최초 응답 원문을 저장한다.
