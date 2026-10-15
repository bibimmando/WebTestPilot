# 비교군 분석: Playwright Test Agents · vercel-labs/agent-browser (2026-10-15)

> Codex CLI(read-only)가 작성하고 Claude가 1순위 근거(preprocess.py:782, executor.py:51)를 코드로 재확인했다. 정적 분석이며 실행 검증은 하지 않았다.

**추천 순서는 ‘행동 참조 보존·실행 범위 조회 → 사실 참조 계약 정리 → 비용·누적 문맥 계측’입니다.** 비교군의 전체 파이프라인을 이식하기보다, 이미 있는 실행·증거·판정 경로의 연결을 보완하는 편이 적합합니다.

파일을 수정하거나 테스트·브라우저·유료 API를 실행하지 않은 정적 분석입니다. **[코드 확인]**은 현재 구현, **[지침 확인]**은 비교군의 로컬 역할 정의·사용 문서, **[추론]**은 적용 제안입니다. 비교군의 내부 구현이나 성능까지 검증했다는 뜻은 아닙니다. 이하 `AB/`는 지정한 agent-browser의 `skill-data/`입니다.

**1. 단계별 대응표**

우리 쪽은 현재 `test_plan/5`와 체크포인트·시나리오 초기화 구현을 기준으로 읽었습니다. 10월 12일 비교 문서의 `test_plan/2`·상태 공유 설명은 당시 기록으로 취급했습니다. [현재 계약과 파이프라인][w-dev]

| 단계 | WebTestPilot — 코드 확인 | Playwright Test Agents — 지침·설정 확인 | agent-browser QA — 지침 확인 |
|---|---|---|---|
| 수집 | URL 큐로 수집하고 원본 snapshot과 단계별 선택 view를 분리한다. | seed로 페이지를 준비하고 Planner가 snapshot·브라우저 도구로 탐색한다. | 이름 있는 세션에서 접근성 snapshot·ref·스크린샷·console/errors를 읽는다. |
| 계획 | 범위·준비 상태를 읽은 뒤 기대·비교·시점·필수 사실을 JSON 계획으로 고정한다. | 실제 인터페이스를 탐색해 정상·경계·오류 시나리오와 시작 조건을 Markdown 계획으로 저장한다. | taxonomy·체크리스트를 따라 탐색한다. 열람 문서에는 실행 전 기대를 고정하는 별도 계획 계약이 없다. |
| 실행 | 최신 snapshot의 검증된 대상을 사용하고 고정한 연산·입력값을 유지한다. | Generator가 각 행동·검증을 실제 수행하고 로그를 읽어 테스트 코드를 작성한 뒤 Runner로 실행한다. | `@ref`로 click/fill 등을 수행하고 조건 대기·재관측을 반복한다. |
| 증거 | action/tool/snapshot/checkpoint를 연결하고 전후 diff·사실·필요한 PNG와 부분 실패를 보존한다. | Generator 로그와 테스트 결과를 남긴다. 로컬 설정은 실패 trace·screenshot을 보존한다. | 상호작용 이슈는 영상·단계별 스크린샷, 정적 이슈는 주석 스크린샷을 보고서에 즉시 연결한다. |
| 판정 | 프로그램의 typed 비교와 별도 AI 판정을 분리하고 주장·출처·완전성을 검증한다. | assertion 결과로 테스트를 판정하고 Healer가 실패 원인을 조사한다. | 탐색 에이전트가 관측을 설명하고 범주·심각도를 붙인다. 별도 판정·주장 검증 계약은 열람 범위에서 확인되지 않았다. |
| 재현 | 승인된 초기 상태를 복원해 실제 행동을 한 번 추가 재생하고 원래 기대·최초 실패를 보존한다. | Healer가 selector·assertion 등을 수정하면서 테스트를 재실행한다. | 최소 한 번 재시도해 재현성을 확인하고 재현 과정을 기록한다. 초기 상태 일치 검증은 명시되지 않았다. |

