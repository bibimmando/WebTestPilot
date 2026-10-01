# WebTestPilot Agent Guide

## 목표

WebTestPilot은 URL만 입력받아 사이트별 사전 테스트 스크립트 없이 웹 애플리케이션을 탐색하고
버그 후보와 재현 증거를 만드는 Black-box AI 테스터다. 단순 크롤러가 아니라 기능과 상태를
발견하고 다음 탐색·테스트를 동적으로 결정하는 시스템을 목표로 한다.

핵심 가치는 다음 세 가지다.

1. URL이 아닌 의미 있는 페이지 상태와 기능을 폭넓게 탐색한다.
2. HTTP 오류처럼 명확한 문제는 코드로 판단하고, 문맥이 필요한 문제만 AI에 넘긴다.
3. AI 입력을 증거 보존 범위에서 최대한 압축해 API 토큰과 비용을 줄인다.

## 핵심 설계 원칙

- 기본 흐름은 `탐색 → 상태 관찰 → 결정적 검사 → AI 라우팅 → 재현 → 보고`다.
- 상태는 URL뿐 아니라 DOM 특징, 인증 상태, 중요 데이터와 상호작용 결과를 포함한다.
- Oracle은 Deterministic, State, AI 판단을 결합한다.
- 명확한 증거가 있는 문제를 AI에 다시 판단시키지 않는다.
- AI에는 전체 HTML이 아니라 판단에 필요한 최소 문맥과 증거를 전달한다.
- 발견 건수보다 고유 원인, 재현 가능성, Precision/Recall을 중요하게 본다.
- 사이트 공통 검색창·메뉴·동일 오류가 AI 후보와 버그 수를 부풀리지 않게 한다.

## 초기 범위

우선순위는 Functional, Responsive, Passive/Low-risk Security 순이다.

- Functional: HTTP·리소스·네트워크 오류, 상호작용, navigation, form, 상태 일관성
- Responsive: overflow, 화면 밖 요소, 겹침, 중요 요소 누락·클릭 불가
- Security: header·cookie 설정, mixed content, 오류 정보, CORS, 인증 상태 등 저위험 검사

UX와 Accessibility는 초기 핵심 범위가 아니며 명시적 요청 없이 확장하지 않는다. SQLi/XSS 같은
공격형 검사는 대표 기능으로 삼지 않고, 허가된 격리 환경과 명확한 요청이 있을 때만 다룬다.

## 안전 원칙

- 소유했거나 명시적으로 허가된 사이트만 테스트한다.
- 기본은 동일 출처와 safe interaction이며 상태 변경 요청을 차단한다.
- 페이지·깊이·상태·동작·시간·URL 패턴에 항상 상한을 둔다.
- cookie value, token, password 등 비밀값을 결과에 저장하지 않는다.
- 정상 실행에서는 전체 HTML을 AI 입력으로 저장하지 않는다. 벤치마크 원본은 로컬 전용이다.
- 안전 제한을 완화하거나 실제 외부 API 비용을 발생시키기 전에 사용자 승인을 받는다.

## 현재 코드 구조

- `crawler.py`: 전체 실행, 페이지 관찰, 링크·동작 확장, AI 후보 생성
- `interactions.py`: 동작 발견·실행과 브라우저 이벤트 수집
- `detectors.py`: 결정적 탐지와 crawler/hybrid/ai 라우팅
- `scope.py`, `priority.py`: 범위 제한, 중복 억제, 탐색·AI 큐 우선순위
- `fingerprint.py`, `url_normalizer.py`: 의미 상태와 URL 정규화
- `reporter.py`: 크롤 보고서와 AI 큐 저장
- `benchmark.py`: API 호출 없는 raw/standard/hybrid 입력·토큰 비교

일반 실행의 전체 결과는 `crawl_report.json`, AI 작업 큐는 `ai_queue.jsonl`이다. 벤치마크 모드의
API 전달 형식은 `hybrid_ai_input.jsonl`이며 `input_id`로 향후 AI 결과와 연결한다.

## 개발·평가 규칙

- 개발 단계에서는 기본적으로 유료 AI API를 호출하지 않고 CLI 벤치마크를 사용한다.
- 비교 시 모든 크롤러에 동일한 URL, 브라우저, 제한값, 안전 정책과 토크나이저를 적용한다.
- 주요 지표는 State/Feature/Action Coverage, 버그 Precision·Recall·F1, AI 라우팅
  Precision·Recall, 입력 토큰, 중복률, 실행 시간과 재현률이다.
- 토큰 감소만으로 성공으로 판단하지 않는다. 필요한 증거 보존과 미탐 여부를 함께 검증한다.
- 공개 샌드박스는 현실성 평가에, 정답이 있는 로컬·블라인드 사이트는 순위 평가에 사용한다.
- 여러 프로토타입은 통째로 합치지 않는다. 안정적인 코어를 고른 뒤 우수 모듈을 하나씩 이식하고
  매 단계 동일 벤치마크로 회귀 여부를 확인한다.

## 작업 규칙

- 기존 CLI와 JSON/JSONL 스키마의 호환성을 보존한다. 변경 시 버전과 테스트를 함께 갱신한다.
- 새 기능에는 정상·실패·안전 제한을 검증하는 테스트를 추가한다.
- 실제 Chromium 통합 테스트와 `python -m pytest`를 변경 위험에 맞게 실행한다.
- 새로 만들거나 수정하는 함수 위에는 역할을 설명하는 짧은 한국어 주석을 유지한다.
- 동일 원인의 페이지별 반복 오류와 공통 UI 후보는 가능한 한 정규화·중복 제거한다.
- 근거 없는 대규모 리팩터링보다 측정 가능한 작은 변경과 전후 벤치마크를 선호한다.
- 작업 전 현재 진행 상황과 우선순위는 `DEVELOPMENT.md`에서 확인하고, 의미 있는 변경 후 갱신한다.
