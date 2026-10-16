# member-02 독립 통합 실행 사본

2026-10-16: 이 코드는 member-01 통합 코드의 로컬 보완판을 member-02 안에서 독립 실행하도록 묶은 사본입니다. 설치·실행은 [상위 REPRODUCE.md](../REPRODUCE.md)를 따릅니다. 아래 문서는 upstream 개발 기준과 기존 인터페이스의 이력입니다. 현재 실행 디렉토리는 teams/member-02/ai-inspector이며 다른 팀 코드를 import하지 않습니다.

기준일: 2026-10-12. 현재 프로그램은 `teams/member-01/integration/` 한 곳에서 개발한다. [개발 기준](DEVELOPMENT.md)과 [전처리 입력·증거 규격](docs/AI_INPUT_CONTRACT.md)을 함께 참고한다.

AI팀의 판단 코드 연결은 [판정 AI 연결 규격](docs/JUDGMENT_CONTRACT.md)을 기준으로 한다. 현재 `judge_input/2` 입력·응답 schema와 네 유형의 합성 예시를 함께 제공한다. 실행 AI는 [실행 에이전트 규격](docs/EXECUTION_AGENT.md)을 참고한다.

2026-10-13 member-02 판정 패키지를 judgment 단계에 연결했다. 기존 모델 호출·한도·사용량·재현을 유지한다.
[연결 코드·새 테스트·로컬 데모 안내](docs/JUDGMENT_MODULE_CONNECTION.md)를 참고한다. 실제 모델 정확도는 후속 검증 대상이다.

```text
URL FIFO → 전처리(ai_input/1)
             ↓
시나리오 제안·실행 계획 AI (한 번 호출) → 계획 검증·저장
                                      ↓
             실행 AI ↔ Python·Playwright MCP·전후 증거 수집
                                      ↓
                        결과 후처리 → 판단 AI
                                      ↓
                    후보 추가 재현 → 보고서 → 다음 URL
```

제안과 실행 계획은 `qa_test_plan` 응답 한 번으로 생성한다. 실행 AI는 최신 관찰을 받고 `act/observe/stop_scenario`를 선택하며 Python이 실제 MCP 요청과 수집을 처리한다. 계획의 연산·입력값·기대 결과는 고정하고 대상 재발견과 제한된 보조 동작을 허용한다. 판정은 실행 대화와 분리된 새 대화로 호출한다. 파이프라인 버전은 `staged/3`이다.

## 1. 설치

Python 3.11 이상과 Node.js를 사용하며 `teams/member-01/`에서 실행한다.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r integration/requirements.txt
python -m playwright install chromium
npm.cmd install --prefix .tools/playwright-mcp @playwright/mcp@0.0.83 --no-audit --no-fund
```

현재 환경의 `.tools/integration-deps`는 로컬 설치본이다. 새 환경은 위 명령으로 설치한다. 제품 소스는 팀 폴더를 import하지 않는다.

## 2. 실행

member-01의 `.env`에 사용할 공급자의 키를 입력한다. 환경변수가 우선하며 `${변수}` 확장은 하지 않는다. 키는 결과·소스에 기록하지 않는다.

```dotenv
TIMELYGPT_API_KEY=
ANTHROPIC_API_KEY=
ANTHROPIC_PLANNING_SKILL_ID=
ANTHROPIC_PLANNING_SKILL_VERSION=latest
```

```powershell
# 모델 호출 없이 수집·빈 계획 산출물 확인. 실제 판정은 not_run.
python -m integration --url http://localhost:8080/ --provider mock --max-pages 3 --output output/mock-run

# 타임리 기본 모델: anthropic/claude-opus-5.5
python -m integration --url http://localhost:8081/ --provider timely --max-pages 3 --output output/opus-run

