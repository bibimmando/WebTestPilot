# WebTestPilot 전체 흐름과 판정 개발 안내

> Git share: use [REPRODUCE.md](../../REPRODUCE.md) for current setup and [shared evidence](../../reports/maison_2026-10-16/README.md) for results. Historical local workspace paths below are development records.

기준일: 2026-10-16. 처음 보는 개발자를 위한 현재 작업 기준입니다.
이 문서부터 읽고, 판정 상세는 [AI_JUDGMENT_MODULE.md](AI_JUDGMENT_MODULE.md)를 참고하세요.
10월 15일의 계획·판정·UI 재현 보완은 [검사 품질 보완 기록](INSPECTION_QUALITY_IMPROVEMENTS_2026-10-15.md)에 있습니다.
이후 진행한 관찰 URL·대상 일치·목록/수량 증거·캠페인 기록 보완은 [범용 실행 신뢰성 보완](EXECUTION_RELIABILITY_IMPROVEMENTS_2026-10-15.md)을 참고하세요.
최신 전체 점검의 확정 집계는 [17개 중 6종 재현 확인 기록](BUG_CONFIRMATION_FULL_REVIEW_2026-10-16.md)에 있습니다. 이전 실행의 수치와 구분해 읽으세요.

## 1. 프로젝트가 하는 일

웹사이트의 기능을 검사하기 위해 페이지를 관찰하고 행동을 실행한 뒤, 실제 증거와 기대 결과를 비교합니다.
예를 들어 증가 버튼을 클릭했을 때 카운터가 0에서 1이 되는지 검사합니다.
버튼을 클릭했다는 사실, 화면을 수집했다는 사실, 기능이 정상이라는 판단은 각각 별개입니다.

역할은 다음과 같습니다.

| 역할 | 책임 |
|---|---|
| 전처리 | 페이지·요소·폼·이벤트·네트워크·스냅샷 관찰과 증거 연결 |
| 계획 AI | 검사 목적·행동·입력값·기대 동작과 근거 작성 |
| 실행 AI | 현재 화면에서 계획할 때 정한 행동의 실제 대상을 선택 |
| Python·Playwright MCP | 정책·요소·한도 확인 후 브라우저 행동 실행 |
| 판정 AI — member-02 담당 | 실행 후 증거와 고정 기대 동작 비교 |
| 통합 프로그램 | 응답 검증·재현·보고서 데이터·다음 URL 처리 |

```text
URL·요구사항
 → 전처리(ai_input/1)
 → 계획 AI(test_plan/2)
 → 계획 검증
 → 실행 AI ↔ MCP 행동·전후 증거
 → judge_input/2 + 실제 이미지
 → member-02 판정 모듈
 → 응답 검증
 → 후보 추가 재현·별도 재판정
 → findings/report JSON
```

현재 통합 파이프라인 버전은 staged/3이며, 판정 계약은 judge_input/2입니다.
판정 모듈은 브라우저를 추가로 조작하지 않습니다. 최초 판정과 재현 판정도 같은 일이 아닙니다.
새 모듈은 최초 판정에 연결했고, 재현 판정은 기존 reproduction.py를 유지합니다.
10월 15일에는 이 reproduction.py에 실제 원본·재현 이미지를 전달하는 UI 재현 경로도 추가했습니다.

### flow·시나리오·행동의 단위

flow는 특정 페이지에 진입해 최초 관찰부터 계획·실행·판정·재현·저장까지 진행하는 한 묶음입니다.
flow 하나에 시나리오 여러 개, 시나리오 하나에 행동 여러 개가 들어갈 수 있습니다.
중간에 링크로 이동할 수 있으므로 flow가 하나의 URL에만 머무는 것은 아닙니다.
같은 URL에서 검사를 다시 시작하면 별도 flow입니다. 10월 14일 검사는 고유 URL 29개·flow 33개·시나리오 84개였습니다.

## 2. 파일로 이해하는 파이프라인

