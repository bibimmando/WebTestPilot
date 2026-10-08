# 전처리 JSON 기반 AI 검사 초기 구현

현재 흐름은 `전처리 JSON → 검사 후보 선택 → Playwright 관찰 → Claude 검사 계획 → 선택적으로 Playwright 실행 → 관찰 JSON`입니다.
페이지 기능과 실행할 검사 후보를 정리하고, 입력·클릭·키 입력 후의 화면과 오류를
저장합니다. 버그 판정과 사용자용 리포트는 후속 단계에서 추가합니다.
기존 `webtestpilot.py`의 전처리 실행과 별도 명령이며, `--input`으로 전처리 결과를
받습니다. 현재 저장소의 `*_ranked.json` 형식(`schema_version: 1`)을 지원하며,
URL 하나를 직접 전달하는 방식도 유지합니다. 팀의 전처리기 출력 형식이 바뀌면
`src/ai_inspection/inspection_input.py`의 입력 변환 부분에서 연결합니다. 임의의 JSON이나
`*_crawl.json` 원본을 그대로 입력받는 것은 아닙니다.

전처리 JSON을 읽는 연결은 **구현되어 있습니다**. `--input`에 파일 경로를 지정하면
검사기가 자동으로 읽습니다. 전처리 실행 직후 검사기까지 자동으로 이어 실행하는
통합 명령이나 폴더 감시 기능은 아직 없으며, 두 단계는 별도 명령으로 실행합니다.

## 디렉토리 기준

모든 실행 예시는 프로젝트 루트를 기준으로 합니다.

```text
src/ai_inspection/                           # AI 검사기 코드
docs/ai_inspection/AI_README.md               # 이 문서
결과파일/preprocessing/최종결과/             # 입력: *_ranked.json
결과파일/ai_inspection/                      # 출력: 검사 실행별 디렉토리
  TheInternet.json/                         # 기존 검사 결과 폴더
    inspection_batch.json
    candidate_001_…/
      inspection.json
      initial.png
```

현재 `TheInternet.json`은 확장자처럼 보이지만 **파일이 아니라 결과 폴더**입니다.
`--output-dir`에는 JSON 파일 경로가 아닌 폴더 경로를 지정합니다. 새 결과 폴더는
`TheInternet_plan`처럼 `.json` 없이 이름을 붙여도 됩니다. 기존 폴더는 변경하지 않습니다.

## 전처리 결과를 받아 검사하기

프로젝트 루트에서 이미 생성된 결과를 전달합니다. 다시 크롤링할 필요는 없습니다.
우선 비용 없이 연결만 확인하려면:

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector --input "결과파일\preprocessing\최종결과\TodoMVC_ranked.json" --observe-only --output-dir "결과파일\ai_inspection\TodoMVC_json"
```

API 키를 설정한 뒤 상위 3개 후보의 검사 계획을 만들려면:

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector --input "결과파일\preprocessing\최종결과\TheInternet_ranked.json" --top 3 --output-dir "결과파일\ai_inspection\TheInternet_plan"
```

`--top` 기본값은 **1개**입니다. `priority_score` 내림차순으로 고르며, 같은 점수는
원래 순서를 유지합니다. `--candidate-id 후보ID`를 사용하면 해당 후보 하나만
선택합니다. 후보당 AI 호출은 최대 한 번이며, 상위 N개 선택 시 최대 N번입니다.
빈 후보 목록이면 브라우저를 실행하거나 AI를 호출하지 않습니다. 한 후보가 실패해도
선택한 나머지는 계속 처리하고 전체 요약에 실패를 기록합니다.

지원하는 최소 입력 예시는 다음과 같습니다.

```json
{
  "schema_version": 1,
  "start_url": "http://localhost:3000/",
  "candidates": [
    {
      "id": "todo-input-1",
      "kind": "interaction",
      "selector": "#todo-input",
      "source_pages": ["http://localhost:3000/"],
      "label": "할 일 입력",
      "function_hint": "create",
      "priority_score": 5,
      "priority_reasons": ["사용자 입력 요소"],
      "execution_policy": "review_required",
      "risk_flags": ["unknown_input_effect"]
    }
  ]
}
```

