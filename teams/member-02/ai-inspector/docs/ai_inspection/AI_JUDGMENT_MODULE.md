# 판정 모듈 개발·연결 문서

> Git share: use [REPRODUCE.md](../../REPRODUCE.md) for current setup and [shared evidence](../../reports/maison_2026-10-16/README.md) for results. Historical local workspace paths below are development records.

기준일: 2026-10-15. 구현 위치는 src/ai_inspection/judgment/입니다.
조건별 검토와 통합 실행 품질 보완은 [10월 15일 변경 기록](INSPECTION_QUALITY_IMPROVEMENTS_2026-10-15.md)에 있습니다.

## 범위와 계약 기준

전처리팀 실행 이후의 judge_input/2를 받아 scenario_judgments 응답 내용을 반환합니다.
기존 suggested_checks 분석·전달 초안·MCP 실행 기능과 분리된 단계입니다.
브라우저 행동·추가 재현·confirmed 처리·PDF 생성은 이 모듈에서 수행하지 않습니다.

계약 기준은 WebTestPilot development 커밋 ab5d8f07d7274e3feaf268c6ebe3ef50e6f617d5입니다.
이 커밋의 integration/schemas/와 examples/ 중 판정 파일 4개를 로컬 패키지에 그대로 보존했습니다.
[전처리팀 판정 문서](https://github.com/bibimmando/WebTestPilot/blob/ab5d8f07d7274e3feaf268c6ebe3ef50e6f617d5/teams/member-01/integration/docs/JUDGMENT_CONTRACT.md)가 기준입니다.
상위 프로그램의 내부 변경을 자동 반영하지 않습니다. 계약 변경 시 스키마·예시·검증 코드를 함께 검토합니다.

## 구현 파일

| 파일 | 역할 |
|---|---|
| input_contract.py | 고정 JSON Schema 검증·중복 시나리오·누락 관찰·증거 소유권 확인, 전후 관찰 조회 |
| prompts.py | 실행 대화와 분리된 판정 system 프롬프트 |
| images.py | 실행 루트 내부의 PNG/JPEG 파일 읽기·base64 이미지 블록·누락 상태 |
| response_contract.py | 응답 구조·시나리오 대응·증거 참조·실행/관찰 조건 검증 |
| assessment.py | 내부 조건별 검토 스키마, 근거·목적·전체 조건 미확인의 통과/후보를 판단 불가로 낮춤 |
| judge.py | 모델 주입 함수·요청 구성·오프라인 CLI·결과 파일 저장 |
| async_adapter.py | 기존 비동기 모델 호출과 연결, 실제 tool_use_id 유지·취소/한도 오류 전달 |
| schemas/ | 전처리팀 입력·응답 스키마 고정본 |
| examples/ | 실제 사이트 결과가 아닌 네 유형의 합성 예시 |
| test/test_judgment.py | 합성 사례·잘못된 ID·관찰 누락·UI 이미지·파일 출력 테스트 |

## 입출력

입력은 judge_input.json입니다. scenarios와 observations[snapshot_id]를 연결하고,
각 시나리오의 expected·expected_source는 실행 전에 정한 값을 그대로 사용합니다.
unplanned는 판정 대상이 아닙니다. null 전후 ID는 미확인으로 취급합니다.
정책 차단·unknown 실행·누락 증거를 앱 오류로 자동 변환하지 않습니다.

응답은 아래 모델 도구 입력 내용만 반환합니다. 통합 프로그램의 judgments.json 메타데이터와 구분합니다.
개선된 통합 호출은 내부 AI 도구 응답에 assessment를 추가로 요구하고 검토 후 아래 기존 다섯 필드로 반환합니다.
내부 확장은 별도이며 고정 팀 스키마 파일 자체는 변경하지 않았습니다.

```json
{
  "judgments": [
    {
      "scenario_id": "counter_increment",
      "verdict": "candidate",
      "actual": "클릭은 수행됐지만 카운터 값이 유지돼 기대 결과와 다릅니다.",
      "snapshot_ids": ["snapshot-counter-before", "snapshot-counter-after"],
      "action_ids": ["action-counter"]
    }
  ]
}
```

passed는 기대 조건 충족, candidate는 증거가 있는 불일치, inconclusive는 판단 불가입니다.
confirmed는 반환하지 않습니다. 판정 단계에서 기대값·family를 새로 작성하지 않습니다.

## 검증과 한계

입력 구조·참조를 먼저 검증하고 모델을 호출합니다. 응답은 시나리오별 정확히 1개여야 합니다.
다른 시나리오의 증거, 없는 ID, 빈 설명, snapshot 인용 없는 응답을 거절합니다.
completed가 아니거나 정책 차단된 시나리오의 passed/candidate도 거절합니다.
인용한 행동은 executed·관찰 available·전후 ID 확보·정책 차단 없음이어야 합니다.
UI의 passed/candidate에는 실제 첨부된 이미지의 snapshot 인용이 필요합니다.

전처리팀 기본 검증보다 엄격하게 **passed/candidate에서 인용한 행동의 전후 snapshot을 모두 인용**하도록 요구합니다.
통합 시 이 추가 규칙을 공유해야 합니다. 일부 증거만 인용한 기존 응답은 거절될 수 있습니다.
형식 검증으로 actual의 모든 사실 정확성이나 verdict의 의미 정확성까지 보장하지 않습니다.
상품 수 등 설명과 관찰의 모순, 기대 근거가 추측인 사례는 후속 평가 대상으로 남습니다.

실행되지 않은 시나리오가 직접 들어오면 프롬프트는 inconclusive를 요구하고 conclusive 응답을 거절합니다.
전처리팀의 0회 시도 not_run 자동 처리와 같은 program_policy 메타데이터는 여기에서 만들지 않습니다.
빈 scenarios에는 주입 모델을 호출하지 않고 빈 judgments를 반환합니다.

## 실제 이미지 처리

--run-root는 output/<run>/ 같은 실행 산출물의 루트입니다. flows/<flow_id>/를 기준으로 추측하지 않습니다.
상대 경로는 실행 루트 기준, 절대 경로도 해당 루트 내부인 경우만 허용합니다.
해석된 경로가 루트 외부면 읽지 않습니다. 파일 누락·읽기 실패·형식/크기 제한은 image_availability에 표시합니다.
현재 PNG/JPEG 시그니처를 확인하며 픽셀 디코딩·손상 이미지 판독 검증은 구현하지 않았습니다.
기본 파일당 5,000,000바이트, 전체 15,000,000바이트 상한입니다.
모델 요청에는 실제 base64 바이트를 넣고 바로 앞 텍스트에 scenario_id·snapshot_id를 연결합니다.
run_root가 없거나 실제 이미지가 없으면 UI의 passed/candidate를 수용하지 않습니다.

## API 호출 없는 CLI

프로젝트 루트에서 필요한 의존성을 설치합니다.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-ai.txt
```

요청 준비만 수행:

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.judgment.judge --input "src/ai_inspection/judgment/examples/judge_input.v2.example.json" --prepare-only --output-dir "결과파일/ai_inspection/judgment/prepared"
```

제공된 합성 응답을 검증:

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.judgment.judge --input "src/ai_inspection/judgment/examples/judge_input.v2.example.json" --mock-response "src/ai_inspection/judgment/examples/scenario_judgments.example.json" --output-dir "결과파일/ai_inspection/judgment/synthetic_contract"
```

실제 산출물을 읽을 때는 --input 경로를 바꾸고 --run-root "output/해당실행"을 추가합니다.
현재 CLI에는 유료 모델 호출 옵션이 없습니다. 기존 ai_inspector CLI와 독립된 모듈 명령입니다.
준비·모의 검증 정상 종료는 0, 잘못된 입력·응답·파일 처리는 2입니다.

## 출력 파일

| 파일 | 설명 |
|---|---|
| judgment_request.json | 독립 system·messages·scenario_judgments 도구 스키마. 이미지는 저장 시 image_reference로 바꿈 |
| judgment_response.json | 검증된 모델 도구 입력 내용. 아직 판정하지 않았거나 실패하면 status=not_run 표시 |
| judgment_run.json | 계약 커밋·run/flow ID·모드·상태·시나리오 수·이미지 확보 상태·모델 호출 수·반환 사용량 |

judgment_request.json의 image_reference는 보관용 표현이고 모델에 그대로 전송하는 규격이 아닙니다.
주입 모델에는 prepare_request가 만든 실제 image 블록을 전달합니다. base64는 디스크 로그에 복사하지 않습니다.
같은 출력 폴더를 다시 사용하면 파일을 갱신하며, 이전 정상 응답을 새 실행 결과로 오인하지 않도록 시작 시 not_run으로 초기화합니다.
입력·모의 응답·읽은 이미지 파일을 출력이 덮어쓰는 경우 거절합니다.
요청 파일과 결과에는 사이트 내용·테스트 입력이 포함될 수 있습니다. API 키는 읽거나 기록하지 않습니다.

## 프로그램 연결 인터페이스

```python
from src.ai_inspection.judgment.judge import judge

reply = judge(payload, model=model_adapter, run_root=execution_output_root)
```

model_adapter(request)는 system·messages·tools·tool_choice를 받아 scenario_judgments 도구의 input dict를 반환하는 함수입니다.
현재 전처리팀 models.py의 원시 content/tool_use 응답을 그대로 반환하면 안 됩니다.
그 공통 계층을 호출하고, 실제 tool_use ID를 통합 계층에 보존하며, 원하는 도구 입력을 추출하는 어댑터가 필요합니다.
통합 프로그램의 호출 한도·시간 제한·취소·사용량 관리도 이 어댑터와 기존 관리자에서 유지해야 합니다.
이 통합 어댑터를 별도 worktree의 integration/judgment_bridge.py에 구현했습니다.
staged.py가 judge_input을 전달하면 제품용 judgment.async_adapter를 거쳐 기존 _call/_exchange를 사용합니다.
새 모델 전송 계층이나 별도 API 키 설정을 추가하지 않았습니다. 실제 tool_use ID는 반환값과 검증 실패 정보에 유지합니다.
원본 개발 위치와 제품 복사본·동기화 방법은 [전체 파이프라인 안내](PROJECT_PIPELINE_GUIDE.md)에 있습니다.

judge()는 입력·모델·검증 오류를 호출자에게 전달하고 자동 재시도·모델 승격을 하지 않습니다.
파일을 남기려면 export_judgment(..., model=model_adapter)를 사용합니다.
이때 last_usage dict가 있으면 모델 응답 검증 실패에도 반환 사용량을 집계에 보존합니다.
일반 실패 원문은 결과 파일에 기록하지 않고 error_type만 남깁니다. 호출 취소 정책은 통합 호출자가 담당합니다.

## 검증 기록과 다음 단계

테스트 위치는 judgment/test/이며 구현과 분리했습니다.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection/judgment/test -t . -v
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection -t . -v
```

합성 4개 시나리오의 candidate·inconclusive·passed·inconclusive 응답을 모의 검증했습니다.
이 결과는 모델 판단 정확도 평가가 아니라 제공된 응답과 판정 계약 연결 검증입니다.
입력 누락·중복·타 시나리오 참조, 실행 불완전·unknown, 실제 UI 이미지와 경로/크기 제한,
이전 출력 초기화·사용량 보존·원본 덮어쓰기 거절도 테스트합니다.
기본 전체 AI 테스트 54개 중 50개 통과·브라우저/MCP 선택 테스트 4개 건너뜀, 동기화 테스트 3개 통과를 확인했습니다.
외부 사이트·실제 MCP·유료 모델을 이번 작업에서 호출하지 않았습니다.

위 54개 테스트 기록은 최초 독립 모듈 구현 시점의 기록입니다.
비동기 연결 테스트를 추가한 현재 기본 전체는 59개 중 55개 통과·선택 4개 건너뜀이며 동기화 5개·새 통합 5개도 통과했습니다.
기존 통합의 staged·executor·integration·form_evidence·performance·regressions도 모의 모델·로컬 브라우저로 통과했습니다.
실제 localhost MCP 증거를 받아 판정 검증·기존 재현·보고서 JSON까지 연결했고 정상/결함 데모 산출물을 보관했습니다.
이번 연결 검증에서는 실제 MCP·브라우저를 사용했지만 외부 사이트·유료 모델은 호출하지 않았습니다.
다음은 실제 증거 1건의 실제 모델 판정을 확인하는 단계입니다. 그 이후 의미 정확도·증거 경량화·리포트를 보완합니다.