비교군 근거: [Planner][pw-planner], [Generator][pw-generator], [Healer][pw-healer], [연결 프롬프트][pw-coverage], [로컬 Runner 설정][pw-config], [dogfood 흐름·증거 지침][ab-dogfood].

**2. 비교군에서 배울 점 — 6개**

**① 이름·역할·URL과 실행 가능한 참조를 함께 전달하고, 누락된 범위만 다시 읽기**

- **메커니즘 [지침 확인]:** AB는 `snapshot -i -u`로 링크 URL을 포함한 ref 관측을 제공하고, 복잡한 페이지는 `snapshot @e9`처럼 특정 영역을 읽도록 안내합니다. [AB/core/SKILL.md:89–103][ab-reading], [snapshot-refs.md:129–135][ab-scope]
- **우리 대응·차이 [코드 확인]:** `input_views.py:control_view`는 이미 key·역할·href를 보존합니다. 실제 손실 지점은 `preprocessor/preprocess.py:build_planning_view`입니다. 컨트롤이 선택·예산에서 빠지면 링크의 `element_key`를 제거하고 `reference_omitted`를 붙입니다. 반면 `executor.py:OBSERVE`는 이미지·시간 대기만 받아, `compact_observation`이 다시 같은 전역 요약을 전달합니다. [전처리:782–806][w-view], [실행 관측:51–98][w-observe]
- **적용 [추론]:** **3장 직접 대응, 공통 전송·실행 책임, 수정 크기 중간.** 이름·역할·href·검증된 키를 작은 묶음으로 유지하고, 실행 관측에 기존 `build_planning_view`의 제한된 범위 읽기를 재사용하는 것이 우선입니다.
- **일반화·계약 [추론]:** 긴 목록·헤더·사이드바·모달 모두 같은 정보 손실 문제를 가집니다. 특정 상품 우선순위는 필요 없습니다. 현재 snapshot의 유일한 검증 대상만 허용하면 고정 기대·증거 출처·판정 분리와 충돌하지 않습니다. 과거 키 복사나 임의 첫 요소 선택은 허용하면 안 됩니다.

**② 참조의 읽기 가능성·행동 권한·수명을 명시하기**

- **메커니즘 [지침 확인]:** AB는 `get text @e1`, `get value @e1`처럼 대상 ref로 값을 읽습니다. 살아 있는 동일 DOM 요소의 ref는 유지하지만, 요소·문서 교체 시 무효화하고 `removedRefs`를 제공합니다. 가상 접근성 노드의 ref는 snapshot에 한정됩니다. [AB/core/SKILL.md:119–133][ab-get], [snapshot-refs.md:81–83][ab-lifetime]
- **우리 대응·차이 [코드 확인]:** `plan_contract.py:validate_plan`은 checkpoint의 `element_key`를 관측 컨트롤 키로 제한합니다. 콘텐츠는 snapshot별 `content_key`를 받습니다. 다만 `checkpoints.py:resolve_target`의 `match` 경로는 이미 콘텐츠도 읽습니다. 따라서 읽기 기능 자체의 부재보다 **모델에 제시된 참조와 계약이 허용하는 표현의 불일치**가 핵심입니다. [계획 검증:260–269][w-plan-facts], [대상 해석:46–70][w-resolve], [content_key 생성:712–713][w-content-key]
- **적용 [추론]:** **4장 직접 대응, 공통 입력·계획·수집 계약 책임, 수정 크기 중간.** 행동 대상, 현재 콘텐츠 읽기, 과거 증거 출처를 명시적으로 구별하고 기존 `match`·사실 수집 경로를 정리해야 합니다. typed namespace는 비교군에서 그대로 가져오는 기능이 아니라 우리 계약에 맞춘 추가 설계입니다.
- **일반화·계약 [추론]:** 수량·가격·작업 카운터·선택 상태에서 **식별과 값**을 분리해야 한다는 근거가 같습니다. AB의 DOM ref도 재렌더링 뒤 의미상 동일한 요소를 보장하지는 않습니다. 현재 값이나 기대값을 식별자로 삼지 않고, 안정적인 식별이 없으면 미해결로 남겨야 합니다. `content_key`를 미래 checkpoint에 그대로 허용하면 수명 계약과 충돌합니다.

