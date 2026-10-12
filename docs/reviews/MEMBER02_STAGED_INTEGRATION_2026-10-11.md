# member-02 최신 계획 코드 검토와 단계 분리 통합

기준일: 2026-10-11. 원격 development를 fetch해 확인한 SHA: `c5290bb6ca3efeb51296e37a0efdffdbc4176dd7`.

## 확인 결과

| 부분 | 최신 member-02 상태 | 통합 처리 |
|---|---|---|
| 시나리오 제안 | semantic_test_planning → page_summary/proposed_checks/open_questions. proposed_checks는 문자열 목록 | 요청/검증 함수 원본을 integration/planning.py에 보존 |
| 구체적인 행동 계획 | ClaudePlanner와 PLAN_SCHEMA에 decision/check_id/steps, action/control_id/value 존재 | 기존 기능은 미리 등록한 검사·컨트롤 ID 필요. 관측된 전처리 key/URL로 실행 계획을 생성하는 연결 추가 |
| 제안 → 실제 실행 계획 | 자연어 제안을 일반 페이지의 요소·입력·기대 동작에 자동 연결하지 않음 | 제안 번호별 scenarios 또는 unplanned 이유를 기록하고 누락·대상·한도 검증 |
| 실행 뒤 판정 | 기존 judge_observation은 등록된 text_contains/url_equals의 프로그램 판정 | 실행·후처리의 앱 verdict를 분리하고 별도 판단 AI 호출 |

문장 제안만으로 클릭 대상·입력값·행동 순서가 확정되지는 않는다. 최신 코드에 구조화된 행동 선택은 있지만 전처리만 받아 완전한 실행 계획으로 구체화하는 단계는 아직 해결되지 않았다고 판단했다. 이 결론은 위 원격 SHA에 대한 것이며 미커밋/미업로드 변경을 포함하지 않는다.

## 현재 제품 흐름

전처리 → 시나리오 제안 AI → 실행 계획 AI → 계획 검증·저장 → MCP 실행·증거 저장 → 결과 후처리 → 별도 판단 AI → 후보 추가 재현·재판정 → 보고서.

각 역할은 새 대화로 호출한다. 실행 단계는 모델을 호출하지 않는다. 기대 동작과 근거는 실행 전에 고정하고, 판정 AI는 해당 시나리오의 실제 증거만 인용한다. 실행 불명확/관찰 실패/정책 차단은 앱 버그로 확정하지 않는다.

현재 시나리오는 한 탭에서 상태를 순서대로 공유한다. 최초 관찰에 없는 새 요소가 필요한 제안은 unplanned로 남긴다. 동적 대상 재발견·시나리오별 시작 조건 격리는 후속 범위다.

## 출처와 검증

member-02의 build_evidence_request/validate_evidence_response 두 함수는 AST를 대조해 원본 유지 여부를 확인했다. 타임리 반환 모델 anthropic/claude-opus-5.5로 plan_contract.py, staged.py, test_staged.py를 작성받고 Codex가 연결·경계 수정·검증을 수행했다. 완성되지 않은 초기 응답은 적용하지 않았다.

순수 계획/판정 경계 검증과 실제 로컬 MCP의 단계 순서·두 페이지 처리·재현·실행 불명확·관찰 실패·정책 차단·취소 검증, 로컬 Maison 초기화·브라우저 저장소 복원·링크·HTTP 취소가 통과했다. 실제 Maison 버그 탐지 성능 또는 새 흐름의 유료 모델 검사는 이 검증에 포함하지 않았다.

후속 개발자는 [통합 개발 기준](../../integration/DEVELOPMENT.md)과 [통합 실행/산출물 안내](../../integration/README.md)를 먼저 읽는다.
