# WebTestPilot AI 검사 프로토타입

현재 기본 흐름은 **팀원 크롤러 → hybrid_ai_input.jsonl → 요청 준비 또는 Claude 분석**입니다.
크롤러가 수집한 증거를 재사용하고, 작업 종류에 따라 증거 검토와 추가 검사 계획을
구분합니다. 준비 모드는 API를 호출하지 않고, `--analyze`를 선택하면 유료 Claude API를 호출합니다.
구조화된 행동 선택·실행 관리자·MCP 호출 어댑터·기존 탭 관찰기를 추가했습니다.
새 `--execute` 모드는 실제 공통 탭과 MCP 세션을 제공하는 연결 모듈이 필요합니다.
실제 서버 연결·자동 추가 재현·최종 PDF는 아직 후속 작업입니다.
기존 URL 직접 검사·우선순위 JSON 검사는 제거했습니다.

## 디렉토리

```text
../../../webtestpilot-crawler/   # 팀원 크롤러 원본
src/ai_inspection/                          # JSONL 입력·Claude 분석·실행 관리자·MCP 어댑터
docs/ai_inspection/AI_README.md              # 팀원 공유용 흐름·역할·현재 상태
docs/ai_inspection/AI_ANALYSIS_IMPLEMENTATION.md # 개발자용 상세 구조·규격·연결 방법
결과파일/ex_crawler/crawl-results/           # 팀원 크롤러의 현재 출력
결과파일/ai_inspection/                     # 요청 준비 및 검사 결과
src/preprocessing/                         # 이전 전처리 코드(현재 AI 흐름에서 미사용)
docs/preprocessing/                        # 이전 전처리 참고 문서
```

팀원 크롤러 자체의 설치·실행·안전 정책은
[크롤러 README](../../../webtestpilot-crawler/README.md)를 참고합니다.
팀원 크롤러 코드를 우리 검사기에 통째로 가져오지 않고 출력 파일로 연결합니다.
기존 전처리 코드와 저장된 결과는 이번 변경에서 삭제하지 않았습니다.

## JSONL 요청 준비

Claude API 키의 로컬 설정은 루트의 `.env`에 입력합니다. 빈 `.env.example`은 공유용,
실제 `.env`는 Git 제외 대상입니다. API 기반 코드는 기존 환경변수를 우선합니다.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-ai.txt
.\.venv\Scripts\python.exe -m src.ai_inspection.env_config
```

두 번째 명령은 키 값 없이 설정 여부만 확인하며 API를 호출하지 않습니다.
키를 입력해도 아래 준비 모드가 실제 분석을 수행하지는 않습니다.

프로젝트 루트에서 실행합니다. API 키와 Playwright 설치가 필요하지 않습니다.

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector --hybrid-input "결과파일\ex_crawler\crawl-results\hybrid_ai_input.jsonl" --prepare-only --limit 1 --output-dir "결과파일\ai_inspection\hybrid_prepare"
```

기본 상한은 1개이며 입력 순서를 유지합니다. `--limit 14`는 최대 14개를 준비합니다.
출력은 `evidence_batch.json`, `ai_requests.jsonl`, `ai_results.jsonl`입니다.
같은 출력 디렉토리는 갱신됩니다. 원본 입력은 변경하지 않습니다.
자동 추가 재현·최종 PDF는 후속 단계입니다. 준비 모드에서는 실행 관리자를 호출하지 않습니다.

## 실제 Claude 분석

루트 `.env`에 키를 입력하고, 외부 API로 전달할 증거를 확인한 뒤 실행합니다.
아래 명령은 **최대 1개 항목에 대해 유료 API를 호출**합니다. 2026-10-09 Maison 증거 분석 1건의 실제 호출 성공을 확인했습니다.
이 모드는 크롤러가 저장한 증거를 분석하며 사이트 접속·새 증거 수집·추가 검사 실행은 하지 않습니다.

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.ai_inspector --hybrid-input "결과파일\ex_crawler\crawl-results\hybrid_ai_input.jsonl" --analyze --tier haiku --limit 1 --max-tokens 1600 --output-dir "결과파일\ai_inspection\hybrid_analysis"
```

분석 응답과 반환된 사용 토큰을 결과에 저장합니다. 출력 토큰 제한은 입력 토큰이나
전체 금액 상한이 아닙니다. 자동 재시도·모델 승격·이미 분석한 항목 자동 생략은 없습니다.

팀원 공유용 흐름·현재 상태는 [AI_README.md](docs/ai_inspection/AI_README.md)에 있습니다.
개발자용 상세 규약·팀 간 연결·오류 처리·검증 범위는
[AI_ANALYSIS_IMPLEMENTATION.md](docs/ai_inspection/AI_ANALYSIS_IMPLEMENTATION.md)에 정리했습니다.
`claude_client.py`의 증거 분석은 실제 서비스 응답 1건을 확인했습니다. 새 실행 모드의 실제 모델·MCP 통합은 후속 작업입니다.
`browser_runner.py`의 기존 독립 실행기는 유지하며, 새 관찰기는 이미 열린 탭을 사용합니다.
`inspection_runtime.py`는 등록된 검사·행동·관찰·판정을 조율하고 결과 JSON을 저장합니다.
`mcp_executor.py`는 기존 MCP 세션의 호출을 주입받으며 서버를 자체 실행하지 않습니다.
`--execute --runtime-factory module:function`의 실제 연결 모듈은 다음 통합 작업에서 구현해야 합니다.
AI 패키지에 이전 크롤러 코드 의존성은 없습니다.

## 테스트

AI 검사기 테스트는 구현과 분리하여 `src/ai_inspection/test/`에 보관합니다.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection/test -t . -v
```

기본 테스트는 유료 API를 호출하지 않습니다. 추가 검증 실행기의 실제 브라우저
테스트는 AI_README의 별도 명령을 사용합니다.