**③ 실행 단계에도 제한된 조건 대기를 연결하기**

- **메커니즘 [지침 확인]:** AB는 요소·텍스트·URL 등 구체적 조건 대기를 제시하고, 일반적인 SPA 준비 판단에 `networkidle`을 쓰지 않도록 안내합니다. Playwright Healer도 `networkidle` 사용을 금지합니다. [AB/core/SKILL.md:190–215][ab-wait], [Healer TOML:41][pw-healer-wait]
- **우리 대응·차이 [코드 확인]:** `PlanningObserver.condition/observe`는 이미 영역·role·name·상태의 유일성과 조건 대기를 지원합니다. 실행의 `observe`는 `wait_ms`만 지원하며, `Runtime.act`는 DOMContentLoaded와 전역 ready selector 또는 짧은 고정 대기를 사용합니다. [계획 관측:57–109][w-condition], [실행 대기:204–208][w-exec-wait], [행동 후 준비 확인:357–369][w-settle]
- **적용 [추론]:** **3장의 준비 상태 관련 실패와 5장의 반복 조회 비용에 부분 대응, 공통 실행 책임, 수정 크기 중간.** 기존 조건 읽기를 실행 관측에도 연결하면 새로운 대기 엔진이 필요하지 않습니다.
- **일반화·계약 [추론]:** 비동기 목록·열린 메뉴·지연 모달에서 공통으로 성립합니다. 기다린다는 사실이 전송에서 빠진 대상을 복구하지는 않으므로 ①과 함께 적용해야 합니다. 준비 조건과 검사 기대를 구별하고, 기대값이 나올 때까지 기다리는 방식으로 결함을 가리면 안 됩니다. timeout은 자동화 불확실성으로 남겨야 합니다.

**④ diff를 ‘기준 상태가 명시된 전송 규격’으로 활용하기**

- **메커니즘 [지침 확인]:** AB의 `snapshot --delta`는 최초 전체 상태 이후 `full/unchanged/delta`를 반환합니다. 기준은 탭·옵션별이며 `baseRevision → revision`에 변경을 적용합니다. URL 변경·큰 변경은 전체 상태로 돌아가고, 기준을 잃으면 `--full`을 요청합니다. [AB/core/SKILL.md:99–103][ab-reading], [commands.md:43–55][ab-delta]
- **우리 대응·차이 [코드 확인]:** `SnapshotAPI.action`은 이미 전후 `diff_snapshots`를 저장합니다. 그러나 `executor.py:_run`은 매 응답에 현재 compact 관측을 붙이고 대화를 누적합니다. 기존 diff는 부분 수집·약한 식별의 불확실성을 표현하는 **증거 요약**이며, 전체 관측을 복원하는 완전한 패치는 아닙니다. [증거 연결:247–262][w-evidence-diff], [현재 관측 누적:270–280][w-history], [기존 diff:305–357][w-diff]
- **적용 [추론]:** **5장 직접 대응, 공통 전송 책임, 수정 크기 중간.** 원본 저장은 유지하고, 먼저 실행의 반복 관측 한 경로에서 기준 snapshot·scope·view 버전이 명시된 변경 전송을 검토할 수 있습니다.
- **일반화·계약 [추론]:** 변경이 적은 폼·관리 화면·목록에서 효과를 기대할 수 있습니다. 생략·미수집을 삭제로 처리하거나 서로 다른 scope를 비교하면 잘못된 상태를 만듭니다. 기준 불일치 시 전체 관측으로 복구하고 판정에는 실제 snapshot 출처를 유지해야 합니다. 과거 대화는 계속 남으므로 delta만으로 누적 입력 문제가 해결되지는 않습니다.

**⑤ 이미지의 캡처·저장·모델 전송을 분리하고, 주석을 참조에 연결하기**

