# 통합 검사 성능 수정·검증 기록

기준일: 2026-10-12. 기준 코드: `integration/`, 실행 파이프라인 `staged/2`.

## 타임리 402 확인과 작성 출처

32토큰의 작은 요청에도 HTTP 402가 반환되었다. 실제 응답에는 `Insufficient credits`, `limit_source: openrouter_credits`가 있었다. 타임리의 상위 OpenRouter 연결 잔액 부족으로 확인했다. 학교 화면의 크레딧과 이 잔액의 관계, 학교 월별 사용 한도는 이 응답만으로 확인되지 않는다.

사용자가 잔액 부족이면 공식 Claude API를 사용하도록 승인하여 `claude-opus-5-5`와 수정안을 의논하고 실제 코드 편집을 생성받았다. 완성된 도구 응답만 적용했으며 출력 한도에서 잘린 응답은 적용하지 않았다. Codex는 두 생성 결과의 도구 이름·시간 집계·검증 코드 연결을 맞췄다.

실제 오류·설계·생성 요청/응답은 Git 제외 `.tools/timely-performance-2026-10-11/`에 있다. API 키는 해당 요청 본문·제품 소스·산출물에 기록하지 않았다.

## 적용한 변경

| 영역 | 현재 처리 |
|---|---|
| 계획 | `qa_test_plan` 호출 한 번에서 페이지 설명·제안·질문·실행 시나리오·미계획 이유 생성 |
| 계획 검증 | 기존 스키마·관측 key/URL·제안 대응·입력 유형·행동 한도 검증 유지. 실패 시 새 수정 요청 최대 1회 |
| 출처 | `scenario_proposals.json`, `test_plan.json`은 같은 실제 응답 ID와 `source_tool`을 공유 |
| 실행 | 저장된 계획을 프로그램이 MCP로 실행. 이 단계에는 모델 호출 없음 |
| 판정 입력 | `judge_input/2`의 `observations[snapshot_id]`에 관찰을 한 번씩 저장. 시나리오는 ID·실행 사실·오류·diff·이미지 연결을 유지 |
| 상세 결과 | 로컬 `scenario_results.json`의 전체 전후 관찰 유지. 판정 맵에는 수집한 이벤트·리소스·이동 사실도 포함 |
| 미실행 | 동작을 한 번도 시도하지 않은 `not_run`은 `program_policy` 출처의 `inconclusive` 상태만 기록 |
| 경량 캡처 | 통합 동작 전후는 반복 raw DOM·inline CSS/JS·full-page PNG 저장 생략. 새 DOM·locator 검증·ID·이벤트·ai_input 유지 |
| UI 증거 | 실제 viewport PNG와 시나리오/snapshot 연결 유지. 최초·독립 전처리 기본 캡처는 전체 저장 |
| 계측 | 단계·모델 호출·MCP·안정화·전후 캡처 시간을 기록. 재현 판정 시간도 포함 |
| 모델 옵션 | `--model-max-tokens`, 공식 Claude 전용 `--model-effort` 추가. 옵션을 생략한 기존 공급자 요청은 유지 |

참조한 snapshot이 없으면 판정 요청 전에 실패한다. 증거를 조용히 자르거나 다른 시나리오의 ID를 수용하지 않는다. 실행 불명확·관찰 누락·정책 차단 가드와 서버 초기화·추가 재현 규칙은 유지한다.

## 저장된 이전 결과의 입력 크기 비교

기존 22 URL 실행 자료 중 `judge_input.json`이 있는 13개 flow를 새 코드로 다시 직렬화했다. 동일한 compact UTF-8 JSON 형식으로 비교했으며 새 API 호출·라이브 재검사는 하지 않았다.

| 지표 | 결과 |
|---|---:|
| 이전 판정 JSON 합계 | 4,153,001 bytes |
| 새 판정 JSON 합계 | 2,409,882 bytes |
| 크기 감소 | **41.97%** |
| AI 판정 대상 | 실제 실행/시도한 시나리오 42개 |
| 프로그램 상태 기록 대상 | 미실행 시나리오 75개 |

