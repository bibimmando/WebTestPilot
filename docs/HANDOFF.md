# 에이전트 인수인계 노트

Claude Code와 Codex CLI가 작업을 넘길 때 최신 항목을 맨 위에 추가한다.

<!--
## YYYY-MM-DD · 작성 에이전트 (Claude / Codex) · 브랜치
- 한 일:
- 다음 할 일:
- 미검증 / 주의:
-->

## 2026-10-15 · Claude · chore/claude-codex-setup

- 한 일: v2(`qa/`) 설계(docs/design/V2_ARCHITECTURE.md)와 0·1단계 구현. 브라우저 도구, 계획 검증, 비용 예약 에이전트 루프, 탐색 도구, 개발용 MCP 서버(`qa/src/mcp.ts`). Codex 리뷰 2회 반영. 무료 테스트 41개 통과. Codex CLI 구독으로 목록·모달 fixture를 실제 탐색해 계획 제출까지 확인.
- 결정: AI는 탐색·계획, `custom` 단계 코드, 실패 분류만. 실행은 plan에서 템플릿으로 만든 spec이 결정적으로 한다(안 A). 개발은 CLI 구독, 테스트·평가는 Claude API. 모델은 계획 Opus 5.5 / 나머지 Sonnet 5.5, 비용이 크면 각각 한 단계 내림.
- 다음 할 일: 2단계 — plan → spec 템플릿 생성, `act()`·`check()` 헬퍼와 ledger, `playwright test` 실행, ledger↔plan 대조.
- 미검증 / 주의: `claude` CLI 미로그인이라 Claude Code 경로는 미실행. Claude API 실호출 없음. observed 출처를 하네스 관측 기록과 대조하지 않음(Codex 리뷰 3번). 탐색 중 클릭 timeout을 "실행 불명확"으로 구분하지 않음(탐색 단계라 보류, 2단계 실행에서는 필수). 리다이렉트로 외부 origin 접속은 사후 기록만 가능.
