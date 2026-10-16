# member-02 판정 모듈 연결

기준일: 2026-10-13. integration의 judgment 단계에 독립 판정 패키지를 연결했습니다.
전체 단계·산출물·판정 계약은 [README](../README.md), [JUDGMENT_CONTRACT](JUDGMENT_CONTRACT.md)를 참고하세요.

## 책임

계획 AI가 test_plan/2를 생성하고 실행 AI·Python·Playwright MCP가 실제 행동·전후 증거를 기록합니다.
이후 judge_input/2를 우리 판정 모듈에 전달합니다. 판정 모듈은 고정 기대값과 실제 증거만 비교합니다.
passed/candidate/inconclusive를 반환하며 MCP 추가 행동이나 재현을 실행하지 않습니다.
재현·reproduction_verdict·confirmed·report 집계는 기존 통합 코드에서 유지합니다.

## 코드 연결

```text
staged.inspect_page: judge_input 생성
 → judgment_bridge.run_judgment
 → judgment.async_adapter.judge_async
 → 기존 staged._call / _exchange / models.complete
 → 우리 응답 검증 + 기존 _check_judgments
 → 기존 judgments/findings/reproduction/report
```

새 파일은 judgment_bridge.py·judgment/·test/의 판정 연결 테스트와 데모입니다.
기존 파일은 staged.py의 판정 요청·검증 구간만 변경했습니다. 계획·행동·모델 전송 함수를 대체하지 않았습니다.
새 API 키·새 공급자 클라이언트를 만들지 않습니다. 기존 호출 한도·라운드·취소·사용량·시간 계측을 이용합니다.
응답 검증에 실패해도 수신한 tool_use_id를 오류 결과에 유지합니다. 입력 불일치는 호출 전에 거절합니다.

## 원본과 동기화

판정 구현 원본은 개발 워크스페이스의 src/ai_inspection/judgment/입니다.
제품은 integration.judgment를 import하며 원본 워크스페이스나 다른 팀 패키지 import에 의존하지 않습니다.
개발 워크스페이스의 scripts/sync_judgment_integration.py --apply로 원본 변경을 반영합니다.
source_manifest.json은 복사된 파일별 SHA-256을 기록합니다. 테스트·캐시는 복사하지 않습니다.
배포본을 직접 편집하지 말고 원본을 변경한 뒤 다시 반영하세요. 삭제는 스크립트가 자동 수행하지 않습니다.

## 판정·이미지 검증

시나리오별 정확히 하나의 응답, 시나리오 소유 snapshot/action ID, 비어 있지 않은 snapshot 인용을 요구합니다.
완료되지 않거나 정책 차단된 시나리오의 passed/candidate는 거절합니다.
추가 규칙으로 확정적 판정에 인용한 행동의 전후 snapshot을 모두 인용해야 합니다.
UI는 runtime.output 내부에서 읽은 실제 이미지가 모델에 첨부된 경우에만 확정적 판정을 수용합니다.
이미지 누락·루트 외부 경로·크기 제한을 image_availability에 표시합니다.
요청은 시나리오·observations·image_availability와 실제 이미지 블록으로 구성하며 기록 시 base64는 기존 관리자가 생략합니다.
스키마 검증만으로 판정 문장의 사실 정확성은 보장되지 않습니다. 실제 모델 평가는 후속입니다.

## 테스트

member-01에서 기존 의존성·Node·MCP·Chromium을 준비한 뒤 실행합니다.

```powershell
$env:PYTHONUTF8 = "1"
python -m unittest integration.test.test_judgment_bridge -v
python -m integration.test_staged
python -m integration.test_executor
python -m integration.test_integration
python -m integration.test_form_evidence
python -m integration.test_performance
python -m integration.test_regressions
```

새 테스트는 구현 옆이 아닌 integration/test/에 있습니다. 기존 테스트 위치는 바꾸지 않았습니다.
호출 한도·라운드 한도·새 대화·tool_use_id·사용량·취소·타 시나리오 증거·UI/정책 차단을 모의 검증합니다.
로컬 MCP 테스트에서는 정상·결함·보조/교정 행동·재현·unknown·관찰 실패를 검사합니다.
기존 테스트 일부의 Windows 기본 인코딩 문제를 피하도록 PYTHONUTF8=1을 설정합니다.

## 보관 가능한 로컬 데모

```powershell
python -m integration.test.generate_judgment_demo --output output/judgment-connected-demo
```

새 폴더를 지정해야 합니다. localhost의 normal/broken 카운터와 실제 MCP·브라우저를 사용하며 모델은 모의 응답입니다.
결과는 output/judgment-connected-demo/{normal,broken}/에 남습니다.
각 flows/<flow_id>/의 test_plan → execution_results → judge_input → judgments → findings 순으로 확인하세요.
정상은 passed, 결함은 candidate와 기존 재현 흐름을 확인합니다. 고정 응답이므로 실제 AI 탐지 정확도 측정은 아닙니다.
실제 외부 대상 검사·유료 모델 호출·PDF 완성은 이번 검증 범위에 포함하지 않았습니다.