- **메커니즘 [지침 확인]:** AB는 `--annotate`의 번호를 snapshot ref에 연결하고, `--if-changed`로 변화 없는 이미지의 재출력을 줄입니다. 조건부 응답은 탭·캡처 범위별 revision·변화율을 제공합니다. Playwright Planner도 꼭 필요한 경우에만 screenshot을 사용하도록 합니다. [AB/core/SKILL.md:312–327][ab-image], [commands.md:108–119][ab-image-contract], [Planner TOML:12–14][pw-planner]
- **우리 대응·차이 [코드 확인]:** `Runtime.capture_image`는 같은 snapshot의 이미지를 재사용하고 `staged.inspect_page`도 같은 snapshot 이미지의 중복 전송을 제거합니다. 서로 다른 snapshot 사이의 동일 이미지 전송 제거와 ref 주석 연결은 이 경로에서 확인되지 않습니다. 이미지 출처는 이미 `temporal_after_snapshot`으로 기록합니다. [캡처:230–246][w-image], [판정 전송:590–598][w-image-send]
- **적용 [추론]:** **5장의 이미지·누적 문맥 비용에 대응, 공통 증거·전송 책임, 수정 크기 중간.** 필수 시점의 캡처·출처를 유지하면서 완전히 동일한 이미지의 전송을 줄이고, 주석본은 원본과 연결된 파생물로 취급할 수 있습니다.
- **일반화·계약 [추론]:** 정적 폼에는 유리할 수 있지만 애니메이션 화면에서는 절감이 작을 수 있습니다. 작은 픽셀 변화도 결함일 수 있으므로 비영(非零) 변화율 임계값으로 필수 증거를 생략하면 충돌합니다. 주석도 실제 원본을 가리지 않게 별도로 보존해야 합니다. 10월 14일 실측은 이미지 입력이 없어 절감 효과는 미확인입니다.

**⑥ 탐색 체크리스트와 심각도는 제안·보고 보조 정보로 사용하기**

- **메커니즘 [지침 확인]:** Playwright Planner는 정상·경계·오류 흐름과 독립적인 시작 조건을 요구합니다. AB taxonomy는 UI·기능·UX·콘텐츠·성능·오류·접근성으로 탐색하고, 상태·폼·인증 경계를 확인하도록 합니다. [Planner TOML:22–45][pw-planner-checks], [issue-taxonomy.md:11–109][ab-taxonomy]
- **우리 대응·차이 [코드 확인]:** `plan_contract.py`에는 네 실행 family와 제안별 planned/unplanned 대응이 이미 있고, `judgments.py:bind`는 실제 실행·증거·비교·주장을 검증합니다. taxonomy를 verdict 대신 사용할 이유는 없습니다. [family·제안 계약][w-families], [미계획 집계 계약:285–296][w-unplanned], [판정 검증:230–271][w-judge]
- **적용 [추론]:** **5장의 판단 품질·누락 평가 보조이며, 3·4장의 참조 문제는 직접 해결하지 않습니다. 수정 크기 작음.** 기존 제안에 탐색 항목과 미지원 이유를 연결하는 수준이 적합합니다.
- **일반화·계약 [추론]:** 앱의 기능을 가정하지 않고 관측·권한에 맞춰 적용하면 구조가 다른 앱에도 사용할 수 있습니다. 지원하지 않는 업로드·다중 사용자 검사 등을 계획한 것처럼 세지 않아야 합니다. 심각도는 영향의 분류이며, 기대 불일치·자동화 실패·확정 여부와 별도로 유지해야 합니다.

**3. 배우지 말아야 할 점**

