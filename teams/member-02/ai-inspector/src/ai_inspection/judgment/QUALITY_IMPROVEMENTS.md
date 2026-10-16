# 판정 품질 보완 코드 안내

기준일: 2026-10-15.
전체 변경은 [검사 품질 보완 문서](../../../docs/ai_inspection/INSPECTION_QUALITY_IMPROVEMENTS_2026-10-15.md)에 기록했습니다.

```text
judge_async(..., structured=True)
 → 입력 검증
 → prepare_request(..., structured=True)
 → 기존 통합 모델 호출 (내부 도구 응답에 assessment 포함)
 → assessment.review_response()
 → response_contract.validate_response()
 → 팀 계약의 다섯 필드만 반환
```

`assessment.py`는 조건별 met/unmet/unknown, 근거 지원 여부와 검사 목적 확인 여부를 검토합니다.
일부만 충족한 passed와 위반 근거 없는 candidate는 inconclusive로 낮춥니다.
버그 후보로 올리거나 confirmed를 생성하지 않습니다. 조건 자체의 의미 정확도는 모델 평가가 필요합니다.

`prompts.py`에는 조건 전체 비교, 실제 업무 결과 확인, 인용한 행동의 전후 ID 모두 포함하는 규칙이 있습니다.
기존 팀 입력·응답 스키마와 합성 예시는 변경하지 않았습니다. 기본 오프라인 인터페이스는 이전 계약을 지원합니다.
실제 통합 CLI의 bridge는 structured 모드를 활성화하며 조건 검토를 별도 JSON에 저장합니다.

새 테스트는 기존 분류를 유지해 `src/ai_inspection/test/test_judgment_assessment.py`에 있습니다.
fixtures/f4_saved_partial_pass.json은 실제 누락 기록과 테스트용 고정 검토이며 새로운 유료 AI 결과가 아닙니다.

```powershell
.\.venv\Scripts\python.exe -m unittest src.ai_inspection.test.test_judgment_assessment -v
```

공통 계획·실행·UI 재현 보완은 통합 코드 `inspection_quality.py`, `target_refresh.py`, `reproduction.py`에 있습니다.
기존 Maison 결과를 수정하지 않았습니다. 이후 Sonnet 재검사에서 F4·U5 두 종류를 탐지·재현했으며,
[실제 결과와 이전 비교](../../../docs/ai_inspection/SONNET_REINSPECTION_COMPARISON_2026-10-15.md)에 기록했습니다.
이는 한 번의 비교 실행이며, 일반적인 판정 정확도를 보증하지 않습니다.
