# 팀원 1 — 페이지 전처리·URL 관리·크롤링

- 담당자: `bibimmando` (총괄·최종 병합)
- 구현 위치: [`page-preprocessor/`](page-preprocessor/)
- 기능 브랜치에서 작업하고 `development`에 PR을 올린다.

## 하는 일

시작 URL을 FIFO 큐에 넣고, 동일 출처의 발견된 URL을 순서대로 방문한다. 페이지를 관찰하면서 URL 그래프를 만들고, 페이지 상태인 `snapshot`과 AI 검사 입력인 `ai_input`을 저장한다. 중요도에 따른 페이지 생략은 현재 적용하지 않는다.

전처리는 기능·입력 검증·라우팅·UI 표시 검사에 필요한 근거를 제공한다. AI 검사 콜백을 연결하지 않으면 실제 버그 판정은 실행하지 않으며 `test_status=not_run`이다. 이 패키지는 실행 중 모델 API를 호출하지 않아 타임리 키가 필요하지 않다.

## 1. 설치

Python 3.11 이상과 Chromium이 필요하다. 저장소 루트에서 시작한다.

### Windows / PowerShell

```powershell
cd teams/member-01/page-preprocessor
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m playwright install chromium
```

### macOS / Linux

```bash
cd teams/member-01/page-preprocessor
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
.venv/bin/python -m playwright install chromium
# Linux에서 브라우저 시스템 라이브러리가 부족하면:
# .venv/bin/python -m playwright install --with-deps chromium
```

아래 실행 예시는 위 패키지 폴더에서 실행한다. macOS/Linux에서는 `.\.venv\Scripts\python.exe`를 `.venv/bin/python`으로 바꾸면 된다.

## 2. 실행

### URL 하나 수집

```powershell
.\.venv\Scripts\python.exe -m wtp_preprocessor single https://www.web-scraping.dev/login --output runs/login
```

`single`은 시작 URL 하나만 처리한다. 발견한 링크는 그래프에 기록하지만 다음 페이지를 방문하지 않는다.

### 발견한 URL 순회

```powershell
.\.venv\Scripts\python.exe -m wtp_preprocessor crawl https://www.web-scraping.dev/ --output runs/site-01 --max-pages 100 --max-runtime 600 --page-delay 2
```

최대 100개 URL 또는 600초까지 실행한다. 파일 후보의 HEAD 처리도 URL 상한에 포함된다. 사이트의 robots 규칙이 요구하는 지연이 더 길면 그 간격을 적용한다. 매 실행에는 새 출력 폴더를 사용한다.

### 준비 상태·요약 예산 지정

```powershell
.\.venv\Scripts\python.exe -m wtp_preprocessor single http://localhost:3000 --output runs/local-ready --ready-selector "[data-testid=app-ready]" --summary-max-bytes 8192
```

| 옵션 | 기본값 | 의미 |
|---|---|---|
| `--output` | 필수 | 결과를 저장할 실행 폴더 |
| `--max-pages` | 50 | crawl 모드의 최대 처리 URL 수 |
| `--max-runtime` | 300초 | crawl 모드 실행 시간 상한 |
| `--page-delay` | 1초 | crawl 모드 페이지 요청 간격; robots와 내부 최소 간격도 적용 |
| `--collection-timeout` | 15초 | 초기 이동·수집에 적용하는 제한 시간 |
| `--summary-max-bytes` | 12,288 | AI 입력 JSON 크기 상한; 최소 2,048바이트 |
| `--ready-selector` | 없음 | 앱 준비 여부를 확인할 CSS selector |
| `--hash-policy` | `conservative` | 일반 앵커는 묶고 SPA 경로 해시는 보존 |
| `--headed` | 꺼짐 | 브라우저 창 표시 |

`preserve_all`은 모든 해시 주소를 방문 후보로 유지하고, `strip_routes`는 경로 해시도 합친다. 후자는 SPA 화면을 놓칠 수 있다. 현재 깊이 제한·중단 지점 재시작 옵션은 없다.

## 3. 출력 폴더 구조

