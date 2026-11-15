# 리뷰·실측 목록

정리 기준: 2026-11-14. 현재 제품은 `qa/`(v2)다. 실행법은 [qa 사용 안내](../../qa/README.md), 최근 변경과 실측은 [HANDOFF](../HANDOFF.md)가 기준이다.
여기 문서는 작성 당시의 코드·한도·상태를 기록한 자료이며 최신 동작을 자동 반영하지 않는다.
v1(`integration/`) 프로토타입 시기(2026-10-11~14)의 리뷰·실측 문서와 결과 폴더는 2026-11-14 정리에서 지웠다. 아래 세 원칙 문서만 AGENTS.md가 기준으로 삼아 남겼다.

## 원칙 문서 (AGENTS.md 기준)

- [전체 구조 리뷰](QA_ARCHITECTURE_REVIEW_2026-10-13.md): 구현과 공식 Playwright 코드의 차이.
- [일반화 평가 계획](QA_GENERALIZATION_EVALUATION_PLAN_2026-10-13.md): 개발·변형·미사용 앱 평가의 분리.
- [범용 QA 수정 방향](QA_GENERAL_REMEDIATION_PLAN_2026-10-13.md): 문제 정의·수정 순서·완료 조건.

## v2 설계·실측

- [v2 구조 토론](v2-architecture-discussion-2026-10-15/): Claude·Codex 입장과 [합의](v2-architecture-discussion-2026-10-15/05_consensus.md).
- [에이전트 비교](AGENT_COMPARISON_2026-10-15.md).
- v2 Maison 실측: [첫 실측](V2_LIVE_MAISON_2026-10-15.md), [M1](V2_LIVE_MAISON_M1_2026-10-15.md), [M2](V2_LIVE_MAISON_M2_2026-10-15.md), [M3 요구사항 없음](V2_LIVE_MAISON_M3_NOREQ_2026-10-16.md), [M3B](V2_LIVE_MAISON_M3B_2026-10-16.md), [M3C](V2_LIVE_MAISON_M3C_2026-10-16.md).
- 예비 비교: [계획](PRELIM_COMPARISON_PLAN_2026-10-17.md), [결과](PRELIM_COMPARISON_2026-10-17.md), [Maison](PRELIM_COMPARISON_MAISON_2026-10-17.md).

## 참고

- [member-06 코드 리뷰](WebTestPilot_member-06_코드리뷰.md): 기존 AI/MCP 프로토타입 이해.
