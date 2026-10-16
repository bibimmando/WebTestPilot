# 실행 AI · Playwright MCP 연결 규격

기준일: 2026-10-12 · 파이프라인 `staged/3` · 코드 `executor.py`.

## 1. 실제 흐름

```text
전처리 → 계획 AI → 계획 검증·test_plan.json 저장
                       ↓
실행 AI ← 현재 관찰 / 실제 tool_result
   ↓ tool_use(act/observe/stop_scenario)
Python의 인자·현재 상태 검증 → 기존 Playwright MCP → 브라우저
   ↓
실제 행동·전후 snapshot·diff·이벤트 저장 → 실행 AI에 최신 요약 반환
   ↓ 모든 계획 단계 실행 또는 중단
scenario_results.json → judge_input/2 → 독립 판단 AI
```

MCP 연결과 브라우저 수명은 Python이 관리한다. 실행 AI는 다음 호출을 결정한다. 실행 단계는 앱 verdict를 만들지 않으며 기대 결과는 계획에 고정되어 있다. 판단 AI에는 행동 도구를 제공하지 않는다.

## 2. 계획과 대상 재발견

`test_plan/2`의 scenario_id, family, expected, expected_source, 단계 순서·연산·입력값·URL은 고정한다. 아직 드러나지 않은 대상은 자연어 target_description으로 지정한다.

```json
{
  "steps": [
    {"operation": "click", "element_key": "observed-open-button"},
    {"operation": "fill", "target_description": "앞 단계에서 열린 폼의 이메일 입력창", "value": "invalid"},
    {"operation": "click", "target_description": "같은 폼의 제출 버튼"}
  ]
}
```

처음부터 있는 대상의 key는 최초 관찰과 대조한다. 실제 동작에는 최신 snapshot에서 관측한 key만 사용하고 실행 직전 locator 고유성·가시성·활성 상태를 확인한다. target_description 자체는 selector가 아니며 프로그램이 직접 실행하지 않는다. 실행 AI가 최신 관찰에서 의도한 대상을 선택한다. 암호·파일 입력 및 임의 JS/Python/selector는 지원하지 않는다.

## 3. 실행 도구

한 턴에는 도구 하나만 호출한다. 여러 호출이 나오면 전부 실행하지 않고 각 실제 tool_use ID에 오류 결과를 반환한다.

| 도구 | 입력과 처리 |
|---|---|
| `act` | plan_step_index, purpose, explanation, snapshot_id, operation과 해당 key/value/url. 기존 guarded MCP 브리지 사용 |
| `observe` | include_image, wait_ms(0~3000). 같은 탭의 새 구조화 관찰, 필요하면 실제 viewport PNG |
| `stop_scenario` | 현재 plan_step_index와 reason_code(target_not_found/precondition_unmet/safety_blocked/infra_error). 실행을 incomplete로 기록 |

purpose=planned이면 현재 계획 단계의 연산과 입력값/URL을 그대로 수행한다. purpose=supporting이면 현재 단계를 가능하게 하는 클릭 또는 Escape/Tab만 허용한다. 보조 행동은 계획 단계의 완료 수를 올리지 않는다. execution 모델에는 verdict·expected·계획 변경·finish 도구가 없다.

프로그램은 각 planned 동작이 실제 executed이고 관찰 available이며 정책 차단이 없는 경우에만 다음 계획 단계로 진행한다. 모든 단계가 처리되면 execution_status=completed다. 이는 **검사 절차 실행 완료**이며 앱 정상 판정은 아니다. UI의 0행동 시나리오는 프로그램이 실제 이미지를 수집하며 실행 모델 호출을 생략한다.

## 4. 모델 대화와 증거

첫 입력은 execution_input/1이며 동결된 시나리오, current_step_index, 현재 관찰, 권한과 남은 한도를 포함한다. 실제 assistant tool_use 뒤에 같은 ID의 user tool_result를 연결한다. 다음 호출은 그 대화를 이어가며 계획/판정은 별도 새 대화를 사용한다.

실행 AI에 보내는 current에는 snapshot_id, URL, 컨트롤 key·역할·이름·상태, 링크·폼·오류·품질 및 짧은 본문을 넣는다. 컨트롤 문자열 상한은 160자, 본문은 1500자이며 executor_omitted에 축약을 표시한다. 원본 snapshot/ai_input과 실제 실행 결과는 로컬에 유지한다. include_image는 실제 PNG 바이트를 모델에 전달하며 JSON 경로만으로 이미지를 봤다고 간주하지 않는다.