모든 참조 snapshot을 포함하는지 검사했다. 이 감소율은 **JSON 바이트 기준**이며 입력 토큰·요금·전체 실행 시간 감소율과 같다고 주장하지 않는다. 원래 34분의 22 URL 검사를 동일 조건으로 다시 돌린 시간 비교는 아직 없다.

수치 자료: [size_comparison.json](../../output/maison-performance-20261012/size_comparison.json).

## 실제 공식 Claude·MCP 연결 확인

대상은 기존 8081의 `/info/shipping-returns` 한 페이지다. `max-pages=1`, `max-actions=4`, `max-runtime=240`, 모델 응답 상한 12000, effort medium을 사용했다.

| 지표 | 실측 |
|---|---:|
| 전체 실행 | 69.688초 |
| 모델 호출 | 2회: 계획 33.249초, 판정 21.222초 |
| 계획 수정 요청 | 0회 |
| 시나리오 | 3개 완료, 미계획 제안 4개 |
| 실제 MCP 동작 | 4개 실행 |
| 캡처 | full 1개, light 9개 |
| PNG | 최초 full-page 1개, 판정 viewport 1개 |
| 입력/출력 토큰 | 98,094 / 4,961 |
| 흐름 상태 | completed, 오류 없음 |
| 페이지 검사 상태 | **not_run**: 미계획 제안이 남아 전체 통과 조건을 만족하지 않음 |

AI는 실행한 시나리오 3개에 passed를 반환했다. 실제 증거 참조·이미지 연결·계획 ID를 검사해 3개 응답을 수용했다. 이는 전체 페이지의 결함이 없다는 증명이 아니다. 이메일 검증 메시지 등 AI 설명에 직접 관찰하지 못했다고 적힌 부분은 별도의 탐지 품질 평가가 필요하다.

산출물: [report.json](../../output/maison-performance-smoke-20261012/report.json), [verification.json](../../output/maison-performance-smoke-20261012/verification.json), [run_summary.json](../../output/maison-performance-smoke-20261012/run_summary.json).

## 회귀 검증

- `python -m integration.test_performance`: 통합 계획·수정 1회 한도·압축 참조·미실행 출처·공급자 옵션 검사 통과.
- `python -m integration.test_staged`: 계획·판정 신뢰 경계, 이미지 수집 실패 이후 중단 검사 통과.
- `python -m integration.test_integration`: 실제 로컬 MCP 정상/결함 실행·UI 이미지·불명확 실행·정책 차단·캡처 실패·취소·재현 및 시간 집계 통과.
- `python -m integration.test_regressions`: 링크 실제 클릭·브라우저 초기화·Maison 시드 초기화·실패한 초기화·HTTP 기한/취소 검사 통과.
- 기존 전처리 pytest: **23개 통과**. 시스템 임시 폴더 권한 오류 후 작업 공간의 새 임시 폴더로 실행했다.

단계 시간에는 모델 호출과 행동 시간이 포함되어 있다. `report.timings.stages`, `model_total_s`, `actions`를 합하면 중복 계산된다. 초기 수집과 이동·종료 시간은 전체 `run_summary.json` 시간과 별도로 비교한다.

## 남아 있는 성능·품질 과제

URL 쿼리·DOM 변화로 element_key가 달라질 때의 대상 재발견, 시나리오별 독립 초기화, 동적으로 드러난 미관찰 요소의 실행 계획은 이번 성능 수정의 후속 과제다. 현재의 중단 가드를 유지하며 공유 초기화 서버의 병렬 실행은 추가하지 않았다. 다음 시간 비교에서는 같은 URL·행동 한도·초기 조건과 완료/미계획 시나리오 수를 함께 확인해야 한다.
