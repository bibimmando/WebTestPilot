# 통합 코드 개발 기준

기준일: 2026-10-12. 제품 소스는 `integration/`이며 [설치·실행·출력 안내](README.md)를 함께 읽는다.

## 1. 현재 실행 구조

```text
전처리 → 시나리오 제안·실행 계획 AI (1회) → 검증·계획 저장
→ 실행 AI ↔ MCP 실행·증거 저장 → 결과 후처리 → 별도 판단 AI
→ 후보 재현·재판정 → 보고서 → 다음 URL
```

통합 계획과 판정은 별도 시스템 지시와 새 대화로 호출한다. 계획 검증 실패의 수정 요청은 최대 1회다. 실행 AI는 시나리오별 tool_use/tool_result 대화를 이어가며 MCP 동작과 관찰을 선택한다. 프로그램은 실제 실행·수집·계획 단계 진척을 기록하고 앱 정상/버그 판정은 별도 판단 AI가 작성한다. 현재 파이프라인은 staged/3이다.

## 2. 수정할 파일

| 담당 | 코드 |
|---|---|
| 전처리·크롤링 | `preprocessor/`, `docs/AI_INPUT_CONTRACT.md` |
| 시나리오 제안·계획 | `planning.py`, `plan_contract.py`, `staged.py`의 planning/planning_repair 단계 |
| 실행 AI·MCP·후처리 | `executor.py`, `runtime.py`, `mcp.py`, `mcp_client.py`, `staged.py`의 execution/postprocess 단계 |
| 판정·보고서 | `staged.py`의 judgment 단계, `runtime.py`의 증거 검증·집계 |
| 초기화·재현 | `reset.py`, `reproduction.py` |
| 검증 | `test_staged.py`, `test_performance.py`, `test_executor.py`, `test_integration.py`, `test_regressions.py`, `tests/preprocessor/` |
| CLI·공통 모델 전송 | `__main__.py`, `models.py` |

팀 폴더는 담당 안내와 이전 프로토타입 참고용이다. 현재 제품은 팀 소스를 import하지 않는다. 실행 의존성은 가상환경 또는 `.tools/`에 설치한다.

## 3. 현재 완료 범위

- 기존 전처리의 FIFO·중복 URL 관리·탐색 중 그래프·snapshot·ai_input·전후 증거 유지.
- 모든 폼의 native 검증 상태·자연 발생 입력/변경/검증/제출/초기화 이벤트를 공통 관찰.
- 전역 요약 예산과 독립된 `action_context/1`로 조작 대상·관련 폼 증거를 실행·판단 AI에 연결.
- 최신 member-02의 제안 요청·응답 함수를 보존·재사용하고 `qa_test_plan` 한 응답에서 제안과 실행 계획을 생성.
- 제안별 실행 가능한 시나리오 또는 미계획 이유를 명시하고, 모든 제안의 대응을 검증.
- 관측 key/링크·지원 행동·입력 유형·실행 한도를 검증하고 실행 전에 `test_plan.json` 저장.
- 같은 탭에서 실행 AI가 최신 대상 key를 선택하고, 실제 action/snapshot/MCP 기록을 시나리오 ID와 계획 단계에 연결.
- target_description으로 후속 화면 대상을 기술하고 제한된 보조 클릭·Escape/Tab·재관찰을 지원.
- 실행 모델의 도구 호출과 실제 결과를 같은 ID로 연결하며 판정 호출 1회분을 예약.
- 공식 Claude의 계획·실행·판정 모델을 독립 설정. 기본 실행·판정은 Sonnet 5.5.
- 공식 Claude의 등록 스킬을 계획 단계에 연결. server tool 읽기 기록과 pause_turn의 컨테이너·대화·호출 한도를 유지.
- `scenario_results.json`과 `judge_input.json`을 생성한 뒤 별도 AI 판정 호출.
- 계획의 기대 결과·근거를 고정하고 판정의 시나리오별 증거 참조를 검증.
- 판정 입력 `judge_input/2`는 snapshot별 관찰 맵으로 중복을 제거하며 로컬 상세 실행 결과는 유지.
- 미실행 `not_run`은 `program_policy` 출처의 `inconclusive`만 기록하고 모델에 의미 판정을 요청하지 않음.
- 통합 행동의 경량 캡처와 단계·모델·행동 시간 계측. 독립 전처리의 기본 캡처는 전체 저장.
- 승인된 로드 전 초기화와 추가 재현 1회, 별도 재현 판정·JSON 보고서 유지.