| 파일 | 내용과 담당 |
|---|---|
| input.json | 수집한 최초 페이지 관찰·요구사항·권한·한도 |
| scenario_proposals.json | 페이지 기능 요약과 설명형 검사 제안 |
| test_plan.json | 실행 전에 검증한 시나리오·행동·고정 기대값 |
| execution_bindings.json | 고정 대상의 역할·이름/주소·동일 노드 참조와 거절된 시나리오 |
| execution_results.jsonl | 행동마다 실제 MCP 실행 결과·오류·전후 증거 |
| scenario_results.json | 계획 단계의 진척과 실행·관찰 상태, 앱 판정은 아님 |
| judge_input.json | 판정용 시나리오와 snapshot_id → 관찰 맵 |
| judgment_request/response.json | 기존 모델 호출 관리자가 저장한 실제 판정 요청·응답 |
| judgments.json | 수용된 판정, 실제 tool_use_id, 프로그램 추가 정보 |
| reproduction-*.json | 후보의 추가 재현 결과 |
| findings.json·report.json | 판정·재현·사용량·단계 상태 집계 |

통합 실행 결과의 flow 파일은 output/<run>/flows/<flow_id>/에 있습니다.
이미지는 output/<run>/ 기준으로 찾습니다. judge_input.json이 있는 flow 폴더 기준이 아닙니다.
JSON의 이미지 경로만 전달해서는 AI가 이미지를 본 것이 아닙니다. 실제 바이트가 별도 이미지 블록으로 전달돼야 합니다.

## 3. 상태의 의미

| 상태 | 의미 |
|---|---|
| executed | 행동 명령이 처리됨, 기능 정상이라는 뜻은 아님 |
| not_executed | 명령을 실행하지 못한 것으로 확인 |
| unknown | 실제 수행 여부가 불명확하므로 자동 반복하지 않음 |
| observation available/incomplete | 판단에 필요한 관찰이 확보됐는지 |
| passed | 충분한 증거가 고정 기대 결과 충족을 뒷받침 |
| candidate | 증거에서 고정 기대 결과와 불일치 발견, 아직 문제 후보 |
| inconclusive | 실행·관찰·기대 근거 부족 또는 정책 차단으로 판단 불가 |
| confirmed | 최초 AI 응답 값이 아님. 초기화·추가 재현 후 프로그램이 기록 |

문제가 있는 증가 버튼 fixture에서 클릭 완료, 카운터 0 유지가 관찰되면 candidate가 될 수 있습니다.
클릭이 실패했거나 관찰이 누락됐으면 그 자체를 카운터 기능의 버그로 확정하지 않습니다.
화면 변화 없음·요청 없음·콘솔 오류 없음·submit 이벤트 발생도 단독으로 앱 정상/오류를 증명하지 않습니다.
정책이 POST를 막았다면 프로그램의 제한을 앱 결함으로 판단하면 안 됩니다.

## 4. 두 작업 폴더의 역할

```text
프로젝트/
├─ src/ai_inspection/judgment/          # 판정 구현 원본
├─ docs/ai_inspection/                 # 설명·계약·실행 문서
├─ scripts/sync_judgment_integration.py # 원본 → 통합 배포본 동기화
└─ external/
   ├─ WebTestPilot/                    # 기존 member-02 작업 checkout
   └─ WebTestPilot-integration/        # 최신 development 기반 별도 worktree
      └─ teams/member-01/integration/
         ├─ staged.py                 # 기존 단계 관리자의 판정 구간 수정
         ├─ judgment_bridge.py        # 기존 모델 호출과 우리 모듈 연결
         ├─ judgment/                 # 원본에서 반영한 제품용 패키지
         └─ test/                     # 새 통합 테스트·로컬 데모
```

worktree는 원본 Git 저장소와 이력을 공유하지만 파일·브랜치는 별도로 작업하는 폴더입니다.
통합 작업 브랜치는 feature/member-02/judgment-integration, 시작 커밋은 ab5d8f0입니다.
기존 member-02 checkout은 브랜치와 파일을 변경하지 않았습니다.
프로젝트 최상위 폴더 자체는 Git 저장소가 아닙니다. Git 상태는 각 external 저장소 경로에서 확인합니다.

