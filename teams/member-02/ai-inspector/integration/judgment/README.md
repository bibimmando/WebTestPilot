# 판정 모듈

기준일: 2026-10-13. 실행 후 전처리팀의 judge_input/2를 받아 scenario_judgments 응답을 검증하는 독립 모듈입니다.
기준 커밋은 ab5d8f07d7274e3feaf268c6ebe3ef50e6f617d5이며 고정 스키마·합성 예시를 포함합니다.

## 파일 구성

| 파일·폴더 | 역할 |
|---|---|
| input_contract.py | 입력 구조·전후 관찰 참조 검증 |
| prompts.py | 독립 판정 프롬프트 |
| images.py | 명시적 실행 루트의 실제 PNG/JPEG 첨부 |
| response_contract.py | 응답 구조·시나리오·증거·실행 상태 검증 |
| assessment.py | 구조화된 조건 검토와 부분 충족 통과의 보류 |
| judge.py | 모델 주입·요청 구성·오프라인 CLI·출력 저장 |
| async_adapter.py | 기존 통합 비동기 호출과 연결, 실제 도구 ID 보존 |
| schemas/ | 전달 계약의 입력·응답 JSON Schema |
| examples/ | 실제 검사 결과가 아닌 네 시나리오 합성 예시 |
| test/ | 별도 테스트 패키지 |

## 오프라인 확인

프로젝트 루트에서 실행합니다. API 키·브라우저가 필요하지 않습니다.

```powershell
.\.venv\Scripts\python.exe -m src.ai_inspection.judgment.judge --input "src/ai_inspection/judgment/examples/judge_input.v2.example.json" --mock-response "src/ai_inspection/judgment/examples/scenario_judgments.example.json" --output-dir "결과파일/ai_inspection/judgment/synthetic_contract"
.\.venv\Scripts\python.exe -m unittest discover -s src/ai_inspection/judgment/test -t . -v
```

--prepare-only는 요청 준비만 수행합니다. 실제 이미지를 포함하려면 --run-root로 실행 산출물 루트를 명시합니다.
출력은 judgment_request.json·judgment_response.json·judgment_run.json입니다.
저장 요청의 image_reference는 보관용이며 모델에 전달할 실제 image 블록과 다릅니다.

## 통합 인터페이스

```python
from src.ai_inspection.judgment.judge import judge
reply = judge(payload, model=model_adapter, run_root=execution_output_root)
```

model_adapter(request)는 기존 공통 모델 계층을 호출하고 scenario_judgments 도구의 input dict를 반환해야 합니다.
실제 tool_use ID·한도·기한·취소·사용량은 통합 계층에서 유지합니다.
별도 worktree의 integration/judgment_bridge.py와 staged.py에 비동기 연결을 구현했습니다.
제품은 integration.judgment를 import하며 로컬 원본은 scripts/sync_judgment_integration.py로 반영합니다.
모듈 자체는 모델 공급자·API 키·MCP·추가 행동·재현을 생성하지 않습니다.
passed/candidate에서 인용한 행동의 전후 snapshot을 모두 인용하도록 하는 추가 검증 규칙이 있습니다.
의미 정확도는 구조 검사만으로 보장하지 않으며 UI 이미지가 없으면 시각적 conclusive 판정을 거절합니다.

모의 모델·실제 localhost MCP로 증거 → 판정 검증 → 재현·보고서 JSON 연결을 검증했습니다.
검증된 합성 응답이 실제 AI 판정 성능을 의미하지 않습니다. 유료 모델·외부 사이트는 호출하지 않았습니다.
새 판정 요청 JSON의 첫 text 블록은 기존 통합과 호환되도록 scenarios·observations를 최상위에 유지하고 image_availability를 추가합니다.
처음 보는 개발자는 [전체 흐름·두 폴더·실행 안내](../../../docs/ai_inspection/PROJECT_PIPELINE_GUIDE.md)부터 읽으세요.
상세 규격·출력·통합 주의점은 [판정 개발 문서](../../../docs/ai_inspection/AI_JUDGMENT_MODULE.md)를 참고하세요.

## 2026-10-15 품질 보완

위 유료 호출 없는 검증 설명은 초기 모듈 연결 기록입니다.
이후 실제 사이트 검사는 docs의 10월 14일 회의 자료, 새 품질 보완은 [QUALITY_IMPROVEMENTS.md](QUALITY_IMPROVEMENTS.md)를 참고합니다.
통합 CLI는 structured 판정 검토를 사용하고 최종 팀 응답 형식은 유지합니다.
기존 독립 오프라인 인터페이스의 기본 호출은 이전 계약을 지원합니다.
