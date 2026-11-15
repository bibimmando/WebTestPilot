# 개발 문서 목록

정리 기준: 2026-11-14. **현재 구현은 `qa/`(v2)**, **최종 목표는 루트 AGENTS.md**를 기준으로 읽는다. 날짜별 리뷰·실측 문서는 그때의 코드와 한도를 기록한 자료이며 최신 동작을 자동 반영하지 않는다.

## 먼저 읽을 문서

| 순서 | 문서 | 목적 |
|---|---|---|
| 시작 | [프로젝트 공통 지침](../AGENTS.md) | 테스트가 검증 수단이라는 전제·범용 QA 목표·일반화 평가 |
| 0 | [qa 사용 안내](../qa/README.md) | 설치·실행·출력·검증 |
| 1 | [v2 설계](design/V2_ARCHITECTURE.md) | 단계·계약·판정 구조 |
| 2 | [작업 인수인계](HANDOFF.md) | 최근 변경·실측 결과·남은 일(최신 항목이 맨 위) |
| 3 | [비용 줄이기 선택지](design/COST_REDUCTION_OPTIONS_2026-10-30.md) · [중간발표 뒤 계획](design/POST_MIDTERM_PLAN_2026-10-28.md) | 비용·후속 계획 |

## 리뷰·실측

먼저 [리뷰 목록](reviews/README.md)을 읽는다.

| 문서 | 읽는 상황 |
|---|---|
| [전체 구조 리뷰](reviews/QA_ARCHITECTURE_REVIEW_2026-10-13.md) · [일반화 평가 계획](reviews/QA_GENERALIZATION_EVALUATION_PLAN_2026-10-13.md) · [범용 QA 수정 방향](reviews/QA_GENERAL_REMEDIATION_PLAN_2026-10-13.md) | AGENTS.md가 기준으로 삼는 원칙 문서(v1 시기에 썼지만 원칙은 그대로 적용) |
| [v2 구조 토론](reviews/v2-architecture-discussion-2026-10-15/05_consensus.md) | v2 설계 합의 과정 |
| [v2 Maison 실측](reviews/V2_LIVE_MAISON_2026-10-15.md) 외 M1~M3 | v2 초기 실측 |
| [예비 비교](reviews/PRELIM_COMPARISON_2026-10-17.md) · [Maison](reviews/PRELIM_COMPARISON_MAISON_2026-10-17.md) | 공식 에이전트·이전 버전과의 비교 |
| [member-06 코드 리뷰](reviews/WebTestPilot_member-06_코드리뷰.md) | 기존 AI/MCP 프로토타입 이해(참고) |
| [협업 방식](../CONTRIBUTING.md) · [GitHub 안내](GITHUB_SETUP.md) | development와 main 반영 흐름 |

## 멘토링·발표

- [멘토링 사전 자료](mentoring/MENTORING_PREP_member-01_qa-v2.md) · [전처리 구현 명세](mentoring/전처리_구현_명세.md).
- 중간발표(2026-10-28): `presentation/`의 대본·발표자 노트·예상 질문.

## 프로젝트 정렬·연구·공유 자료

- [프로젝트 방향성](project-alignment/WebTestPilot_프로젝트_방향성_공유본.md) · [Q1~Q66 결정 기록](project-alignment/WebTestPilot_Q1-Q66_최종_입장.md): 목적과 결정 배경. 세부개발계획·JSON 연결규격·전처리팀 분담은 v1 시기 초안이다.
- [한국어 논문·적용 가이드](research/PAPERS_GUIDE_KO.md) · [관련 논문 목록](research/RELATED_PAPERS.md). 논문별 설명·원문: `research/papers/`.
- [공유 PDF](exports/README.md): 2026-10-08 고정본. 최신 개발 상태를 자동 반영하지 않는다.