## 4. 후속 범위

2026-10-12에 현재 코드로 Maison 5페이지·12페이지 검사를 진행했다. 12페이지에서 계획 112개 중 85개 실행 완료, 후보 3건(F3·U5 두 유형), 재현 확정 0건이었다. 행동 실패 뒤 snapshot 복구·후속 검사 중단·판단 증거 참조·재현 처리가 후속 수정 대상이다. [실제 검사 기록과 우선순위](../../../docs/reviews/QA_SKILL_MAISON_TEST_2026-10-12.md)를 함께 읽는다.

- 실행 AI의 실제 모델 성공률·오탐·누락·비용 비교, 계획의 연산/입력값 자체를 변경하는 재계획 계약.
- 로그인 시작 조건·사이트별 초기화·select/hover/back 등 추가 행동.
- 실제 Maison 결함의 탐지·오탐 평가 확장, 전체 벤치마크 채점.
- 보고서 화면·PDF.

시나리오들은 한 탭의 상태를 순서대로 공유한다. 독립 시작 조건을 가진 시나리오별 초기화는 별도 계약이 필요하다. 실행 성공·수집 완료·개별 passed·페이지 passed를 구분한다.

## 5. 연결 계약

- 전처리 import는 `integration.preprocessor`이고 기존 snapshot `0.2`, 입력 `ai_input/1`을 유지한다.
- 콜백은 `(page, initial_snapshot, evidence)`이며 이미 열린 같은 async Page를 사용한다.
- 제안은 자연어 목록이다. 직접 selector로 바꾸지 않고 검증 가능한 계획 JSON으로 구체화한다.
- test_plan/2에는 scenario_id, proposal_index, family, expected, expected_source, steps가 있다. 대상은 최초 관측 element_key 또는 target_description이다. unsupported 제안은 unplanned와 이유를 남긴다.
- 행동은 관측된 element_key/URL만 사용하고 실행 직전 최신 locator를 재검증한다.
- 전후 관찰은 `SnapshotAPI.action()`으로 감싼다. 통합 실행만 `light=True`로 반복 원본 파일을 생략한다. diff는 관찰 차이이며 버그 판정이 아니다.
- 검사 행동의 tool_use_id는 실제 실행 AI 응답 ID이고 재현 행동은 null이다. plan_tool_use_id는 계획 응답 ID다. scenario_results의 plan_step_index/purpose와 실제 step_index/action_id/snapshot_id로 연결한다.
- 후처리에는 실행 상태·근거·누락을 넣고 앱 verdict를 만들지 않는다. 미실행의 상태 기록은 `judgment_source=program_policy`로 구별한다.
- 판단 AI에 행동 도구를 제공하지 않는다. 기대 결과는 계획에서 유지하며 다른 시나리오의 증거를 사용하지 못한다.
- AI팀의 판정 코드 입력·응답·이미지 전달은 [판정 AI 연결 규격](docs/JUDGMENT_CONTRACT.md)과 `schemas/`, `examples/`를 기준으로 맞춘다.
- 실행 AI의 도구·진척·한도·모델 연결은 [실행 에이전트 규격](docs/EXECUTION_AGENT.md)을 기준으로 맞춘다.
- candidate를 바로 confirmed로 집계하지 않는다. 초기화/재현 실패·미실행은 미완료 이유를 남긴다.
- 키는 루트 `.env` 또는 환경변수에서 읽고 소스·산출물·커밋에 넣지 않는다. 결과는 루트 `output/`에 저장한다.

## 6. 작업 후 검증

아래 검증은 유료 모델 API를 호출하지 않는다.

```powershell
python -m integration.test_staged
python -m integration.test_performance
python -m integration.test_skills
python -m integration.test_executor
python -m integration.test_integration
python -m integration.test_regressions
python -m pytest integration/tests/preprocessor -q
```

실행·수집·판정 경계 변경은 관련 검증을 갱신한다. 필드·단계를 바꿨다면 이 문서와 통합 README·입력 규격도 함께 갱신한다. 상위 목표와 팀 합의는 [개발 문서 목록](../../../docs/README.md)을 참고한다.