- **Healer의 기대값 수정·`test.fixme()`·통과까지 반복을 결함 탐지 루프에 이식하기.** 로컬 정의는 이를 명시적으로 허용합니다. 테스트 유지보수와 우리의 고정 기대 검사는 목적이 다릅니다. 최초 결과·수정 결과·skip을 분리해야 합니다. [Healer TOML:21–40][pw-healer]
- **dogfood의 “5–10개 이슈” 목표나 불안정한 재현 사례 배제.** 이슈 수를 채우는 편향을 만들고 간헐 결함·불확실성을 숨길 수 있습니다. 최초 증거를 먼저 보존하고 재현 실패도 별도 상태로 남겨야 합니다. [dogfood:181·197][ab-dogfood-end]
- **`find first/nth`, 임의 CSS·JS를 대상 누락의 일반적인 탈출구로 허용하기.** AB는 이런 도구를 제공하지만, 우리에게는 관측된 대상·유일성·권한 검증을 우회하는 결과가 됩니다. 현재 `mcp.py:_preflight`의 유일성·가시성·활성 검증을 유지해야 합니다. [AB/core/SKILL.md:164–188][ab-fallback], [우리 사전 검증:70–88][w-preflight]
- **taxonomy의 시간 예시나 console 오류를 자동으로 제품 결함의 정답으로 삼기.** UX 지연·로드 시간·경고는 조사 후보입니다. 실제 요구사항·측정 조건·영향 근거가 있어야 판정할 수 있습니다. [issue-taxonomy.md:48–86][ab-taxonomy-threshold]
- **참조 문서의 지원 한계를 완전한 관측으로 간주하기.** AB 문서는 일부 iframe을 생략한다고 명시합니다. 우리도 지원하지 않거나 읽지 못한 영역을 정상·부재로 판정하지 않고 한계로 기록해야 합니다. [snapshot-refs.md:184–188][ab-iframe]

또한 역할 분리·행동 로그·checkpoint·재현 경로는 우리에게 이미 있습니다. Generator의 실제 수행 후 로그를 읽는 원칙은 유지할 가치가 있지만, 이를 이유로 별도 엔진을 중복 구축할 필요는 없습니다. [Generator TOML:9–23][pw-generator]

**4. 추천 적용 순서 상위 3개**

| 순서 | 적용 범위와 일반적인 원인 | 검증·완료 조건 |
|---|---|---|
| **1** | **행동 참조 보존 + 실행 범위 조회.** 수집된 대상이 전송 압축에서 행동 가능성을 잃고, 같은 전역 요약을 다시 받는 문제를 해결한다. | 긴 목록·반복 내비게이션·동적 모달의 서로 다른 fixture에서 현재 대상까지 연결되어야 한다. 참조 누락·반복 조회·`target_not_found`를 따로 측정하고 모호한 대상은 계속 거부한다. |
| **2** | **사실 참조의 권한·수명·식별 계약.** 관측한 콘텐츠를 유효한 checkpoint 대상으로 표현하지 못하거나, 변하는 값을 신원으로 사용하는 문제를 해결한다. | 수량·가격·카운터·선택 상태의 정상·결함 사례에서 기대와 실제 값이 달라도 같은 의미의 사실을 읽어야 한다. 잘못된 namespace·모호한 대상·미수집은 거부하고 source를 보존한다. |
| **3** | **비용 성분 계측 후 delta·이미지 전송 절감.** 알려진 요청 크기·숨은 스킬 문맥·누적 관측·이미지가 비용 예약에서 섞이는 문제를 먼저 드러낸다. | 실제 사용량과 다음 요청 예약을 분리하고, 동일 계획·모델·상한·예산으로 완성 시나리오당 토큰·시간·증거 완전성·판정 유효성을 비교한다. 기준 상태 유실·부분 수집·작은 시각 변화에서도 보호 계약이 유지되어야 한다. |

3순위는 비교군만으로 해결되지 않습니다. 현재 `request_metrics`는 이미 클라이언트 바이트·이미지량을 구분하지만 토큰 계측은 아니며, `request_reserve`는 직렬화 바이트와 스킬 고정치를 사용합니다. 또한 `_exchange`는 비용 검사를 입력 계측보다 먼저 하므로 예약으로 중단된 요청의 분석 정보도 보완할 여지가 있습니다. **예약을 끄는 대신 예약 근거를 기록하는 것이 먼저입니다.** [입력 계측][w-metrics], [예약 계산][w-reserve], [호출 순서][w-exchange]

