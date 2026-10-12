# 전체 흐름과 보고서 전달 경계

2026-10-12. 사용자 제공 `WebTestPilot_JSON_연결규격_초안.md` v0.2와 `WebTestPilot_프로젝트_방향성_공유본.md` v1.0을 참고한 보고서 프로토타입 설계입니다.
문서의 계획·책임 배분은 참고 자료이며 구현 완료를 뜻하지 않습니다. 외부 원본 문서와 기존 검사기 계약은 변경하지 않았습니다.

## 목표 흐름과 현재 구현 구분

```text
URL·허용 범위·초기 상태 준비
  → 탐색·전처리 관찰 (기존 ai_input/1, snapshot, action)
  → AI 검사 입력 조립 (사이트 문맥 + 현재 관찰 + 짧은 흐름 이력)
  → 모델 행동 선택 → 권한·대상·한도 검증 → 같은 탭에서 실행
  → 새 관찰·실제 행동·증거 저장 → 다음 검사 반복
  → 후보 판정·가능한 추가 1회 재현 → 실행 종료/부분 종료
  → [후속: 실행 전체 자료 조립기]
       검사 범위 + 판정 + 재현 + 종료 상태 + 증거 인덱스
  → wtp.report_input/0.1 JSON 1개 + 검토된 증거 폴더
  → [이번 구현] 규격·참조 검증 → 비밀값 제외 → 코드 집계 → 단일 PDF
```

현재 저장소의 AI 검사기는 hybrid JSONL 준비·분석과 주입식 실행 관리자를 제공합니다.
`inspection_run.json`의 actions/judgments는 유용한 원본이나 보고서용 계약과 동일하지 않습니다.
최종 판정·실제 자동 재현·생산자 어댑터는 이번 변경에 포함되지 않았습니다. 이 프로토타입은 합성 입력으로 독립 실행합니다.
기존 `completed` 행동을 검사 통과로, `candidate`를 확정 결함으로, `not_attempted`를 재현 성공으로 바꾸지 않습니다.

## 왜 보고서 직전에 자료 조립 단계가 필요한가

검사 중 메시지는 특정 관찰이나 행동 하나의 문맥입니다. 보고서는 전체 실행 범위, 미완료 검사,
최초 발견 당시의 실제 행동·입력값, 기대 근거, 추가 재현, 종료 이유를 함께 필요로 합니다.
보고서 직전에 이를 **기존 기록에서 모아야 하며**, 보고서가 사이트에 다시 접속해 빈 자료를 채우는 방식은 아닙니다.
시작 조건·입력값·전후 화면 등 나중에 복구할 수 없는 자료는 검사 당시 수집해야 합니다.

| 필요한 자료 | 기록 시점·생산자 | 보고서 필드 |
|---|---|---|
| 실행 ID·URL·시작/종료 시각·종료 이유 | 실행 관리자, 시작/종료 시 | run |
| 검사 페이지·항목·브라우저·화면 크기 | 실행 관리자·전처리, 검사 시 | checks, environment |
| 미완료 검사와 사유 | 실행 관리자, 중지·한도·실패 시 | checks.status/reason |
| 문제 ID·페이지·제목·범주·판정 | 판정 저장 단계 | findings |
| 기대 동작·근거·근거 참조·실제 결과 | 문맥 조립 및 판정, 관찰 시 | findings.expected/actual |
| 시작 조건·실제 행동 순서·안전한 입력값 | 실행·증거 기록기, 행동 시 | preconditions, action_ids, actions.inputs |
| 추가 재현 시도·결과·미실행/실패 사유 | 재현 관리자 | reproduction |
| 파일·문제/행동 연결·최초/재현 구분 | 증거 기록기 및 공유용 자료 조립기 | evidence |
| 미확인 사유 | 각 생산자, 최종 조립기가 취합 | unknown_reasons |

## 전달 규칙 (보고서 전용 초안)

`schema_version`은 `wtp.report_input/0.1`입니다. 기존 `wtp.inspection_input/0.1`, `wtp.execution_result/0.1`,
`wtp.finding/0.1`, `ai_input/1`을 대체하거나 직접 소비하지 않습니다. `report-input.schema.json`이 실제 검증 형식입니다.
구조 필수·상세 nullable 정책으로 아직 없는 판정 기능을 가짜 값으로 채우지 않고도 테스트할 수 있습니다.