개발은 src/ai_inspection/judgment/에서 합니다. 통합 제품은 integration.judgment를 import합니다.
제품이 로컬 src 폴더나 member-02 팀 폴더를 런타임에 찾아 import하는 방식은 사용하지 않습니다.
중복 개발을 피하기 위해 제품용 패키지는 아래 스크립트로 원본에서 반영하고 source_manifest.json에 해시를 남깁니다.
integration/judgment/를 직접 편집하지 말고 원본을 수정한 뒤 동기화합니다.
동기화는 기존 파일 복사만 수행하며 삭제·Git stage·commit·push를 하지 않습니다. 원본에서 파일을 제거하는 변경은 따로 검토해야 합니다.

```powershell
# 프로젝트 루트: 기본은 미리보기
.\.venv\Scripts\python.exe scripts/sync_judgment_integration.py
# 검토한 원본을 통합 패키지에 반영
.\.venv\Scripts\python.exe scripts/sync_judgment_integration.py --apply
```

원본의 테스트는 복사하지 않습니다. 원본 테스트는 로컬 패키지를, 통합 test/는 제품 패키지를 검사합니다.

## 5. 실제 연결 지점

```text
staged.py: judge_input 생성·저장
 → judgment_bridge.run_judgment()
 → judgment.async_adapter.judge_async()
 → input 검증·prepare_request·실제 이미지 읽기
 → bridge callback
 → 기존 staged._call() → _exchange() → 모델 complete()
 → 실제 도구 input·tool_use_id 추출
 → 우리 응답·증거 검증
 → 기존 _check_judgments()
 → findings·judgments 저장·기존 재현
```

기존 _call/_exchange/models.py를 그대로 사용하므로 별도 API 클라이언트나 키 설정을 추가하지 않았습니다.
기존 호출 횟수·라운드 한도·실행 취소·요청 제한·사용량·시간 계측 경로를 유지합니다.
모델 호출 뒤 응답 검증에 실패해도 수신한 tool_use_id를 오류 결과에 보존합니다.
입력 검증 실패는 모델 호출 전에 처리합니다. 없는·중복 시나리오, 다른 시나리오의 증거를 거절합니다.
모델 전송·취소·한도 오류는 자동 재시도하지 않고 기존 관리자에게 전달합니다.

현재 추가 규칙: passed/candidate에서 인용한 행동의 전후 snapshot ID를 모두 인용해야 합니다.
UI의 확정적 판정은 실제 첨부 이미지와 해당 snapshot 인용이 필요합니다.
스키마 검증이 actual 문장의 사실 정확성까지 보장하지는 않습니다. 의미 평가가 후속으로 필요합니다.

## 6. 설치와 오프라인 테스트

모든 아래 명령은 프로젝트 루트 기준입니다. 가상환경은 프로젝트의 기존 .venv를 사용합니다.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-ai.txt
.\.venv\Scripts\python.exe -m pip install -r external/WebTestPilot-integration/teams/member-01/integration/requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
npm.cmd install --prefix external/WebTestPilot-integration/teams/member-01/.tools/playwright-mcp @playwright/mcp@0.0.83 --no-audit --no-fund
```

Node.js가 PATH에서 실행 가능해야 합니다. 패키지 설치는 네트워크를 사용할 수 있지만 아래 테스트는 localhost·모의 모델을 사용합니다.
Windows의 기존 통합 테스트는 기본 인코딩으로 JSON을 읽는 곳이 있어 PYTHONUTF8=1을 설정합니다.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection -t . -v
.\.venv\Scripts\python.exe -m unittest discover -s scripts/test -v

$env:PYTHONPATH = (Resolve-Path "external/WebTestPilot-integration/teams/member-01").Path
$env:PYTHONUTF8 = "1"
.\.venv\Scripts\python.exe -m unittest integration.test.test_judgment_bridge -v
.\.venv\Scripts\python.exe -m integration.test_staged
.\.venv\Scripts\python.exe -m integration.test_executor
.\.venv\Scripts\python.exe -m integration.test_integration
.\.venv\Scripts\python.exe -m integration.test_form_evidence
.\.venv\Scripts\python.exe -m integration.test_performance
.\.venv\Scripts\python.exe -m integration.test_regressions
```

기존 환경변수가 설정돼 있다면 값을 보관했다가 검증 후 되돌리세요.
위 테스트는 외부 대상 사이트·유료 AI를 호출하지 않습니다. 초기화도 로컬 fixture에만 적용합니다.

## 7. 결과 파일을 남기는 로컬 데모

