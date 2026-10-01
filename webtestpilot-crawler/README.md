# WebTestPilot Crawler Prototype

Playwright로 사이트를 안전하게 탐색하고, 결정적 오류와 AI 검토 후보를 분리하는 프로토타입이다. 전체 HTML을 모델에 보내지 않고 축약된 상태와 행동 증거만 `ai_queue.jsonl`에 남긴다.

## 설치와 실행

```powershell
cd C:\path\to\webtestpilot-crawler
python -m pip install -e ".[test]"
playwright install chromium
python -m webtestpilot_crawler https://허가된-테스트-사이트.example --output crawl-results
```

브라우저 화면을 보며 확인하려면 `--headed`를 사용한다.

```powershell
python -m webtestpilot_crawler http://127.0.0.1:8000 `
  --max-pages 30 `
  --max-depth 3 `
  --max-actions-per-page 6 `
  --max-runtime 120 `
  --output crawl-results
```

## 주요 결과

- `crawl_report.json`: 방문 상태, 그래프 간선, 결정적 탐지, 라우팅 통계
- `ai_queue.jsonl`: 우선순위 순으로 정렬된 축약 AI 검토 후보
- `hybrid_ai_input.jsonl`: 로컬 AI CLI에 줄 수 있는 최소 입력(일반 실행에서도 생성)
- `summary.md`: 사람이 빠르게 확인할 수 있는 실행 요약

`crawl_report.json`의 `root_causes`는 여러 페이지에서 반복된 JavaScript·네트워크 오류를
원인 단위로 병합한다. `preprocessing`에는 공통 검색창/메뉴 제거 수와 AI 후보 중복 제거 수가
기록된다. 실제 모델을 호출할 때는 원본 보고서 전체가 아니라 `hybrid_ai_input.jsonl`을 입력으로
사용한다.

## API 없는 AI 입력 벤치마크

개발 단계에서는 `--benchmark`로 API를 호출하지 않고 세 가지 AI 입력 전략의 크기를 비교한다.

```powershell
python -m pip install -e ".[test,benchmark]"
python -m webtestpilot_crawler https://허가된-테스트-사이트.example `
  --benchmark `
  --benchmark-tokenizer o200k_base `
  --max-pages 10 `
  --max-depth 2 `
  --max-actions-per-page 4 `
  --max-runtime 30 `
  --output benchmark-results
```

`--benchmark-tokenizer heuristic`을 사용하면 `tiktoken` 없이 문자 수 기반 추정으로 실행할 수 있다.
기본값 `auto`는 로컬 `tiktoken`의 `o200k_base`를 사용하고, 설치되지 않았으면 자동으로 추정 방식으로 전환한다.

- `raw_ai_input.jsonl`: 전체 HTML과 브라우저 증거를 전달하는 AI-first 기준선
- `standard_crawler_input.jsonl`: 모든 페이지의 가시 텍스트와 시맨틱 정보를 전달하는 일반 크롤러 기준선
- `hybrid_ai_input.jsonl`: 결정적으로 판단하지 못한 후보만 전달하는 WebTestPilot 입력
- `token_comparison.json`: 문자·바이트·토큰·라우팅 지표
- `comparison_report.md`: 세 전략의 입력 크기와 감소율 요약

벤치마크는 입력 데이터 크기만 측정한다. 실제 버그 재현율은 추후 정답 라벨과 동일 AI 모델의
A/B 평가를 연결해 측정해야 한다. 원본 HTML 산출물에는 민감한 페이지 내용이 포함될 수 있으므로
로컬에만 보관한다.

## 팀 프로토타입 공통 평가

각 팀원의 결과를 `crawl_report.json` 구조로 맞추고 같은 정답 파일로 평가한다. 정답 예시는
`examples/ground_truth.example.json`에 있다. `kind`는 탐지 종류, `url_contains`는 해당 버그가
존재하는 URL 일부다.

```powershell
webtestpilot-evaluate examples/ground_truth.example.json `
  team-a/crawl_report.json `
  team-b/crawl_report.json `
  team-c/crawl_report.json `
  --output evaluation-results
```

- `evaluation.json`: 매칭 상세, 누락 정답, 오탐 후보, 실행·AI 입력 비용
- `evaluation.md`: Precision·Recall·F1 순위표

순위는 F1, Recall, Precision 순으로만 정한다. 토큰 비용과 실행 시간은 품질과 섞지 않고 별도로
비교해야, 싸지만 버그를 놓치는 크롤러가 과대평가되지 않는다.

## URL 파라미터 정책

추적 파라미터는 기본 제거하고 나머지는 보존한다.

```powershell
python -m webtestpilot_crawler https://example.test `
  --drop-query-param view `
  --keep-query-param product_id
```

모든 미등록 query를 버리고 지정한 값만 유지하려면 `--drop-unknown-query`를 추가한다.

## 테스트

```powershell
python -m pytest
```

브라우저 통합 테스트는 Chromium이 설치되어 있지 않으면 자동으로 건너뛴다.

## 기본 안전 정책

- 시작 URL과 동일 출처만 탐색
- 삭제, 결제, 구매, 로그아웃, 제출 등 위험 문구의 행동 차단
- form submit 버튼 차단
- `Load More`, `Show More`, `더 보기` 같은 읽기 중심 버튼은 허용하되 POST/PUT/PATCH/DELETE는 차단
- 페이지·깊이·시간·행동·URL 패밀리별 변형 수 제한

반드시 소유했거나 명시적으로 테스트 허가를 받은 사이트에서만 사용한다.
