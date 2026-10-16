# AI 검사 품질 보완 — 2026-10-15

> Git share: use [REPRODUCE.md](../../REPRODUCE.md) for current setup and [shared evidence](../../reports/maison_2026-10-16/README.md) for results. Historical local workspace paths below are development records.

## 이 변경을 읽는 순서

전체 구조는 [PROJECT_PIPELINE_GUIDE.md](PROJECT_PIPELINE_GUIDE.md), 판정 입출력은
[AI_JUDGMENT_MODULE.md](AI_JUDGMENT_MODULE.md)를 먼저 참고합니다.
이 문서는 10월 14일 Maison 검사에서 드러난 누락을 어떤 코드로 보완했는지 설명합니다.
이 문서의 로컬 검증 이후 수행한 실제 유료 Sonnet 재검사는
[별도 결과·비교 문서](SONNET_REINSPECTION_COMPARISON_2026-10-15.md)에 기록했습니다.
아래 유료 호출 0회 설명은 구현·localhost 검증 작업의 범위입니다.

## 문제와 목표

기존 결과는 29개 고유 URL, 33개 flow, 84개 시나리오입니다.
문제 후보 7건은 버그 목록의 U5(헤더가 본문을 가림) 한 종류에 대응하며, 추가 재현으로 확정된 건은 없었습니다.
17종 대비 후보 1종인 5.9%는 검사 당시와 정답 목록 활성 상태가 같다는 전제의 사후 비교입니다.
F4에서는 ALL을 누른 뒤 필터와 상품 2개가 그대로인데도, 느슨한 수량 조건 때문에 passed가 기록됐습니다.

목표는 단순히 검사 건수를 늘리는 것이 아니라 다음 단계를 따로 확인하는 것입니다.

```text
어떤 기능을 계획했나
 → 필요한 시작 조건과 실제 행동을 수행했나
 → 기대 조건을 판단할 증거가 확보됐나
 → 조건 전체를 비교했나
 → 문제 후보를 같은 상태에서 추가 재현했나
```

기존 Maison 결과 파일과 판정은 수정하지 않았습니다. 이번 보완에서는 외부 사이트 재검사·유료 AI 호출·서버 초기화를 하지 않았습니다.
버그 ID와 주입 재현 절차는 운영 프롬프트에 넣지 않았습니다. F4 기록은 별도 회귀 테스트 자료로만 사용합니다.

## 1. 계획: 실제 결과까지 확인하는 검사와 공통 검사 중복 관리

통합 코드 `inspection_quality.py`의 `PLANNING_GUIDANCE`가 기존 계획 프롬프트에 추가됩니다.

- 알림·명령 성공·수량 하한만으로 업무 동작을 검증하지 않도록 요구합니다.
- 장바구니는 추가 후 실제 내용, 위시리스트는 추가 후 목록·개수, 필터는 적용 후 해제,
  이동은 클릭한 카드와 도착 화면의 이름을 비교하도록 일반적인 검사 관점을 제공합니다.
- 정확한 개수·값은 요구사항이나 관찰된 기준을 사용하고 추측하지 않도록 합니다.
- 다중 기대 조건은 번호를 붙여 작성하고, 필요한 로그인·장바구니·토큰 등의 준비가 없으면 이유를 남깁니다.
- 비밀번호·파일 입력 금지와 네트워크 정책은 유지합니다. 아직 계정·주문 준비를 자동으로 생성하지 않습니다.

같은 실행의 `covered_common_checks`에 완료된 공통 폼 검사를 기록해 다음 계획 요청에 설명과 함께 전달합니다.
프로그램의 자동 중복 제외는 **같은 origin, 관찰된 폼 구조·라벨, 같은 행동·입력값·기대 문구·근거**인 경우만 적용합니다.
다른 기대 조건이나 재시도가 필요한 미완료 검사는 합치지 않습니다. 문구만 다른 의미상 중복까지 자동 판별하지는 않습니다.
제외 이유는 `deferred_shared_checks`, 제안 대응은 `unplanned`에 남습니다. 제외를 통과로 세지 않습니다.

## 2. 실행: 현재 요소 확인과 UI 검사 순서

`target_refresh.py`는 최신 관찰에 있지만 locator 검증이 끝나지 않은 요소에 한해
관찰된 role/name과 실제 화면의 유일한 요소를 비교해 locator를 재검증합니다.
같은 이름이 여럿이면 선택하지 않습니다. 링크는 관찰된 href와 실제 href까지 같아야 합니다.
행동 전후 관찰·MCP의 최종 요소 검사·한도는 유지하고, unknown 행동을 자동 재실행하지 않습니다.
이는 요소 재발견 실패를 줄이는 보완이며 모든 locator 실패를 복구하지는 않습니다.

`prepare_plan()`은 **초기 화면이라고 명시한, 행동 없는 UI 시나리오**를 앞에 배치합니다.
다른 상태를 기대하는 UI 검사를 임의로 초기 화면 검사로 바꾸지 않습니다.
UI 시나리오의 준비 행동·페이지 이동은 여전히 계획에 명시해야 합니다.