후보 종류는 `interaction` 또는 `endpoint`입니다. ID는 중복되지 않아야 합니다.
화면 요소 후보는 `source_pages`의 같은 출처 페이지에서 `selector`를 찾습니다.
GET 엔드포인트는 실제 URL이 `source_pages`에도 있으면 그 페이지를 우선 열고,
그렇지 않으면 발견 페이지를 관찰합니다. POST나 `{integer}` 같은 URL 패턴은
직접 요청하지 않고 발견 페이지를 엽니다. 따라서 `page_context`는 관련 페이지
관찰을 뜻하며 **해당 API나 엔드포인트를 직접 검사했다는 뜻은 아닙니다**.

후보 선택자와 현재 화면의 요소를 실제 DOM 기준으로 연결하고 그 요소 ID를 AI에
전달합니다. 선택자가 없거나 사라졌거나 여러 요소와 일치하거나 관찰 상한에 포함되지
않으면 AI 호출을 생략하고 `analysis_status: skipped`와 사유를 남깁니다.
선택자가 없는 엔드포인트는 페이지 맥락만 전달합니다. 전체 전처리 JSON 대신 선택
후보의 ID·기능 단서·점수·선정 이유·위험 표시와 제한된 최신 관찰만 AI에 보냅니다.

실행에는 기존 `--execute-checks`가 필요합니다. JSON 후보에 위험 표시가 있거나
`execution_policy`가 `read_only_candidate`가 아니면 계획만 저장하고 실행을 막습니다.
사용자가 위험과 대상 환경을 검토한 경우에만 `--allow-reviewed-actions`를 추가하세요.
이 옵션은 자동 안전성 판정이 아니며, 실제 운영 사이트에 사용하지 않는 것을 권장합니다.

## 실행

프로젝트 루트의 PowerShell에서 실행합니다. 기존 `.venv`와 Playwright를 사용하며
Claude 호출은 Python 표준 라이브러리로 구현해 추가 API SDK 설치가 필요하지 않습니다.
파이프라인과 마찬가지로 설치된 Chrome/Edge 또는 Playwright Chromium을 사용합니다.

브라우저 관찰과 AI 입력 생성부터 확인하려면:

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector https://demo.playwright.dev/todomvc/ --observe-only --output-dir "결과파일\ai_inspection\TodoMVC_observation"
```

Claude로 검사 계획을 생성하려면 로컬 터미널에 API 키를 설정합니다.
아래 예시의 키 문자열은 자신의 키로 바꾸며 결과 파일에는 저장하지 않습니다.

```powershell
$env:ANTHROPIC_API_KEY = "본인의_API_키"
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector https://demo.playwright.dev/todomvc/ --output-dir "결과파일\ai_inspection\TodoMVC_plan"
```

제안된 계획을 실제 실행하려면 `--execute-checks`와 구체적인 검사 작업을 지정합니다.

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector https://demo.playwright.dev/todomvc/ --execute-checks --task "할 일 입력창에 WebTestPilot demo task를 입력하고 Enter를 누르는 검사 하나를 제안하세요. 완료·삭제 동작은 포함하지 마세요." --output-dir "결과파일\ai_inspection\TodoMVC_execution"
```

기본 모델은 Haiku입니다. `--tier sonnet` 또는 `--tier opus`로 명시적으로 바꿀 수
있으며, `--model`로 API 모델 ID를 직접 지정할 수도 있습니다. 고급 모델로의 자동
승격이나 실패 시 재호출은 하지 않습니다. 기본 출력 상한은 `--max-tokens 1600`이며
후보당 Claude API를 최대 한 번 호출합니다(URL 직접 입력도 최대 한 번).
모델 설정은 `src/ai_inspection/claude_client.py`에 있습니다.

## 저장되는 결과

