# 범용 실행 신뢰성 보완의 코드 연결

2026-10-15. 전체 배경·설계·한계·테스트 명령은 [상세 기록](../../docs/ai_inspection/EXECUTION_RELIABILITY_IMPROVEMENTS_2026-10-15.md)을 읽습니다.

이 폴더의 `judgment/prompts.py`는 `supplement.dom_state`의 후보 목록·수량·상태 메시지·누락 정보를 해석하는 판정 지침을 가집니다. DOM 후보 개수를 실제 업무 항목 개수로 간주하거나 알림만으로 통과시키지 않습니다. 실제 이미지는 기존 `judgment/images.py` 경로로 로드합니다. 팀의 judge_input/2와 판정 응답 계약을 유지합니다.

계획·브라우저 실행은 현재 로컬 `external/WebTestPilot-integration/teams/member-01/integration/`에 있습니다.

| 파일 | 따라갈 로직 |
|---|---|
| execution_reliability.py | 관찰 URL로 생성 제한 → 시나리오 검증 → 대상 식별 조건 고정 → 최신 선택과 비교 |
| staged.py | 계획과 대상 sidecar 저장 → executor → 독립 판정 → 후보 추가 재현 |
| executor.py | 최신 관찰을 모델에 전달 → 대상 오류는 dispatch 차단 → 완료 시 실제 화면 첨부 |
| runtime.py | 검증된 최신 요소 전달 → MCP 직전 스냅샷에서도 대상 확인 |
| preprocessor/state_evidence.py | 읽기 전용·제한된 DOM 후보/링크/수량 증거 |
| campaign_state.py | 출처·요구사항·권한이 같은 순차 실행의 공통 폼 기록 |

`execution_bindings.json`은 내보내는 test_plan/2의 구조를 바꾸지 않는 내부 대상 고정 파일입니다. `flow.json.target_audit`에는 선택 확인/거절을 남깁니다. 기능 동작이 실제로 맞는지는 이후 판정 AI가 고정 기대값과 증거를 비교합니다.

판정 원본 변경 후 통합 사본 반영:

```powershell
.\.venv\Scripts\python.exe scripts/sync_judgment_integration.py --apply
```

새 테스트는 src의 기존 `test/` 또는 통합 worktree의 `integration/test/`를 사용합니다. 구현 옆에 테스트 파일을 추가하거나 기존 전처리 파일을 이동하지 않습니다.