## 3. 판정: 기대 조건 전체 검토와 일부 통과 방지

개발 원본은 `src/ai_inspection/judgment/`입니다.

| 파일 | 변경 |
|---|---|
| prompts.py | 조건 일부만 충족한 통과 금지, 질적인 검사 목적 확인, 행동 전후 ID 모두 인용 |
| assessment.py | 내부 모델 응답에 조건별 met/unmet/unknown, 근거, 기대 지원 여부·목적 충족 여부 요구 |
| judge.py | structured 요청일 때 내부 assessment 확장 도구 스키마 사용 |
| async_adapter.py | 구조화된 검토를 처리하고 기존 응답 계약 검증에 연결 |
| integration/judgment_bridge.py | 통합 호출·실제 tool_use_id 유지, 검토 기록 저장 |

내부 도구는 기존 다섯 필드에 `assessment`를 추가해 반환하도록 요구합니다.
이 assessment는 내부 호출용 확장이며, 고정해 둔 전처리팀 스키마 파일은 변경하지 않았습니다.
통합 프로그램에 반환하는 최종 응답은 기존 `scenario_id, verdict, actual, snapshot_ids, action_ids`를 유지합니다.

| 모델 응답과 검토의 관계 | 프로그램 처리 |
|---|---|
| passed + 근거 지원·목적 확인 + 모든 조건 met | 기존 실행·증거 검증 후 수용 가능 |
| passed + unknown/unmet 존재 또는 근거·목적 미확인 | inconclusive로 낮추고 이유 기록 |
| candidate + 기대 지원·목적 확인 + 증거 있는 unmet 존재 | 기존 실행·증거 검증 후 후보 수용 가능 |
| candidate인데 위반 근거 없음 | inconclusive로 낮춤 |
| 검토 누락·다른 증거 참조·계약 위반 | 응답 거절, 원문과 실제 도구 ID 보존 |

프로그램은 이 검토만으로 passed를 candidate로 올리거나 버그를 확정하지 않습니다.
`judgment_assessment.json`에는 모델 원래 판정, 검토 내용, 낮춘 사유와 전체 검증 상태를 남깁니다.
`judgments.json`에는 수용된 최종 판정이 저장됩니다.

**한계:** 조건 분해·사실 해석·목적 충족 여부도 모델의 판단입니다.
모델이 조건을 누락하거나 잘못 해석해 모두 met라고 쓰는 의미 오류까지 Python이 자동으로 보증하지 않습니다.
F4 회귀 테스트는 실제 과거 응답에 **고정한 검토 응답**을 붙여 부분 충족 통과를 차단하는지 검증합니다.
Sonnet이 F4를 실제로 다시 찾아냈다는 결과는 아닙니다.

## 4. 재현: 행동 없는 UI 후보 지원

`integration/reproduction.py`는 기존 행동 재실행에 더해, 초기 화면의 UI 이미지 후보를 처리합니다.

1. 명시적으로 설정된 시작 상태 복원 정책과 남은 한도를 확인합니다.
2. 같은 시작 상태로 복원하고 최초 관찰의 URL·제목·텍스트·요소 상태를 비교합니다.
3. 행동 없는 UI는 원본 이미지 관찰도 최초 상태인지 확인합니다. 다른 페이지·다른 상태·스크롤 0이 아닌 경우에는 추측하지 않습니다.
4. 행동이 있는 UI는 기록된 행동을 재실행한 뒤 촬영합니다.
5. 원본과 재현의 URL·화면 크기·스크롤 위치를 비교하고, 실행 루트 내부의 실제 원본·재현 이미지를 모델에 첨부합니다.
6. 같은 시각적 위반이 재현됐다는 판정일 때만 프로그램이 `status=confirmed`를 기록합니다.

UI 관찰 시점과 무관한 후속 행동이 실패했더라도, 독립적으로 최초 상태와 두 이미지를 검증할 수 있는
행동 없는 UI 후보에는 재현 기회를 줍니다. 검증이 실패하면 후보는 그대로 남습니다.
비UI의 실행·관찰 불완전 차단은 유지합니다. 추가 시도는 기존대로 1회입니다.

브라우저 복원은 `--browser-state-reset`으로 승인된 격리된 읽기 전용 검사용 상태에서만 사용합니다.
이는 서버 상태 복원이 아닙니다. 서버를 바꾸는 업무 흐름은 별도 초기화 계약이 필요합니다.
이번 작업에서 원격 Maison의 `/_reset`은 호출하지 않았습니다.

## 5. 산출물과 활성화

실제 CLI(`python -m integration ...`)는 `quality_checks=True`로 개선 경로를 사용합니다.
직접 `Runtime`을 생성하는 기존 라이브러리 호출은 호환을 위해 기본값 False이며,
개선 경로는 `Runtime(..., quality_checks=True)`로 켭니다.
기존 독립 `judge()`·오프라인 예시의 기본 계약 경로는 유지합니다.