```text
runs/site-01/
├── run_summary.json                   # 실행 요약
├── graph.json                         # URL 노드·간선·대기 목록
├── urls.jsonl                         # URL별 상태, 한 줄에 한 JSON
├── snapshots/
│   └── <snapshot_id>.json             # 상세 페이지 상태
├── ai_inputs/
│   └── <snapshot_id>.json             # 같은 상태의 AI 입력 요약
├── actions/                           # action 콜백을 사용할 때 생성
│   └── <action_id>.json               # 조작 전후·diff·오류
├── resources/                         # 파일 후보를 확인할 때 생성
│   └── <URL_ID>.json                  # HEAD 응답 메타데이터
└── raw/
    ├── README.txt
    └── <URL_ID>/                      # 페이지별 원본 폴더
        ├── page.json                 # URL·제목·snapshot·증거 경로 인덱스
        ├── 0001_initial_response_<hash>.html
        ├── <번호>_rendered_dom_<hash>.html
        ├── <번호>_stylesheet_<hash>.css
        ├── <번호>_script_<hash>.js
        ├── <번호>_inline_style_<hash>.css
        ├── <번호>_inline_script_<hash>.js
        └── <snapshot_id>.png          # 전체 페이지 스크린샷
```

파일 이름은 예시다. 최초 응답은 MIME에 따라 HTML·JSON·XML·TXT로 저장된다. 실제로 요청된 CSS/JS와 존재하는 인라인 코드만 수집하며, 수집 실패·크기 상한에 따라 일부 파일이 없을 수 있다.

### 페이지와 상태를 연결하는 기준

- `URL_ID`: 실제 정규화한 요청 URL의 SHA-256 전체 64자리. 그래프 노드 ID와 raw 폴더 이름이 같다. 쿼리·보존한 해시가 다르면 별도 ID다.
- `snapshot_id`: `initial_load-<UUID 일부>`처럼 수집 시점과 매번 새로 생성한 식별 문자열을 합친 값. 같은 페이지도 다시 수집하면 다른 ID가 생긴다.
- `initial_load`: URL을 연 뒤 최초 관찰. 일반 CLI 실행은 이 상태만 생성한다.
- `before_action` / `after_action`: `SnapshotAPI.action()`으로 감싼 조작의 직전·직후 관찰. 검사 팀이 조작 콜백을 연결해야 생성된다.

한 URL 방문 중의 리다이렉트와 조작 전후 자료는 같은 raw 폴더에 모은다. 실제 도착 URL은 `page.json`의 snapshot별 `final_url`에 기록한다. 큐에서 새 URL을 방문하면 새 폴더를 사용한다. 같은 문서의 해시 이동에서는 최초 HTTP 응답이 이전 폴더의 파일을 참조할 수 있다.

`page.json`의 `snapshot_ref`와 `ai_input_ref`는 실행 출력 폴더 기준이다. 원본 `artifacts` 경로는 실행한 컴퓨터의 절대 경로이므로 결과 폴더를 다른 컴퓨터로 옮기면 경로를 다시 연결해야 한다.

## 4. 결과를 읽는 순서

1. `run_summary.json`: 종료 이유, 처리 URL 수, 대기 수, 수집·검사 상태를 확인한다. `max_pages`나 시간 상한으로 끝나면 전체 탐색 완료가 아니다.
2. `urls.jsonl` / `graph.json`: URL별 `snapshot_id`, 처리 상태, 링크 관계와 대기 목록을 확인한다. 발견한 링크와 실제 이동 간선을 구분한다.
3. `ai_inputs/<snapshot_id>.json`: AI 검사에 보낼 요약을 확인한다.
4. `snapshots/<snapshot_id>.json`: 요약에서 빠진 상세 요소·이벤트·리소스를 확인한다.
5. `raw/<URL_ID>/page.json`: 해당 페이지의 HTML·CSS·JS·PNG 파일 경로를 찾는다.

### snapshot과 AI 입력의 차이

| 구분 | 주요 내용 |
|---|---|
| snapshot (`schema_version=0.2`) | URL·HTTP·제목·본문·요소·폼·링크·위치/스타일·이벤트·리소스·원본 파일 참조 |
| AI 입력 (`schema_version=ai_input/1`) | 페이지 정보·기능 후보·검사 유형·조작 요소·폼·링크·오류·수집 한계·생략 수·크기 |

