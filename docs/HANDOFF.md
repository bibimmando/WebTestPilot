# 에이전트 인수인계 노트

Claude Code와 Codex CLI가 작업을 넘길 때 최신 항목을 맨 위에 추가한다.

<!--
## YYYY-MM-DD · 작성 에이전트 (Claude / Codex) · 브랜치
- 한 일:
- 다음 할 일:
- 미검증 / 주의:
-->

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
