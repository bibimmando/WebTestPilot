# 개발 문서 목록

현재 구현은 `teams/member-01/integration/` 코드와 통합 README를 기준으로 읽습니다. 계획 문서는 최종 목표이며 모든 기능의 완료를 뜻하지 않습니다.

| 순서 | 문서 | 목적 |
|---|---|---|
| 1 | [통합 개발 기준](../teams/member-01/integration/DEVELOPMENT.md) | 현재 소스·완료 범위·담당 모듈 |
| 2 | [설치·실행·출력](../teams/member-01/integration/README.md) | 사용법·모델·스킬·검증 |
| 3 | **[판단 AI용 JSON 규격](../teams/member-01/integration/docs/JUDGMENT_CONTRACT.md)** | `judge_input/2`·응답·증거 ID·이미지 |
| 4 | [전처리 증거 규격](../teams/member-01/integration/docs/AI_INPUT_CONTRACT.md) | snapshot·ai_input·조작·폼 증거 |
| 5 | [실행 AI·MCP 계약](../teams/member-01/integration/docs/EXECUTION_AGENT.md) | 도구·계획 진척·한도·실패 |
| 6 | [공용 개발·통합 가이드](INTEGRATION_GUIDE.md) | 파트 연결, 이전 설계와 현재 구현 구분 |
| 7 | [실제 Maison 검사 결과](reviews/QA_SKILL_MAISON_TEST_2026-10-12.md) | 5→12페이지·후보·누락·시간/토큰·수정 우선순위 |

## 계획·이력

- [세부개발계획 v0.6](project-alignment/WebTestPilot_세부개발계획_초안.md).
- [JSON 연결규격 v0.2](project-alignment/WebTestPilot_JSON_연결규격_초안.md). 실제 계약은 위 JSON 규격을 따릅니다.
- [전체 방향성](project-alignment/WebTestPilot_프로젝트_방향성_공유본.md).
- [Q1~Q66 결정 기록](project-alignment/WebTestPilot_Q1-Q66_최종_입장.md).
- [전처리팀 분담 초안](project-alignment/WebTestPilot_전처리팀_구현현황_역할분담.md).
- [member-02 계획 통합 기록](reviews/MEMBER02_STAGED_INTEGRATION_2026-10-11.md).
- [member-06 코드 리뷰](reviews/WebTestPilot_member-06_코드리뷰.md).
- [성능 수정·검증 기록](reviews/PERFORMANCE_IMPROVEMENTS_2026-10-12.md).
- [QA 스킬 연결 기록](reviews/QA_SKILL_HANDOFF_2026-10-12.md).
- [GitHub 협업 안내](GITHUB_SETUP.md).

실제 판정 AI의 연결은 입력·응답 예시와 Schema를 함께 사용합니다. 원본 실행 결과와 API 키는 Git에 포함하지 않습니다.
