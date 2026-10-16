# 공통 실행 신뢰성 보완 — 2026-10-15

이 변경은 특정 사이트의 URL·상품·주입 버그 조건을 구현하지 않는다.

## 연결 지점

- `plan_contract.observed_urls`: 축약 links, controls의 href, 스냅샷에서 검증한 target_controls의 href를 합쳐 동일 출처만 허용한다.
- `execution_reliability.planning_tool`: 관찰 URL enum과 나중에 나타날 대상의 role/name 또는 href 식별 조건을 도구에 제공한다.
- `execution_reliability.isolate_plan`: 전체 대응 관계를 확인한 뒤 시나리오를 원자적으로 검증한다. 유효한 선행 시나리오와 최초 UI를 보존하고, 거절 뒤 독립성을 알 수 없는 행동은 보류한다.
- `bind_targets/check_target`: 초기 관찰의 대상 의미를 sidecar에 고정한다. 실행 AI 선택과 행동 직전 관찰을 모두 확인한다.
- `runtime.observation`: 검증된 실제 요소 최대 200개를 target_controls로 보충한다. DOM 변경으로 키가 달라져도 현재 주소·역할·이름을 볼 수 있다.
- 이름 없는 기존 요소는 전처리의 문서별 WeakMap observed_ref로 같은 실제 노드인지 확인한다. CSS 위치만으로 대체하지 않는다. 새 문서·새 노드는 보류한다.
- `preprocessor/state_evidence.py`: 일반 DOM 후보·링크·숫자 입력·상태 텍스트를 읽기 전용 수집한다. 제한·scope·누락을 함께 저장한다. 후보 개수를 업무 항목 수로 간주하지 않는다.
- `executor`: 완료한 기능 시나리오에도 실제 마지막 화면을 첨부한다. 기능 이미지 누락은 자동 앱 오류가 아니다. UI는 여전히 이미지가 필수다.
- `reproduction`: 실제 이미지가 인용된 기능 후보는 원본/재현 이미지도 전달하고 URL·뷰포트·스크롤 조건을 확인한다.
- `campaign_state`: 같은 출처·요구사항·쓰기 권한의 순차 실행끼리 완료·수용 판정이 있는 공통 폼 기록을 공유한다. inconclusive나 실행 실패는 등록하지 않는다.

## 계약과 산출물

test_plan/2와 judge_input/2의 기존 외부 스키마를 유지한다. 계획 도구의 target_identity는 내부 확장으로, 출력 계획에서는 제거하고 `execution_bindings.json`에 저장한다. `flow.json.target_audit`는 선택 일치/거절과 당시 snapshot ID를 기록한다. 보충 관찰은 `supplement.target_controls`, `supplement.dom_state`에 있다.

같은 href를 가진 여러 링크는 같은 목적지로 가는 동등 후보로 허용한다. 이름이 같은 버튼이 여러 개인 경우에는 임의 선택을 거절한다. 올바른 대상의 앱 결과가 틀리는 경우는 차단하지 않고 판정으로 넘긴다.

`--campaign-state <path>`는 선택 옵션이다. 요구사항이나 권한·출처가 다르면 파일을 분리해야 한다. 다른 사용자 상태·인증 역할·배포 버전에도 별도 파일을 사용한다. 동시 실행은 lock으로 거절하고 비정상 종료된 lock은 활성 프로세스가 없는지 확인한 후 정리한다. 보류된 새 기대값을 통과로 바꾸지 않는다.

## 검증

member-01 폴더를 작업 디렉토리로 사용한다. 프로젝트의 가상환경 Python을 선택하고 필요하면 프로젝트 루트에서 PYTHONPATH를 member-01로 설정한다.

```powershell
python -m unittest discover -s integration/test -t . -v
python -m integration.test_staged
python -m integration.test_executor
python -m integration.test_regressions
python -m integration.test.generate_quality_demo --output output/reliability-local-new
```

테스트 파일은 `integration/test/`에 있다. 로컬 demo는 실제 MCP와 고정 모델 응답을 사용하며 AI 정확도 측정이 아니다. 원격 사이트 검사도 기존 CLI와 MCP만 사용한다. 원격 검사 결과는 실행 폴더의 문서를 기준으로 확인한다.
