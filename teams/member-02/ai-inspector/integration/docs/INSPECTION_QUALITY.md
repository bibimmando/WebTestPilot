# 검사 품질 보완 연결 안내 — 2026-10-15

## 코드

- inspection_quality.py: 일반적인 결과 검증 계획 지침, 같은 run의 공통 폼 검사 기록, 초기 UI 우선, 단계별 coverage.
- target_refresh.py: 현재 관찰의 role/name으로 유일한 요소만 재검증. 링크 href 불일치·중복 대상 거절.
- judgment/assessment.py: 내부 구조화된 검토, 부분 충족 통과 보류. 최종 외부 응답은 기존 다섯 필드 유지.
- judgment_bridge.py: 기존 호출 관리·도구 ID·사용량 유지, judgment_assessment.json 저장.
- reproduction.py: 초기 UI 후보의 실제 원본·재현 이미지 전달, 조건 검증 후 추가 1회 재현.

CLI는 활성화된 상태입니다. Runtime을 직접 생성할 때는 quality_checks=True를 지정합니다.
계약 스키마는 유지하며 내부 모델 응답에만 assessment를 요구합니다.
새 내부 응답을 반환하지 않는 기존 모델 어댑터는 개선 경로에서 거절되므로 어댑터를 함께 검토해야 합니다.
판정·복원·이미지 근거 부족을 확정으로 바꾸지 않습니다. 브라우저 복원 정책은 서버 상태 복원이 아닙니다.

## 테스트

teams/member-01에서, 프로젝트 가상환경 Python을 사용합니다.

```powershell
$env:PYTHONUTF8 = "1"
python -m unittest discover -s integration/test -t . -v
python -m integration.test_staged
python -m integration.test_executor
python -m integration.test_regressions
python -m integration.test.generate_quality_demo --output output/quality-demo-new
```

출력 폴더는 새 폴더 또는 비어 있는 폴더여야 합니다.
데모는 실제 localhost Playwright MCP, 고정한 모델 응답을 사용하며 유료 API는 호출하지 않습니다.
정상/결함 카운터, UI 이미지 재현, 정상/거짓 성공 장바구니를 확인합니다.
실제 모델의 탐지율이 개선됐다는 검증과 구분합니다.

원본 개발 폴더의 docs/ai_inspection/INSPECTION_QUALITY_IMPROVEMENTS_2026-10-15.md에 배경·현재 한계·전체 검증을 기록했습니다.
