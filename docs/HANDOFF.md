# 에이전트 인수인계 노트

Claude Code와 Codex CLI가 작업을 넘길 때 최신 항목을 맨 위에 추가한다.

<!--
## YYYY-MM-DD · 작성 에이전트 (Claude / Codex) · 브랜치
- 한 일:
- 다음 할 일:
- 미검증 / 주의:
-->

## 2026-10-15 (5) · Claude · M1 (첫 연결 완성 + 실측 버그 수정)

- 한 일: 대상 고정·텍스트 읽기를 `ariaSnapshotJSON`(ai 모드)으로 교체(YAML 파서 삭제), 이름 있는 요소는 이름·없는 요소는 자손 텍스트로 읽기, 행동 뒤 검사의 observed 근거 금지, heuristic 규칙 문장 필수, observed 근거 통과는 `passed_observed`로 분리, mismatch도 AI 분류(비교 기록 구조화, 원래 불일치 보존, 분류 실패 시 mismatch 유지·재현), 분류 대화 판정 회차별 저장, `report.ts`(report/0 최소 계약 초안). Codex 리뷰 2회(P1 4건·P2 6건) 반영. 무료 테스트 56개 통과, eval bug-1 결과 유지.
- Q47 확인(Codex CLI 구독으로 새 탐색): 정상 목록·모달 후보 0, 결함 목록·모달에서 심은 버그 2종 탐지·재현. 결함 모달 탐색에서도 기대값을 요구사항(10%)으로 계산함.
- 다음 할 일: M1 남은 조건 — Maison 유료 재실측(오탐 4건 소멸 확인), 독립 평가 앱 후보 조사. 그 뒤 M2.
- 미검증 / 주의: heuristic 규칙 문장의 의미상 우회(관찰을 규칙처럼 적기)는 M2. iframe 안 요소 고정 미지원(M2 이후). report.ts는 타입만 있고 생성 코드는 M6.

## 2026-10-15 (4) · Claude · 끝까지 연결 확인 (유료 API 없음)

- 한 일: Codex CLI 구독으로 만든 실제 계획 3개(목록·모달·폼, 시나리오 13개)를 2·3단계로 실행. 정상 앱에서 검사 31개 모두 통과, 정책 위반·기록 문제 0.
- 같은 URL의 버그 변형(목록: 21번째 이후 상품 +2, 모달: 쿠폰 7.5%, 모달: 닫기→취소 이름 변경)에서 같은 계획을 다시 실행. 앞의 두 버그는 불일치로 탐지되고 재실행에서 모두 reproduced(검사 6개, 실제 값이 심은 버그와 일치). 이름 변경은 요구사항에 없는 버튼이라 계획에 없어 탐지되지 않음.
- 미검증: 이번 실행에서 needs_triage 항목이 나오지 않아 AI 분류 경로는 실제 흐름에서 지나가지 않았다. 버그 변형은 개발용 fixture이고 계획도 같은 앱에서 만들었으므로 일반화 성능 근거가 아니다. 실행 스크립트와 버그 변형은 세션 임시 폴더에만 있다.

## 2026-10-15 (3) · Claude · chore/claude-codex-setup

- 한 일: 3단계 구현 — 실패 시점 증거(aria snapshot·스크린샷)와 시작 화면 지문, `triage.ts`(1차 분류 → 애매한 실패만 AI 분류 → 결함 후보 재실행), `prompts/triage.md`. Codex 테스트 52/52·리뷰 11건 중 9건 반영 후 53/53 통과.
- 결정: AI 분류는 실패 시점 증거를 하나 이상 그대로 인용해야 통과. 재실행은 최초 실행 폴더의 plan·정책으로 하고, 실행 코드 해시가 다르거나 시작 화면 지문이 다르면 inconclusive. 판정 파일은 단계마다 저장하고 덮어쓰지 않음.
- 다음 할 일: 4a — `integration/`과 고정 계획 비교, 4b — 새 탐색 비교 (유료 API, 예산 필요). 그 전에 1단계 실제 모델 plan을 2·3단계까지 끝까지 이어 보는 무료 확인(Codex CLI 구독)을 권장.
- 미검증 / 주의: 준비 조건(`ready`)이 계획 계약에 없어 로딩 중 값이 `mismatch`가 된다(Codex #1). 시작 지문은 화면만 봐서 서버 상태 차이를 놓친다(#5). AI 인용은 "증거에 그대로 있음"만 검증하고 결론과의 관련성은 검증하지 않는다. 스크린샷은 AI에 보내지 않는다. 실제 Claude API로 분류해 본 적 없음.

## 2026-10-15 (2) · Claude · chore/claude-codex-setup

- 한 일: 2단계 구현 — `generate.ts`(plan→spec 템플릿), `fixture.ts`(start·act·check, ledger), `run.ts`(입력·실행 코드 사본 고정, 비동기 `playwright test`), `reconcile.ts`(상태 재계산, 무효 시나리오, 요구사항 집계). Codex가 workspace-write + TEMP를 `qa/runs/codex-tmp`로 바꿔 브라우저 테스트까지 실행(45/45 통과)하고 11건 리뷰. 반영 후 49/49 통과.
- 다음 할 일: 3단계 — 결정적 1차 분류(not_ready·target_changed 등), 애매한 실패만 AI 분류, 후보 재실행과 시작 상태 검증. 1단계에서 실제 모델이 만든 plan을 2단계로 실행해 보기.
- 미검증 / 주의: 리다이렉트로 외부 origin 도달은 막지 못하고 시나리오를 무효로만 만든다. 실행 코드는 일반 Node 프로세스라 `.env`·`eval/` 접근을 막지 않는다(템플릿 spec만 실행하는 동안은 위험이 작지만 `custom` 단계 전에 격리 필요). 검사 재시도는 "기한 안 최종 상태" 의미이고 첫 읽기 값만 남긴다. 숫자 칸에 문자열 같은 미전달 실패도 uncertain으로 센다. 시작 상태 초기화 fixture는 아직 없다(start는 이동만).

## 2026-10-15 · Claude · chore/claude-codex-setup

- 한 일: v2(`qa/`) 설계(docs/design/V2_ARCHITECTURE.md)와 0·1단계 구현. 브라우저 도구, 계획 검증, 비용 예약 에이전트 루프, 탐색 도구, 개발용 MCP 서버(`qa/src/mcp.ts`). Codex 리뷰 2회 반영. 무료 테스트 41개 통과. Codex CLI 구독으로 목록·모달 fixture를 실제 탐색해 계획 제출까지 확인.
- 결정: AI는 탐색·계획, `custom` 단계 코드, 실패 분류만. 실행은 plan에서 템플릿으로 만든 spec이 결정적으로 한다(안 A). 개발은 CLI 구독, 테스트·평가는 Claude API. 모델은 계획 Opus 5.5 / 나머지 Sonnet 5.5, 비용이 크면 각각 한 단계 내림.
- 다음 할 일: 2단계 — plan → spec 템플릿 생성, `act()`·`check()` 헬퍼와 ledger, `playwright test` 실행, ledger↔plan 대조.
- 미검증 / 주의: `claude` CLI 미로그인이라 Claude Code 경로는 미실행. Claude API 실호출 없음. observed 출처를 하네스 관측 기록과 대조하지 않음(Codex 리뷰 3번). 탐색 중 클릭 timeout을 "실행 불명확"으로 구분하지 않음(탐색 단계라 보류, 2단계 실행에서는 필수). 리다이렉트로 외부 origin 접속은 사후 기록만 가능.