둘은 같은 `snapshot_id`로 연결한다. AI 입력에는 원본 HTML/CSS/JS, 쿠키·헤더, 실제 입력값을 자동 첨부하지 않는다. 입력값은 존재 여부와 길이 등으로 표현한다.

`test_families`는 `functional`, `input_validation`, `routing`, `ui` 네 가지를 유지한다. 각 `availability`는 `available`, `none_observed`, `unknown`이며, 관련 근거의 관찰 여부를 뜻한다. 검사 통과나 페이지 생략 판정이 아니다.

`quality.status`의 `complete`, `partial`, `failed`는 수집 상태다. 본문 잘림은 `quality.truncated`, 요약 생략은 `omitted`와 `warnings`도 함께 확인한다. HTTP 200·수집 complete가 페이지 기능 정상이나 차단 화면 부재를 보장하지 않는다.

`analysis.json`, `pages.csv`, 실행별 결과 보고서는 CLI가 자동 생성하는 파일이 아니다. 별도 사후 분석에서 만들 수 있다.

## 5. AI 검사 팀 연결

```python
import asyncio
from wtp_preprocessor import crawl

async def inspect_page(page, initial_snapshot, evidence):
    ai_input = evidence.get_ai_input(initial_snapshot["snapshot_id"])
    # AI 팀: ai_input으로 계획을 만들고 page에서 검사한다.
    # 추가 요소 정보: evidence.get_element(control_key, snapshot_id)
    return {"test_status": "not_run"}

asyncio.run(crawl(
    "http://localhost:3000",
    "runs/with-inspector",
    page_callback=inspect_page,
))
```

콜백의 검사 결과는 `passed`, `failed`, `not_run` 중 하나다. 요소 조작은 `evidence.action()`으로 감싸 전후 상태와 diff를 기록한다. 조작 후 응답·화면 전환 완료가 필요하면 해당 조건까지 블록 안에서 기다린다. 상세 예제는 [AI 입력·조작 증거 규격](page-preprocessor/docs/AI_INPUT_CONTRACT.md)을 참고한다.

## 6. 테스트와 현재 검증

```powershell
.\.venv\Scripts\python.exe -m pytest -q
# Windows 임시 폴더 권한 문제가 있으면 짧은 새 경로 지정:
.\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp ("runs/t-" + [guid]::NewGuid().ToString("N").Substring(0,8))
```

2026-10-06의 실사이트 확대 탐색에서는 URL 100개를 약 347.7초 동안 처리했다. snapshot·AI 입력·raw 폴더 각각 99개, PDF HEAD 기록 1개, 대기 URL 87개였다. 원본 경로 1,164개의 존재를 확인했다. AI 버그 검사와 모델 호출은 실행하지 않았다. 당시 raw 원문·스크린샷·실행 결과는 이 저장소 업로드에 포함하지 않는다.

## 7. 범위와 제한

- 동일 scheme·host·port의 발견된 URL만 순회하며 robots 규칙과 지연을 적용한다. robots 금지·인증·CAPTCHA를 우회하지 않는다.
- 파일 후보는 HEAD로 확인하고 binary 본문을 다운로드하지 않는다. sitemap urlset은 크기·URL 수 제한 안에서 읽지만 sitemap index 재귀와 gzip 해제는 지원하지 않는다.
- iframe·shadow DOM 내부 요소와 실제로 요청되지 않은 lazy 리소스는 수집하지 않는다. 로그인 자동화·무한 스크롤·버튼 클릭 테스트는 검사 콜백에 연결해야 한다.
- 요소 300개·링크 1,000개·본문 6,000자, 응답 파일당 2MiB·페이지당 10MiB 저장 상한이 있다. 렌더링 DOM과 스크린샷은 이 응답 저장 상한과 별도로 저장한다.
- 준비 selector가 없으면 `heuristic_unverified`로 기록한다. 알려진 비밀값을 마스킹하지만 임의의 개인정보 전체 탐지를 보장하지 않는다.
- `runs/`, 가상환경·캐시·인증 자료는 Git에서 제외한다. raw 원문과 이미지는 로컬 증거용이다.