# 직접 Claude API: Opus 계획 → Sonnet 실행 → Sonnet 판정
python -m integration --url http://localhost:8081/ --provider anthropic --model claude-opus-5-5 --execution-model claude-sonnet-5-5 --judgment-model claude-sonnet-5-5 --model-max-tokens 12000 --model-effort medium --max-rounds 24 --max-pages 3 --output output/claude-run
```

각 실행에 새 출력 폴더를 사용한다. 초기 요구사항은 `--requirements-file docs/my-site-requirements.md`로 전달한다. 결함 정답표·주입 버그 ID는 모델 입력에 넣지 않는다.

| 옵션 | 의미 |
|---|---|
| `--model` | 계획 모델. 공식 Claude는 명시 필수 |
| `--planning-skill-id` | 계획 작성에 사용할 공식 Claude custom skill ID. 생략하면 .env의 ANTHROPIC_PLANNING_SKILL_ID 사용 |
| `--planning-skill-version` | 고정 버전 또는 latest. 생략하면 .env의 ANTHROPIC_PLANNING_SKILL_VERSION 또는 latest 사용 |
| `--execution-model` | 실행 AI 모델. 공식 Claude 기본 Sonnet 5.5, 타임리 기본 계획 모델과 동일 |
| `--judgment-model` | 판정·재현 판정 모델. 공식 Claude 기본 Sonnet 5.5, 타임리 기본 계획 모델과 동일 |
| `--max-pages` | 큐에서 방문할 최대 페이지 수 |
| `--max-runtime` | 수집·계획·실행·판정 전체 시간 상한, 기본 300초 |
| `--max-rounds` | 페이지별 모델 호출 상한. 통합 계획·수정·실행 AI·판정·재현 판정 포함 |
| `--max-actions` | 페이지별 행동 시도 상한. 계획 행동과 재현 모두 포함 |
| `--max-calls` | 실행 전체 모델 호출 상한 |
| `--model-timeout` | 모델 요청 1회의 전체 시간 상한, 기본 60초 |
| `--model-max-tokens` | 추론을 포함한 응답 토큰 상한, 기본 4000. 복잡한 계획은 12000부터 조정 |
| `--model-effort` | 공식 Claude 전용 low/medium/high 추론량 설정. 생략하면 공급자 기본값 |
| `--allow-writes` | 기본 GET/HEAD/OPTIONS 제한을 풀어 테스트 POST 등 허용 |
| `--browser-state-reset` | 승인된 격리 fixture에서 로드 전 저장소 복원. 서버/IndexedDB 복원 제외 |
| `--maison-reset` | 각 페이지 수집 전과 재현 전에 같은 origin의 `POST /_reset` 및 브라우저 초기화 |
| `--headed` | 검사 브라우저 표시 |
| `--direct` | MCP 대신 같은 Playwright 인터페이스로 실행하는 개발 옵션 |
| `--mcp-script`, `--mcp-command` | MCP 스크립트·Node 실행 경로 지정 |

`--browser-state-reset`은 `--allow-writes` 또는 `--maison-reset`과 함께 사용할 수 없다. Maison 초기화는 익명 시드의 계정·주문·세션 상태를 되돌린다. 공유 인스턴스의 다른 실행에도 영향을 주므로 해당 테스트 환경에서 사용한다.

```powershell
python -m integration --url http://localhost:8081/ --provider timely --maison-reset --allow-writes --max-pages 3 --output output/maison-run
```

페이지당 호출은 계획 1회 + 실행 AI의 동작/관찰 턴 수 + 판정 1회다. 실행 AI는 판정 호출 1회분을 남기고 멈춘다. 계획 검증 실패의 수정 요청은 최대 1회이며 공급자 오류·잘림은 자동 재시도하지 않는다. 행동이 없는 UI 시나리오는 프로그램이 실제 이미지를 수집하므로 실행 모델 호출을 생략한다. 빈 계획은 판정을 생략하고 후보의 재현 판정은 별도 호출이다. 모든 호출은 공통 상한에 포함한다.

타임리 모델 목록은 계정별로 확인한다. 단계별 옵션에 해당 공급자에서 사용 가능한 ID를 지정하며, 기본값은 기존 타임리 계획 모델을 재사용한다. 공식 Claude에서는 실행·판정 모델 옵션을 생략해도 Sonnet 5.5가 적용된다. 비용·성능 비교 시 `report.json`의 stage별 실제 모델과 토큰을 확인한다.

응답 상한 전체를 매번 소비하는 것은 아니다. 추론에 한도를 소진하면 계획 도구 응답이 잘릴 수 있으므로 `max_tokens` 오류와 `usage.thinking_tokens`를 확인한다. effort를 낮출 때에는 실제 검사 품질도 함께 비교한다. [공식 Claude 추론량 안내](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost).

## 2-1. 공식 Claude 계획 스킬

등록한 스킬 폴더는 `skills/webtestpilot-qa-test-planner/`에 보관한다.
`.env`에 실제 skill ID·버전을 지정하거나 CLI의 `--planning-skill-id`, `--planning-skill-version`으로 지정한다.
이 설정은 공식 Claude의 계획·계획 수정 단계에서만 `container.skills`와 code execution 도구를 활성화한다.
Claude가 컨테이너의 SKILL.md와 필요한 참고 파일을 읽으며, 로컬 스킬 폴더를 매번 업로드하지 않는다.
읽기 결과는 `planning_response.json`의 server tool 블록으로 기록한다.

`pause_turn` 응답은 같은 컨테이너와 읽기 대화를 유지해 이어서 요청한다.
추가 요청마다 기존 max_calls·max_rounds·model-timeout 한도가 적용되고 사용량을 별도로 기록한다.
전체 max-runtime의 취소도 그대로 적용된다. 최종 계획은 현재 qa_test_plan/test_plan/2 계약으로 검증한다.
이어진 요청 파일은 `planning_continue_1_request.json`, `planning_continue_1_response.json` 등의 이름으로 저장한다.
계획 수정은 별도의 새 컨테이너·대화에서 최대 한 번 시도한다.

스킬 파일 읽기는 클라우드의 계획 작성 활동이다. 실제 브라우저 동작은 이후 실행 AI와 Playwright MCP가 수행한다.
실행·판정·재현 판정 요청에는 이 스킬과 code execution 도구를 전달하지 않는다.
스킬 설정이 비어 있으면 기존 계획 요청을 사용한다. 타임리·mock에서는 이 설정을 적용하지 않는다.

등록과 기본 테스트 이력은 [QA 스킬 인수인계](../../../docs/reviews/QA_SKILL_HANDOFF_2026-10-12.md)를 참고한다.
서버에 스킬을 변경 등록했다면 사용할 버전도 함께 확인한다.

## 3. 코드 담당

| 파일 | 책임 |
|---|---|
| `__main__.py` | CLI·브라우저/CDP·MCP 수명·crawl 연결 |
| `preprocessor/` | FIFO URL 큐·그래프·수집·snapshot·ai_input·전후 증거 |
| `planning.py` | 최신 member-02의 제안 요청·응답 함수 원본 유지 |
| `executor.py` | 관찰 → 모델 도구 선택 → guarded MCP → 실제 결과 반환 루프 |
| `plan_contract.py` | 실행 계획 JSON 계약·관측 대상·제안 대응·한도 검증 |
| `staged.py` | 통합 계획·수정 → 실행 → 후처리 → 독립 판정 단계 관리 |
| `runtime.py` | 현재 key 재검증·행동 실행·증거 기록·판정 증거 검증·집계 |
| `mcp.py`, `mcp_client.py` | 같은 탭의 실제 MCP 동작·stdio 세션 |
| `models.py` | 타임리/Claude 전송·응답 변환·키·취소 가능한 HTTP |
| `reset.py`, `reproduction.py` | 로드 전 초기 조건·추가 재현 1회·별도 재현 판정 |
| `test_staged.py` | 단계별 가짜 모델과 계획/판정 경계 검증 |

`Runtime.inspect_page()`는 단계 관리자에 연결한다. 모델에게 일반 실행 루프의 `act/finding`을 계속 선택하게 하지 않는다. 내부 `Runtime.act()`와 `handle_tool()`은 증거·권한 검증을 재사용하는 프로그램 API다.

## 4. 단계별 산출물

```text
output/<run>/
  graph.json, urls.jsonl, run_summary.json
  snapshots/<snapshot_id>.json
  ai_inputs/<snapshot_id>.json
  actions/<action_id>.json
  raw/<URL SHA-256>/page.json + HTML/CSS/JS/DOM/PNG
  images/<snapshot_id>.png
  report.json
  flows/<flow_id>/
    input.json
    scenario_proposals.json
    test_plan.json
    execution_results.jsonl
    scenario_results.json
    judge_input.json
    judgments.json
    findings.json
    flow.json
    messages.json
    planning_request.json, planning_response.json
    planning_repair_request.json, planning_repair_response.json
    judgment_request.json, judgment_response.json
    reproduction-<finding_id>.json
