# WebTestPilot 전처리 도구

이 저장소에는 **전처리·우선순위 선정**과 **단일 페이지 AI 검사 초기 구현**이 있습니다.
정적 크롤러가 페이지·엔드포인트·폼·화면 동작의 단서를 수집하고, ranker가 추가 검증
가치가 높은 후보를 고릅니다. 정적 결과에 선택 후보가 0개이고 정상 HTML 페이지가
있으면 Playwright로 **시작 화면 1개만** 관찰해 입력·클릭 요소와 같은 출처의
fetch/XHR 요청을 보강합니다. 이 단계에서 AI를 호출하거나 버그 리포트를 작성하지는 않습니다.
단일 페이지 AI 검사는 `src/ai_inspection/ai_inspector.py`에서 별도로 실행하며, Claude가 검사
계획을 만들고 Playwright가 선택적으로 실행한 뒤 관찰 결과를 저장합니다.
`--input`으로 전처리의 `*_ranked.json`을 받아 상위 후보를 검사할 수 있습니다.
버그 판정과 리포트는 후속 목표이며, AI 검사 사용법은
[AI_README.md](docs/ai_inspection/AI_README.md)에 정리했습니다.

## 디렉토리 구성

```text
src/
  preprocessing/    # 크롤링·초기 화면 관찰·우선순위 선정·결과 요약과 테스트
  ai_inspection/    # 전처리 JSON 입력·Claude 검사 계획·Playwright 실행과 테스트
docs/
  preprocessing/    # 전처리 사용법·우선순위 기준·조사 문서
  ai_inspection/    # AI 검사기 사용법
결과파일/            # 전처리 결과와 검사 결과
```

아래 명령은 프로젝트 루트에서 실행합니다. `python -m src.…` 형식을 권장하며,
새 경로의 `.py` 파일을 직접 실행하는 방식도 지원합니다. `src`와 각 하위 폴더의
`__init__.py`는 모듈 가져오기와 전체 테스트 검색을 위한 패키지 파일입니다.
AI 검사기는 현재 전처리의 HTML 파서와 설치 브라우저 탐색 함수를 재사용하므로
`src/ai_inspection` 폴더만 따로 복사하면 실행되지 않습니다.

## 준비

아래 명령은 프로젝트 루트에서 PowerShell로 실행합니다. 현재 코드의 정적 수집·순위
계산은 Python 표준 라이브러리만 사용합니다. SPA 초기 화면 관찰을 사용하려면
Playwright가 필요합니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install playwright
```

파이프라인은 설치된 Chrome 또는 Edge를 자동으로 찾습니다. 둘 다 없다면
`.\.venv\Scripts\python.exe -m playwright install chromium`으로 Playwright용
Chromium을 설치하거나 실행 시 `--browser-executable`로 브라우저 경로를 지정해야 합니다.

## 기본 실행: 수집부터 우선순위까지

```powershell
.\.venv\Scripts\python.exe -m src.preprocessing.webtestpilot https://demo.playwright.dev/todomvc/ --max-depth 4 --max-pages 300 -o "결과파일\최종결과\TodoMVC_ranked.json" --save-evidence "결과파일\TodoMVC_crawl.json"
.\.venv\Scripts\python.exe -m src.preprocessing.result_summary "결과파일\최종결과\TodoMVC_ranked.json"
```

`-o`는 **AI+Playwright에 넘길 우선순위 후보** JSON입니다. `--save-evidence`는
수집 근거 JSON도 남길 때만 사용합니다. 생략하면 순위 결과 파일 하나만 저장합니다.
출력 폴더는 미리 존재해야 합니다. 결과 파일을 확인할 때는 다음을 구분하세요.

- `*_crawl.json`: 방문 페이지, 엔드포인트, 폼, 입력, 동적 후보와 수집 지표 등 근거.
- `*_ranked.json`: 선택 후보의 `priority_score`, `priority_reasons`, 위험 플래그와 발견 페이지.

기본값은 깊이 3, 최대 방문 페이지 100, 요청 시간 제한 10초, 정적 요청 간 지연 0초입니다.
`--max-depth`와 `--max-pages`는 각각 링크 탐색 깊이와 **방문 페이지** 상한이며,
총 HTTP 요청 수의 상한은 아닙니다. 공개 사이트에는 `--delay 0.2`처럼 지연을
설정하세요. 필요하면 `--timeout`, `--no-sitemap`, `--top`, `--min-score`도 조정할 수
있습니다. `--static-only`를 지정하면 브라우저 관찰을 건너뜁니다.

브라우저 관찰은 정적 순위 후보가 0개일 때만 실행됩니다. 브라우저나 Playwright를
사용할 수 없으면 정적 결과를 저장하고 `pipeline.warning`에 이유를 남깁니다.
`pipeline.mode`에서 정적 수집만 사용했는지, 초기 화면을 추가 관찰했는지 확인할
수 있습니다. 첫 화면에서 후보가 보이지 않는다고 사이트에 검증할 기능이 없다는
뜻은 아닙니다.

## 단계별 실행 (정적 결과 디버깅용)

```powershell
python -m src.preprocessing.crawler https://example.com --max-depth 3 --max-pages 100 -o result.json
python -m src.preprocessing.result_summary result.json
python -m src.preprocessing.ranker result.json -o ranked_candidates.json
python -m src.preprocessing.result_summary ranked_candidates.json
python -m unittest discover -s src -t . -v
```

`crawler.py` 단독 실행은 GET으로만 페이지를 요청합니다. 폼 제출·버튼 클릭은 하지
않고 후보로 기록하며, 이 단계의 JSON에는 우선순위 점수가 없습니다. 링크된
PDF·DOCX·CSV·ZIP 등 정적 파일은 엔드포인트 단서로 기록할 수 있지만 페이지로
방문하지 않습니다. 입력 필드의 제약은 기록하되 입력값이나 숨김 필드의 `value`는
저장하지 않습니다. 브라우저 관찰과 달리 JavaScript를 실행하지 않으므로
SPA에서 후보가 0개일 수 있습니다.

점수 기준, 후보 제외·선정 규칙, JSON 요약 방법은 [rank_README.md](docs/preprocessing/rank_README.md)에
설명했습니다. 점수는 **버그 가능성**이 아니라 **추가 검증 가치**입니다.

## 전처리 단계의 범위와 주의사항

브라우저 관찰은 시작 화면을 렌더링하지만 요소를 클릭하거나 폼을 제출하지
않습니다. 단, 화면 로딩 중 사이트의 JavaScript가 자체 네트워크 요청을 보낼 수
있습니다. 로그인 후 화면, 입력 후 나타나는 동작, CAPTCHA·MFA, 무한 스크롤,
실제 기능 성공 여부와 버그 존재는 이 전처리 단계에서 판정하지 않습니다.

허가받은 테스트 대상에만 사용하고 사이트의 크롤링 정책을 확인하세요. 현재 코드는
robots.txt를 자동으로 검사하거나 따르지 않습니다. 공개 사이트를 대상으로 할 때는
요청량과 접근 제한을 직접 확인해야 합니다.