| 묶음 | 최소 내용 |
|---|---|
| run | run_id, site_url, started_at, ended_at, termination_reason |
| environment | browser, viewport (상태별 조건은 검사 설명/문제 시작 조건에도 기록) |
| checks[] | check_id, page_url, item, status, reason, action_ids |
| actions[] | action_id, description, execution, inputs[{name,value,sensitive}] |
| findings[] | finding_id, page_url, title, category, status, reason, expected, actual, preconditions, action_ids, reproduction |
| expected | statement, source, source_ref |
| reproduction | status, reason, action_ids (최초 발견과 별도 행동 ID) |
| evidence[] | evidence_id, kind, path, finding_ids, action_ids, phase, share_safe, reason |
| unknown_reasons | JSON Pointer → 사유. 예: `/findings/0/expected/source_ref` |
| synthetic | 합성 입력 여부. true이면 표지·모든 페이지 footer에 합성 표시 |

시간은 시간대가 있는 ISO 8601 문자열로 생산합니다. 예: `2026-10-12T14:00:00+09:00`.
발생 당시 브라우저·화면 조건은 손실 없이 설명에 포함해야 합니다. 여러 환경을 구조적으로 연결하는 환경 ID는 후속 규격 협의 대상입니다.
`action_ids` 배열 순서가 실제 행동 순서입니다. `execution`은 executed/not_executed/unknown으로 기능 성공과 구별합니다.
최초 발견과 재현의 증거는 같은 파일을 덮어쓰지 않고 별도로 전달합니다.

판정 상태는 confirmed/candidate/review_required/incomplete/false_positive/unknown입니다.
확인 상태는 기대 동작·근거·실제 결과·추가 재현 기록이 있어야 입력 검증을 통과합니다.
이는 형식상 근거 존재 검사이며 판정의 사실성 검증이나 새 버그 판정이 아닙니다.
추가 재현 상태는 reproduced/not_reproduced/failed/not_run/unknown입니다.
재현된 상태는 별도의 실행된 행동 기록이 필요하며, 재현 실패는 최초 후보를 지우거나 오탐으로 바꾸지 않습니다.

스크린샷·로그 path는 증거 묶음 내부 상대 경로입니다. `share_safe`는 생산자가 공유용 비밀값 검토를 완료했다는 선언입니다.
화면 속 비밀값은 JSON 텍스트 마스킹으로 제거되지 않습니다. 미검토 파일은 경로·사유만 표시하고 내용을 포함하지 않습니다.

## 이후 연결 작업

### 재현 방법 필수 검수 기준

문제마다 PDF의 재현 방법 구역은 항상 존재해야 합니다. 시작 페이지·환경·시작 조건과 순서가 있는 실제 행동·입력값,
기대 결과·최초 관찰 결과를 함께 표시합니다. 별도의 추가 재현을 수행하지 않아도 최초 발견 절차는 제공해야 합니다.
누락 시 사실을 만들어 채우지 않고 보완 필요로 표시해 부분 보고서를 보존합니다.
confirmed 판정은 시작 조건·최초 행동 설명·실행 기록이 없으면 거부합니다.
not_run 추가 재현에 행동 기록이 붙은 모순된 입력도 거부합니다.
이 검증은 절차 기록의 존재를 확인하며 사람이 독립적으로 재현할 수 있음을 보장하지 않습니다.

1. 실제 실행 관리자의 시작·종료·범위·미완료 기록을 이 계약으로 매핑한다.
2. 판정 저장기와 재현 관리자가 생성한 실제 ID·근거·행동·증거를 참조 검증 후 조립한다.
3. 실제 실행 1건으로 누락·중지·재현 실패를 포함한 생산자/소비자 계약 검증을 수행한다.
4. 저장된 JSON과 증거를 내려받고, 동일 자료로 보고서만 재생성하는 웹 기능을 연결한다.
5. 필요하면 보고서 AI 문장화 단계를 추가하되 수치·판정·재현 결과는 기록과 코드 집계를 유지한다.

이 경계가 연결되기 전까지 end-to-end 검사·최종 보고서 연동 완료로 표시하지 않습니다.