| 파일/필드 | 의미 |
|---|---|
| `execution-<scenario_id>-<turn>_request/response.json` | 실행 턴의 실제 대화·시스템 지시·도구 규격·응답 |
| `messages.json` | 단계별 대화. 실제 도구 ID/결과의 연결과 거절 내역 |
| `execution_results.jsonl` | MCP 요청·응답과 실제 행동/관찰 증거. tool_use_id는 실행 AI의 실제 ID |
| `scenario_results/2` | 실제 행동 목록과 계획 진척. 중단·취소 때에도 부분 결과 저장 |
| `steps[].step_index` | 실제 행동 시도 순서. 보조·교정 포함 |
| `steps[].plan_step_index`, `purpose` | 동결된 계획의 어느 단계를 수행하거나 보조했는지 |
| `attempted_step_count` | 실제 행동 시도 수. 보조·실패·교정 포함 |
| `attempted_plan_step_count` | 한 번 이상 시도한 계획 단계 수 |
| `completed_plan_step_count` | 성공 실행·관찰 확보된 계획 단계 수 |
| `executed_action_count` | 실제 executed 행동 수. 보조 행동 포함 |
| `skipped_step_count` | 한 번도 시도하지 않은 계획 단계 수 |
| `planned_steps` | 동결된 계획 단계 원본 |

판정 입력 judge_input/2의 필수 구조와 verdict 도구는 유지한다. 위 필드는 선택 추가 필드로 전달하며 실행 AI의 explanation은 판정 근거로 전달하지 않는다. 실제 before/after 관찰·diff·행동 인자는 유지한다. 최종 판정 모델은 [판정 AI 연결 규격](JUDGMENT_CONTRACT.md)을 따른다.

## 5. 한도·실패·재현

- 계획·실행·판정은 전체 max_calls와 페이지 max_rounds를 공유한다. 실행 루프가 판정 호출 1회분을 남긴다. 전체 시간 제한은 기존 crawl의 max_runtime이다.
- 현재 계획 단계의 보조 행동은 최대 3회, 연속 관찰은 최대 3회, 거절/교정은 시나리오당 최대 2회다. 행동 시도·교정·재현은 max_actions를 공유한다.
- 확실한 not_executed에만 기존 correction_of 교정 1회를 허용한다. unknown, 실행 후 관찰 실패, 정책 차단에는 행동을 반복하지 않는다.
- 미완료 시나리오는 incomplete이며 이후 시나리오는 not_run으로 기록한다. 공급자 오류·응답 잘림을 자동 재시도하지 않는다. 한도와 공급자 오류에도 부분 산출물을 저장하고 가능한 경우 예약한 독립 판정을 수행한다.
- 취소는 부분 실행 기록과 실제 도구 결과를 저장한 뒤 전파하며 판단 모델을 호출하지 않는다.
- 재현은 승인된 초기 조건에서 **실제로 기록된 planned/supporting 행동**을 프로그램이 재실행한다. 새 실행 모델은 호출하지 않고 재현 판단 모델만 사용한다. 재현 시 대상 key/locator가 다시 확인되지 않으면 미완료로 남긴다. 범용 지문 기반 재현 대상 매칭은 후속 범위다.

## 6. 모델 설정과 검증

공식 Claude 예시:

```powershell
python -m integration --url http://localhost:8081/ --provider anthropic --model claude-opus-5-5 --execution-model claude-sonnet-5-5 --judgment-model claude-sonnet-5-5 --model-max-tokens 12000 --model-effort medium --max-rounds 24 --output output/agent-run
```

공식 Claude의 실행·판정 기본은 Sonnet 5.5다. 타임리는 기존 계획 모델을 기본으로 재사용하며 계정에서 사용 가능한 단계별 모델 ID를 옵션으로 지정한다. 재현 판정도 judgment-model을 사용한다. report.json의 usage에는 stage, 실제 모델 ID, 토큰과 시간이 기록된다.

`python -m integration.test_executor`는 실제 localhost 사이트와 실제 Playwright MCP에 가짜 모델 응답을 연결한다. 새 컨트롤 재발견, 보조 모달 닫기, stale snapshot 거절, 교정, 단계/연산 변경 거절, 허위 finish, 다중 호출 거절, 반복 관찰·예산 상한, 모델 오류·취소의 부분 기록, 동적 행동 재현과 독립 판단을 검증한다. 가짜 모델의 테스트 통과는 실제 Sonnet의 수행 품질을 입증하지 않는다.

## 7. 설계 상담 출처

사용자 요청에 따라 공식 Claude Opus 5.5에는 수정 계획·구현 지침만 요청했고 Codex가 코드를 작성했다. 반환 모델은 claude-opus-5-5, 입력 1492·출력 3187 토큰, stop_reason=tool_use였다. 저장소 원문 전송은 자동 승인 검토가 거절하여 API에는 일반 구조·요구사항 요약만 보냈다. 요청/응답은 Git 제외 `.tools/execution-agent-20261012/`에 있다.

Opus가 제안한 별도 step_done/finish 대신, 실제 성공한 planned 행동의 개수로 진척을 계산한다. 이는 추가 완료 주장·호출을 줄이면서 계획 건너뛰기를 프로그램에서 막기 위한 선택이다.