JSON 입력 모드에서는 출력 디렉토리에 `inspection_batch.json`을 저장합니다.
선택 후보 ID·점수·실제 진입 URL·처리 상태·API 호출 수와 개별 결과 경로를 포함합니다.
각 후보는 `candidate_001_…`처럼 별도 하위 디렉토리에 아래 파일을 저장합니다.
개별 `inspection.json`과 실행 기록의 `candidate_id`로 전처리 후보와 연결할 수 있습니다.
진입 URL 결정이나 브라우저 실행 자체가 실패하면 개별 파일 없이 전체 요약에 오류가
남을 수 있습니다. URL 직접 입력 모드는 아래 파일을 출력 디렉토리에 바로 저장합니다.

- `inspection.json`: 초기 관찰, AI 입력, 검사 계획, 실행 기록과 사용 토큰.
- `initial.png`: 초기 페이지 스크린샷.
- `check_1.png` 등: 실행된 각 검사 후 스크린샷.

`analysis_status`는 `not_requested`, `completed`, `error`, `skipped` 중 하나입니다.
`executions[].execution_status`는 계획을 실행했는지 나타내는 `completed` 또는
`error`이며, **웹사이트의 정상·버그 판정은 아닙니다**. `ai_usage.tokens`에는 API가
반환한 토큰 수를 기록합니다. `ai_request_characters`는 입력 JSON의 문자 수이며
토큰 수와는 다릅니다. `--output-dir` 폴더는 자동으로 생성하고 같은 경로로
다시 실행하면 결과 JSON과 같은 이름의 스크린샷을 갱신합니다.

AI에는 페이지 제목, 본문 일부(최대 2,000자), 보이는 조작 요소(최대 40개),
콘솔 오류와 네트워크 메타데이터 일부를 보냅니다. 전체 HTML과 스크린샷 이미지는
AI 입력에 포함하지 않습니다. 따라서 현재 AI의 UI 검사는 요소 정보에 기반한
계획이며, 화면의 시각적 오류를 이미지로 분석하는 기능은 아직 없습니다.

## 계획과 실행 범위

AI 응답은 `page_summary`, `proposed_checks`, `open_questions`로 구성됩니다.
검사에는 ID, 종류(`functional`, `input_validation`, `navigation`, `ui`), 목적과
실행 단계가 있습니다. 판단할 수 없는 기대 동작은 `open_questions`에 남깁니다.
응답은 Claude의 JSON 스키마 출력과 로컬 검증을 거칩니다.

실행기는 관찰된 요소의 ID를 통해서만 `fill`, `click`, `press`를 수행하며
키 입력은 Enter·Tab·Escape로 제한합니다. 계획은 최대 5개 검사·총 10단계입니다.
각 검사는 새 브라우저 세션에서 진입 URL을 열어 시작하므로 필요한 선행 동작은
같은 검사 안의 순서 있는 단계로 표현해야 합니다. 다른 출처로의 최상위 페이지
이동은 차단합니다. 현재 구현은 초기 요소를 대상으로 한 한 번의 계획이며,
행동 후 새 요소를 보고 AI가 다시 계획하는 반복 탐색은 후속 작업입니다.

## 검증

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s src -t . -v
```

실제 브라우저 통합 테스트는 로컬 임시 페이지와 모의 AI 응답으로 입력·클릭·이동·
스크린샷 저장을 확인합니다. 이 테스트에는 Claude API 키나 API 비용이 필요하지 않습니다.

```powershell
$env:WEBTESTPILOT_BROWSER_TESTS = "1"
.\.venv\Scripts\python.exe -m unittest discover -s src -t . -p test_ai_inspector.py -v
```

API 요청 형식과 JSON 출력은 Anthropic의
[Messages API](https://platform.claude.com/docs/en/api/messages/create),
[Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
[모델 목록](https://platform.claude.com/docs/en/models/overview)을 참고했습니다.
실제 Claude 응답은 유효한 API 키와 계정에서 별도로 확인해야 합니다.

현재 전처리 연결은 후보 선택과 검사 맥락 전달입니다. 전처리기가 정한 테스트 항목
On/Off 목록을 강제하는 기능, 버그 판정, 자동 모델 승격, 사용자용 리포트는 아직
구현하지 않았습니다. 이 항목들은 팀에서 입력·출력 규약을 확정한 뒤 확장합니다.