위 완료 조건은 일반화 검증을 위한 제안입니다. 이번에는 독립 앱을 실행하지 않았으므로 **어느 항목도 범용 성능 개선이 검증됐다고 결론 내리지 않습니다.**

[w-dev]: ../../integration/DEVELOPMENT.md:8
[pw-planner]: ../../.codex/agents/playwright_test_planner.toml:11
[pw-generator]: ../../.codex/agents/playwright_test_generator.toml:9
[pw-healer]: ../../.codex/agents/playwright_test_healer.toml:9
[pw-coverage]: ../../.codex/prompts/playwright-test-coverage.md:11
[pw-config]: ../../playwright.config.ts:15
[ab-dogfood]: https://github.com/vercel-labs/agent-browser/blob/main/skill-data/dogfood/SKILL.md#L27
[ab-reading]: https://github.com/vercel-labs/agent-browser/blob/main/skill-data/core/SKILL.md#L89
[ab-scope]: https://github.com/vercel-labs/agent-browser/blob/main/skill-data/core/references/snapshot-refs.md#L129
[w-view]: ../../integration/preprocessor/preprocess.py:782
[w-observe]: ../../integration/executor.py:51
[ab-get]: https://github.com/vercel-labs/agent-browser/blob/main/skill-data/core/SKILL.md#L119
[ab-lifetime]: https://github.com/vercel-labs/agent-browser/blob/main/skill-data/core/references/snapshot-refs.md#L81
[w-plan-facts]: ../../integration/plan_contract.py:260
[w-resolve]: ../../integration/checkpoints.py:46
[w-content-key]: ../../integration/preprocessor/collector.py:712
[ab-wait]: https://github.com/vercel-labs/agent-browser/blob/main/skill-data/core/SKILL.md#L190
[pw-healer-wait]: ../../.codex/agents/playwright_test_healer.toml:41
[w-condition]: ../../integration/planning_observer.py:57
[w-exec-wait]: ../../integration/executor.py:204
[w-settle]: ../../integration/runtime.py:357
[ab-delta]: https://github.com/vercel-labs/agent-browser/blob/main/skill-data/core/references/commands.md#L43
[w-evidence-diff]: ../../integration/preprocessor/evidence.py:247
[w-history]: ../../integration/executor.py:270
[w-diff]: ../../integration/preprocessor/preprocess.py:305
[ab-image]: https://github.com/vercel-labs/agent-browser/blob/main/skill-data/core/SKILL.md#L312
[ab-image-contract]: https://github.com/vercel-labs/agent-browser/blob/main/skill-data/core/references/commands.md#L108
[w-image]: ../../integration/runtime.py:230
[w-image-send]: ../../integration/staged.py:590
[pw-planner-checks]: ../../.codex/agents/playwright_test_planner.toml:22
[ab-taxonomy]: https://github.com/vercel-labs/agent-browser/blob/main/skill-data/dogfood/references/issue-taxonomy.md#L11
[w-families]: ../../integration/plan_contract.py:17
[w-unplanned]: ../../integration/plan_contract.py:285
[w-judge]: ../../integration/judgments.py:230
[ab-dogfood-end]: https://github.com/vercel-labs/agent-browser/blob/main/skill-data/dogfood/SKILL.md#L181
[ab-fallback]: https://github.com/vercel-labs/agent-browser/blob/main/skill-data/core/SKILL.md#L164
[w-preflight]: ../../integration/mcp.py:70
[ab-taxonomy-threshold]: https://github.com/vercel-labs/agent-browser/blob/main/skill-data/dogfood/references/issue-taxonomy.md#L48
[ab-iframe]: https://github.com/vercel-labs/agent-browser/blob/main/skill-data/core/references/snapshot-refs.md#L184
[w-metrics]: ../../integration/input_views.py:104
[w-reserve]: ../../integration/cost.py:45
[w-exchange]: ../../integration/staged.py:195