대부분의 통합 테스트는 임시 결과를 삭제합니다. 실제 파일을 읽고 싶으면 아래 데모를 사용하세요.
기존 출력이 있으면 거절하므로 재실행할 때는 다른 빈 폴더를 지정합니다.

```powershell
$env:PYTHONPATH = (Resolve-Path "external/WebTestPilot-integration/teams/member-01").Path
$env:PYTHONUTF8 = "1"
.\.venv\Scripts\python.exe -m integration.test.generate_judgment_demo --output "external/WebTestPilot-integration/teams/member-01/output/judgment-connected-demo"
```

normal/과 broken/ 두 사례를 저장합니다. 모두 localhost 카운터이며 실제 MCP와 브라우저를 사용합니다.
계획·실행·판정 모델은 고정된 모의 응답입니다.
normal은 0→1 관찰 후 passed, broken은 0 유지의 candidate와 기존 추가 재현 흐름을 확인합니다.
이 결과는 AI 성능 측정이 아니라 파이프라인 연결 검증입니다.

읽는 순서:

1. normal/flows/<flow_id>/test_plan.json: 무엇을 실행할 계획이었는지 확인합니다.
2. execution_results.jsonl: 실제 수행 여부와 전후 snapshot ID를 봅니다.
3. judge_input.json: 시나리오와 observations의 연결을 봅니다.
4. judgment_request.json: 우리 프롬프트와 이미지가 모델 요청에 들어갔는지 봅니다.
5. judgments.json: verdict·actual·인용 증거·실제 tool_use_id를 봅니다.
6. broken 쪽 reproduction-*.json·findings.json: 최초 후보와 재현 결과를 구분합니다.
7. normal/report.json과 broken/report.json: 실행 전체 집계를 봅니다.

## 8. 기존 경로와의 차이

이전 hybrid_ai_input.jsonl → --analyze → suggested_checks는 저장 증거 분석의 별도 경로입니다.
execution_plans.jsonl은 설명형 제안에서 만든 전달 초안이며 통합 실행의 test_plan/2와 다릅니다.
이번에 연결한 것은 실행 후 judge_input/2 판정 단계입니다. 초안 33건을 자동 실행한 작업이 아닙니다.
독립 판정 CLI의 judgment_run.json 등과 통합 실행의 flow 파일은 역할·메타데이터가 다릅니다.

## 9. 2026-10-13 초기 연결 검증 기록

이번 원본 AI 테스트는 59개 중 55개 통과·선택 브라우저/MCP 4개 건너뜀이며,
동기화 테스트 5개와 새 통합 테스트 5개도 통과했습니다.
기존 staged·executor·integration·form_evidence·performance·regressions도 로컬에서 통과했습니다.
executor의 11개 사례, 정상·결함·UI 실이미지·unknown 실행·정책 차단·관찰 실패·취소·재현을 포함합니다.
모델은 모두 모의 응답이며 외부 사이트 검사·유료 모델은 이번 작업에서 호출하지 않았습니다.

다음은 실제 증거 1건을 실제 모델로 판정하고, 관찰·actual·verdict의 모순과 기대 근거의 불명확함,
오탐·미탐을 확인하는 작업입니다. 로그인·상태 초기화·확대 검사·PDF는 관련 담당과 별도로 연결합니다.
기존 통합 코드의 재현·report.json을 유지했으며 이번에 PDF를 완성하거나 실제 AI 정확도를 보장한 것은 아닙니다.
이 변경은 로컬 작업이며 GitHub commit/push는 아직 하지 않았습니다.

위 건수와 유료 호출 여부는 10월 13일 초기 연결 작업의 기록입니다.
이후 10월 14일 실제 Sonnet 검사 결과는 [회의 자료](MEETING_MAISON_SONNET_2026-10-14.md),
10월 15일 보완과 새 검증은 [품질 보완 기록](INSPECTION_QUALITY_IMPROVEMENTS_2026-10-15.md)을 기준으로 읽습니다.

## 10. 버그를 어떻게 판정하고 확정하는가

### 실행 전에 기대 조건을 고정한다