```

조건에 따라 파일이 생략된다. `mcp/`는 서버가 산출물을 남길 때만 생성된다. 임시 브라우저 프로필은 종료 시 정리한다. ZIP은 결과 파일을 묶은 것이며 프로그램의 별도 판정 산출물이 아니다.

| 산출물 | 언제 만들고 무엇에 사용하는가 |
|---|---|
| `input.json` | 기존 `inspection_input/1`. 전처리 요약·본문 보충·요구사항·권한·한도 |
| `scenario_proposals.json` | 통합 계획 응답에서 분리한 기존 `page_summary`, `proposed_checks`, `open_questions` |
| `test_plan.json` | 실행 전에 검증·저장한 `test_plan/2`. 시나리오 ID·제안 번호·관측 key 또는 target_description·고정 행동/값·기대 결과/근거 |
| `execution_results.jsonl` | 행동마다 실제 MCP 요청/결과·실행/관찰 상태·전후 증거 기록 |
| `scenario_results.json` | `scenario_results/2`. 계획 진척과 실제 보조/교정 행동·전후 관찰·diff·증거 ID·이미지 참조. 앱 판정 없음. 한도·실패·취소에도 부분 결과 저장 |
| `judge_input.json` | `judge_input/2`. 고정 기대 결과·실행 사실과 `observations[snapshot_id]` 참조 맵. 같은 관찰은 한 번만 저장 |
| `judgments.json` | 별도 AI 판정과 증거 검증 결과. 미실행 상태 항목은 `judgment_source=program_policy`, AI 판정은 `model` |
| `findings.json`, `report.json` | 수용한 판정과 재현·사용량·페이지 상태·단계/모델/행동 소요 시간 집계 |
| `messages.json` | 단계별 실제 대화. 실행은 tool_use/tool_result가 이어지는 대화이며 계획·판정은 독립 요청. 이미지 base64는 파일 참조로 생략 |
| `flow.json` | 현재 단계·종료 상태·시도·초기화·실제 행동 기록. `steps`는 실행 이력 |

검사 행동의 `execution_result.tool_use_id`는 실행 AI의 실제 도구 호출 ID다. 같은 ID의 `tool_result`를 반환한다. `plan_tool_use_id`는 계획 응답 ID이며 scenario_results의 `plan_step_index`로 계획과 연결한다. `step_index`는 보조·교정을 포함한 실제 행동 순서다. 프로그램이 기록된 행동을 재현할 때는 새 실행 AI 호출이 없으므로 tool_use_id가 null이다. `execution-<scenario_id>-<turn>_request/response.json`에 실제 요청·응답과 도구 규격을 저장한다.

제안·계획 파일은 같은 실제 응답 ID를 공유하며 `source_tool=qa_test_plan`으로 출처를 표시한다. 로컬 `scenario_results.json`에는 상세 전후 관찰을 유지하고, 판정 입력은 관찰을 스냅샷별 맵으로 옮겨 중복을 제거한다. 수집한 이벤트·리소스·이동 사실도 포함한다. 참조한 스냅샷이 없으면 요청 전에 명시적으로 실패한다.

통합 실행의 동작 전후 스냅샷은 `capture_mode=light`로 반복적인 raw DOM·inline 소스·full-page PNG 저장을 생략한다. 최초 원본 파일과 새 구조화 DOM·locator 검증·이벤트·ai_input은 유지한다. UI 판정의 실제 viewport PNG는 별도로 생성한다. 독립 전처리의 기본 캡처는 전체 저장이다.

`flow.timings.stages`와 `report.timings.stages`는 단계별 시간이다. `model_calls/model_total_s`는 그 안에 포함된 모델 호출 시간이고 `actions`는 행동 하위 작업 시간이므로 이들을 다시 더하면 중복된다. 초기 전처리는 snapshot 시간과 `run_summary.json`의 전체 실행 시간으로 확인한다.

판정 AI는 `scenario_judgments`만 받는다. 기대 결과·family는 저장된 계획에서 가져오며 판정 AI가 결과를 본 뒤 바꾸지 못한다. 다른 시나리오의 action/snapshot을 근거로 사용할 수 없다.

## 5. 상태와 현재 제한

- 전처리 `complete`: 수집 완료. 정상 동작 판정이 아니다.
- 실행 `executed/not_executed/unknown`: 행동 요청의 처리 상태. `observation_status`는 관찰 확보 여부다.
- 시나리오 `completed/incomplete/not_run`: 계획 단계의 실행 상태다.
- 판정 `passed/candidate/inconclusive`: 실행한 시나리오는 별도 AI가 판단한다. 한 동작도 시도하지 않은 `not_run`은 프로그램이 `inconclusive`로만 기록한다. 앱 verdict를 추측하는 처리가 아니다. candidate는 추가 재현·재판정이 reproduced일 때만 confirmed가 된다.
- 페이지 `passed`: 계획된 시나리오가 모두 완료·passed이고 미계획 제안이 없는 경우다. 해당 페이지의 모든 버그가 없다는 뜻은 아니다.

시나리오는 같은 탭의 상태를 순서대로 공유한다. 계획의 key/URL은 최초 관찰에서 검증하고, 이후 나타나는 대상은 target_description으로 계획할 수 있다. 실행 AI는 새 관찰의 key를 선택한다. 연산·입력값·URL·기대 결과는 바꾸지 못한다. 계획 단계별 보조 행동은 최대 3회, 연속 관찰은 최대 3회, 거절/교정은 시나리오당 최대 2회다. 실행 불명확·관찰 누락·정책 차단이면 후속 행동을 멈추며, 확실한 미실행에만 기존 교정 1회를 허용한다.

click/fill/press/navigate를 지원한다. password/file 입력, 임의 selector/JS/Python 실행은 허용하지 않는다. `wait_ms`는 0~3000ms이며 완료/통과 조건이 아니다. 실행 AI에는 짧은 현재 관찰을 보내고 전체 증거는 로컬과 판정 입력에 유지한다. 로그인·select/hover/back·독립 시나리오 초기화·실제 모델 벤치마크·보고서 UI/PDF는 후속 범위다.

원본·스크린샷·대화·계획에는 페이지 내용과 테스트 입력값이 포함될 수 있다. 결과와 키는 Git에서 제외한다. JSON 내부 일부 원본 경로는 절대 경로이므로 다른 컴퓨터로 옮길 때 다시 연결해야 한다.

## 6. 검증

```powershell
python -m integration.test_staged
python -m integration.test_performance
python -m integration.test_form_evidence
python -m integration.test_executor
python -m integration.test_integration
python -m integration.test_regressions
python -m pytest integration/tests/preprocessor -q
```

실제 로컬 MCP로 두 페이지 처리·동적 대상 재발견·보조 동작·실제 도구 ID 연결·독립 판정·추가 재현·정책 차단·관찰 실패·호출 제한·취소를 검증한다. 모델은 가짜 응답을 사용하므로 실제 Sonnet의 실행 성공률·버그 탐지 성능·비용 개선은 별도 측정 대상이다.

## 7. 작성 출처

2026-10-11 원격 `development`의 `c5290bb6ca3efeb51296e37a0efdffdbc4176dd7`를 확인했다. member-02의 기존 제안 함수 두 개는 `planning.py`에 그대로 보존했다. 기존 `ClaudePlanner`는 등록된 check/control ID 선택 구조로, 자연어 제안의 자율 실행 계획 연결까지 해결하지 않았다.

타임리 반환 모델 `anthropic/claude-opus-5.5`를 확인하고 `plan_contract.py`, `staged.py`, `test_staged.py`를 생성받았다. Codex가 계약 크기 제한·미실행 증거 참조·기존 Runtime 연결·테스트 호환을 수정하고 검증했다. 초기 잘림/content_filter 응답은 제품 코드에 적용하지 않았다. 요청·원본 응답·사용량·원격 기준 소스는 Git 제외 `.tools/timely-staged-pipeline-2026-10-11/`에 보관한다. 기존 전송/MCP/전처리/초기화 코드는 재사용한다.

2026-10-12 성능 수정은 타임리의 실제 402 응답에서 `openrouter_credits` 부족을 확인한 뒤, 사용자 승인에 따라 공식 Claude `claude-opus-5-5`와 의논하고 코드를 생성받았다. Codex가 도구 이름·시간 집계·테스트 연결을 맞췄다. 원본 요청/응답은 `.tools/timely-performance-2026-10-11/`에 보관한다. [성능 수정·검증 기록](../../../docs/reviews/PERFORMANCE_IMPROVEMENTS_2026-10-12.md).

이번 `staged/3` 변경은 공식 Opus 5.5에게 수정 계획·구현 지침만 받았으며 Codex가 코드를 작성했다. 상담에는 일반 구조 요약만 전달했다. 원본 응답·사용량은 `.tools/execution-agent-20261012/`, 결정 사항은 [실행 에이전트 규격](docs/EXECUTION_AGENT.md)에 있다.

공통 폼 관찰 확장도 공식 Opus 5.5와 구조·증거 보존 방식에 대해 2회 상담하고 Codex가 작성했다.
수집 상태·폼 이벤트·별도 action_context 출력은 [AI 입력 증거 규격](docs/AI_INPUT_CONTRACT.md)에 있다.
상담에는 일반 설계 설명만 전달했고 원본은 Git 제외 `.tools/form-evidence-20261012/`에 보관한다.

## 저장소 내 작업 위치

통합 코드는 `teams/member-01/integration/`에 있습니다. 먼저 `cd teams/member-01`을 실행한 뒤 이 문서의 설치·실행 명령을 사용합니다. `.env.example`, `skills/`, `.tools/`, `output/`도 이 member-01 폴더를 기준으로 합니다.

## 2026-10-15 로컬 검사 품질 보완

현재 CLI는 quality_checks=True로 조건별 판정 검토, 공통 폼 완료 기록, 초기 UI 우선 검사,
현재 요소의 유일한 role/name 재검증, 실제 이미지 기반 UI 추가 재현과 coverage.json을 사용합니다.
직접 Runtime을 생성하는 기존 호출은 기본값 False이며 Runtime(..., quality_checks=True)로 활성화합니다.
코드·테스트·검증 결과는 [검사 품질 보완](docs/INSPECTION_QUALITY.md)을 참고하세요.
# 실행 신뢰성 후속 기록

2026-10-16: 관찰 URL·대상 검증·DOM 상태·캠페인 기록 보완은 [docs/EXECUTION_RELIABILITY.md](docs/EXECUTION_RELIABILITY.md)를 참고합니다.