각 flow의 추가 파일:

| 파일/필드 | 의미 |
|---|---|
| judgment_assessment.json | 모델의 조건별 검토·원래/최종 판정·보류 사유·검증 수용 상태 |
| coverage.json | 계획 여부·실행 상태·증거 확보·판정·재현을 구분한 기록 |
| deferred_shared_checks | 같은 실행에서 완료해 제외한 공통 폼 검사 |
| reproduction-*.json | 재현 판정의 요청·응답·결과, UI는 원본/재현 이미지 메타데이터 포함 |

coverage는 기능 검사 진행 기록이며 버그 정답 대비 재현율이나 의미 정확도 점수가 아닙니다.

## 6. 검증과 다시 실행하는 방법

프로젝트 루트의 PowerShell에서 실행합니다. 새 테스트는 별도 test 디렉토리에 있습니다.

```powershell
$env:PYTHONUTF8 = "1"
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection -t . -v
.\.venv\Scripts\python.exe -m unittest discover -s scripts/test -t . -v
$env:PYTHONPATH = (Resolve-Path "external/WebTestPilot-integration/teams/member-01").Path
.\.venv\Scripts\python.exe -m unittest discover -s external/WebTestPilot-integration/teams/member-01/integration/test -t external/WebTestPilot-integration/teams/member-01 -v
.\.venv\Scripts\python.exe -m integration.test_staged
.\.venv\Scripts\python.exe -m integration.test_executor
.\.venv\Scripts\python.exe -m integration.test_regressions
```

실제 localhost Playwright MCP와 고정한 모델 응답으로 결과 파일을 생성하는 데모:

```powershell
# 위 PYTHONPATH 설정 후, 아직 없거나 비어 있는 출력 폴더를 지정합니다.
.\.venv\Scripts\python.exe -m integration.test.generate_quality_demo --output "결과파일/ai_inspection/quality_improvement/new_local_demo"
```

정상 카운터, 결함 카운터, 행동 없는 UI 재현, 정상 장바구니, 거짓 성공 장바구니를 검사합니다.
장바구니는 토스트에서 멈추지 않고 실제 Bag 화면의 내용까지 확인합니다.
UI 사례는 이미지 전달 경로 확인을 위해 고정한 후보·재현 응답을 사용하므로 실제 시각 오류 탐지 성능을 주장하지 않습니다.
저장 위치: `결과파일/ai_inspection/quality_improvement/20261015_verified/`.

### 이번 작업에서 확인한 결과

| 검증 | 결과 |
|---|---|
| 원본 AI 검사기 전체 테스트 | 65개 중 61개 통과, 선택 브라우저/MCP 4개 건너뜀 |
| 동기화 스크립트 테스트 | 5개 통과 |
| 새 통합 unittest | 14개 통과 |
| 기존 staged 경계 검사 | 통과 |
| 기존 실제 MCP executor 회귀 | adaptive·replay·correction·오류·한도·취소 등 11개 사례 통과 |
| 기존 상태 복원/재현 회귀 | 메일 링크·동적 이동·브라우저 복원·로컬 서버 seed·실패·기한·취소 7개 사례 통과 |
| 새 실제 localhost MCP 데모 | 아래 5개 사례 통과, 각 flow의 assessment/coverage 저장 확인 |

| 로컬 사례 | 수용/재현 결과 |
|---|---|
| normal | passed |
| broken | candidate → reproduced → confirmed |
| ui_replay | 고정한 UI 후보 → 두 실제 이미지 첨부 → 고정한 reproduced → confirmed |
| bag_normal | 실제 Bag: 1까지 확인 후 passed |
| bag_false_success | 성공 알림 이후 실제 Bag: 0 확인 → 후보 → 재현 후 confirmed |

데모의 모델 호출과 토큰 수는 고정한 모델의 테스트 계측입니다. 실제 API 사용량이나 과금으로 해석하지 않습니다.
이 작업의 유료 검사 API 호출은 0회입니다.

## 7. 아직 해야 할 일

- 별도 Sonnet 재검사는 완료했습니다. 다만 URL 시작 방식·복원 정책·행동 한도 등이 달라, 같은 조건·예산을 고정한 비교 실험은 후속 작업입니다.
- 계정·주문·유효 재설정 링크 준비와 password 지원은 실행 담당과 별도 계약이 필요합니다.
- 화면 폭 변경·키보드 포커스·동적 UI의 다양한 상태를 검사하는 계획/관찰 지원을 확대합니다.
- 공통 검사 중복의 의미상 판별과 run을 넘는 중복 관리, 기대 조건 품질의 사전 자동 심사를 추가 평가합니다.
- 원격 Maison 재검사의 후보·재현 결과는 별도 실행으로 저장했습니다. 과거 원본 후보·확정 상태는 변경하지 않았습니다.

운영 코드는 외부 팀의 격리된 통합 작업 폴더에 연결했고 파일을 임의 이동하지 않았습니다.