계획 AI가 test_plan.json에 expected와 expected_source를 기록합니다.
기대 조건은 요구사항·관찰된 UI·잠정적인 추정 중 어떤 근거인지 밝혀야 합니다.
알림이 뜨거나 클릭이 처리됐다는 사실만으로 업무 동작이 완료됐다고 간주하지 않습니다.
예를 들어 장바구니 추가 검사는 실제 장바구니에서 상품·수량을 확인하는 증거가 필요합니다.
필터 해제 검사는 수량 하한만 확인하는 대신, 필터 해제와 전체 목록 복귀를 확인해야 합니다.

### 내용 판단과 프로그램 검증을 구분한다

판정 AI는 별도 대화에서 고정 기대 조건과 해당 시나리오의 전후 관찰·실제 이미지를 비교합니다.
Python은 JSON 구조, 시나리오 대응, 증거 소유권, 행동 수행/관찰 상태, 실제 이미지 첨부와 인용을 검증합니다.
이 검증이 설명 문장의 모든 사실과 의미까지 보증하지는 않습니다.

통합 CLI의 개선 경로는 AI에게 조건별 met/unmet/unknown과 근거·검사 목적 검토를 추가로 받습니다.
passed인데 조건 일부가 unknown/unmet이거나 기대 근거·목적이 확인되지 않으면 inconclusive로 낮춥니다.
candidate인데 뒷받침된 위반 조건이 없어도 inconclusive로 낮춥니다.
그 검토는 judgment_assessment.json, 팀 계약에 맞게 수용한 결과는 judgments.json에 저장합니다.

| 관찰 예시 | 가능한 최초 판정 |
|---|---|
| 계획한 클릭 후 상품·수량이 실제 장바구니에서 기대와 일치 | passed |
| 클릭이 수행됐고 실제 장바구니가 비어 있어 근거 있는 기대와 불일치 | candidate |
| 알림은 떴지만 장바구니로 이동하지 못해 내용 확인 불가 | inconclusive |
| UI 화면이 검사하려던 URL/영역과 다르거나 실제 이미지 없음 | inconclusive |

부분 조건만 충족한 결과를 통과시키지 않도록 보완했지만, 조건 분해나 목적 판단이 잘못된 모델 응답은 추가 의미 평가가 필요합니다.
원래 모델 응답과 낮춘 판정은 구분해서 저장하며 프로그램은 임의로 후보나 확정 상태로 올리지 않습니다.

### 버그 후보를 추가 재현한다

```text
candidate
 → 승인된 동일 시작 상태 복원
 → 기록된 행동을 추가 1회 재실행 또는 초기 UI 화면 재촬영
 → 실제 증거로 reproduction_verdict 요청
 → reproduced이면 프로그램이 finding.status=confirmed 기록
```

not_reproduced는 이번 추가 시도에서 반복되지 않았다는 뜻이며 정상 확정은 아닙니다.
상태 복원·행동·이미지·기대 근거가 부족하면 재현은 not_run/incomplete/inconclusive로 남고 후보를 확정하지 않습니다.
행동 없는 UI 후보는 최초 상태·동일 URL·화면 크기·스크롤을 확인한 뒤 원본과 재현 이미지를 실제로 첨부합니다.
브라우저 상태 복원이 서버 데이터의 동일성을 보증하지는 않습니다. 상태가 있는 업무는 별도 초기화 계약이 필요합니다.

### 현재 결과와 아직 검증하지 않은 것

10월 14일 Maison에서는 후보 7건을 기록했지만 재현을 수행하지 못해 확정은 0건입니다.
10월 15일 코드 보완은 그 과거 결과의 상태를 바꾸지 않습니다.
새 경로의 최초 연결 검증은 localhost의 실제 MCP와 고정한 모델 응답으로 수행했습니다.
이후 10월 15일 Sonnet으로 같은 29개 URL을 재검사해 83개 시나리오를 기록했고,
정답 17종 중 F4·U5 두 종류를 후보로 탐지하고 추가 재현으로 확정했습니다.
같은 버그의 여러 페이지 기록은 종류 수에 중복 합산하지 않습니다.
[실제 Sonnet 재검사·이전 결과 비교](SONNET_REINSPECTION_COMPARISON_2026-10-15.md)에 수치·근거·실패 사례·실행 조건 차이를 기록했습니다.
계정/주문 전체 흐름·다양한 화면 폭·더 엄밀한 동일 조건 비교는 후속 작업입니다.
