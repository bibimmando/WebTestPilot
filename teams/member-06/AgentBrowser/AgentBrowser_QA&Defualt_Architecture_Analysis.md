# agent-browser 엔진 구조 및 Dogfood QA 실행 아키텍처 분석

> 분석 대상: 사용자가 제공한 `agent-browser-main.zip` 원본 소스. 이 문서는 **실제 저장소에서 확인한 사실**과 **WebTestPilot 통합 제안**을 분리한다. 코드 실행 테스트는 수행하지 않았으므로 런타임 동작은 코드·스킬 문서에 근거한 설명이다.

## 1. 한눈에 보는 결론

- `agent-browser`는 AI 모델이 아니라 **AI가 호출하는 브라우저 자동화 실행 엔진(CLI)**이다.
- `skill-data/core`는 브라우저 조작법을, `skill-data/dogfood`는 **탐색적 QA 작업 순서·증거 수집·보고서 작성법**을 제공한다.
- Dogfood 스킬이 버그를 찾는 독립 프로그램인 것은 아니다. **AI Agent가 스킬 지침을 읽고 CLI 명령을 선택·실행**하며, 엔진이 브라우저 조작과 관찰 결과를 반환한다.
- 원본 Dogfood는 **Markdown 보고서**를 작성하며, WebTestPilot이 목표로 하는 **근거 기반 최종 확정 판단과 구조화된 JSON 계약**은 별도 설계가 필요하다.

## 2. 실제 저장소 구조

```text
agent-browser-main/
├── bin/agent-browser.js          # 배포 패키지 실행 진입 스크립트
├── cli/
│   ├── Cargo.toml               # Rust CLI 빌드·의존성
│   └── src/
│       ├── main.rs              # CLI 진입, 플래그·명령 처리 흐름
│       ├── commands.rs          # 사용자 명령 파싱
│       ├── connection.rs        # 데몬 기동/연결, 요청·응답
│       ├── skills.rs            # 스킬 탐색·출력
│       ├── mcp/                 # MCP 도구 인터페이스
│       └── native/
│           ├── daemon.rs        # 세션별 백그라운드 서버
│           ├── actions.rs       # 명령 실행 분배 및 상태
│           ├── browser.rs       # 브라우저 생명주기·탭/연결 관리
│           ├── cdp/             # CDP 통신 및 브라우저 기동
│           ├── snapshot.rs      # 접근성 기반 페이지 구조 관찰
│           ├── element.rs       # 요소 참조 및 해석
│           ├── interaction.rs   # 클릭·입력 등 조작
│           ├── network.rs       # 네트워크 관찰·처리
│           ├── screenshot.rs    # 화면 증거
│           ├── recording.rs     # 재현 영상
│           ├── tracing.rs       # 추적 자료
│           └── state.rs         # 브라우저 상태
├── skills/                       # 외부 도구용 discovery stub
├── skill-data/
│   ├── core/
│   │   ├── SKILL.md
│   │   ├── references/          # 명령, 세션, 인증, 스냅샷, 영상 등
│   │   └── templates/           # 자동화 예제
│   └── dogfood/
│       ├── SKILL.md
│       ├── references/issue-taxonomy.md
│       └── templates/dogfood-report-template.md
├── packages/                     # 대시보드·연동 패키지
├── docs/                         # 사용 및 개발 문서
├── evals/                        # 평가 관련 코드
├── benchmarks/                   # 벤치마크
└── docker/                       # 빌드/실행 관련 구성
```

> 주의: 위 트리는 핵심 파일을 발췌한 것이며 모든 디렉터리를 나열한 것은 아니다. 특히 `native`에는 다른 실행 모듈도 존재한다.

### 2.1 CLI 계층

`cli/src/main.rs`는 명령 처리의 주요 진입점이며 `commands`, `connection`, `skills`, `mcp`, `native` 등의 모듈을 선언한다. `commands.rs`는 CLI 요청을 해석하고, `connection.rs`는 데몬 연결과 요청/응답 처리를 담당한다.

`connection.rs`의 `Request`는 `id`, `action`, 추가 JSON 필드를 갖고, `Response`는 `success`, `data`, `error`, 선택적인 `code`와 `warning`을 갖는다. 즉 **명령 실행 결과를 기계가 읽을 수 있는 응답으로 반환하는 경계**가 존재한다.

### 2.2 세션·데몬 계층

`native/daemon.rs`의 `run_daemon(session)`은 세션별 데몬을 시작한다. 소스에는 PID/버전 기록, 소켓 준비, 명령 실행을 위한 `execute_command` 호출이 나타난다. Unix에서는 Unix 소켓, Windows에서는 TCP 포트 파일을 사용하는 경로가 있다.

세션을 명시하면 테스트 간 브라우저 상태가 섞이는 문제를 줄일 수 있다. 인증 상태 저장·복원은 별도 상태 기능과 함께 다뤄야 하며, 인증 파일은 민감 정보로 취급해야 한다.

### 2.3 네이티브 브라우저 계층

`native/browser.rs`는 CDP 클라이언트, Chrome 기동/연결, 탭·브라우저 관리 기능을 참조한다. `native/cdp/` 아래는 프로토콜 통신을 담당한다. `snapshot.rs`·`element.rs`는 AI가 화면의 조작 대상을 이해하도록 돕고, `interaction.rs`는 실제 조작을 담당한다.

브라우저를 조작하는 **실행 주체는 엔진**이고, 어떤 명령을 언제 사용할지 결정하는 **전략 주체는 AI Agent**다.

### 2.4 스킬 배포 계층

`cli/src/skills.rs` 주석에 따르면:

- `skills/`: 외부 스킬 설치·발견을 위한 안내용 stub. 일부는 `hidden: true`.
- `skill-data/`: `core`, `dogfood` 등 CLI가 제공하는 실제 런타임 스킬 콘텐츠.

따라서 같은 이름의 `SKILL.md`가 여러 위치에 있어도 중복 구현이라고 단정하면 안 된다. `agent-browser skills get core --full`, `agent-browser skills get dogfood --full`은 설치된 버전과 맞는 스킬 내용을 얻는 경로다.

## 3. AI → 엔진 → 브라우저 실행 흐름

```text
[AI Agent]
  │ 스킬 지침·관찰 결과를 토대로 행동 결정
  ▼
[CLI / MCP 인터페이스]
  │ 명령 파싱·요청 구성
  ▼
[connection.rs]
  │ 세션 데몬 연결 및 요청 전송
  ▼
[native/daemon.rs]
  │ 요청 수신
  ▼
[native/actions.rs]
  │ 명령별 실행 분배
  ▼
[native/browser.rs + interaction/snapshot/network/...]
  │ CDP 명령·이벤트
  ▼
[Chrome / Chromium]
  │ 화면·DOM·네트워크 등 실제 관찰
  └──────── 결과 → 데몬 → CLI → AI Agent
```

이 흐름은 코드의 주요 모듈과 호출 관계를 요약한 것이며, 모든 명령이 동일한 내부 함수 경로를 거친다는 의미는 아니다. `core` 스킬에는 CLI 명령과 함께 MCP 통합 방식도 문서화되어 있다.

### 3.1 AI가 관찰하고 행동하는 예시

```bash
agent-browser --session qa-demo open https://example.com
agent-browser --session qa-demo snapshot -i
# AI가 snapshot의 @eN 참조 중 테스트 대상을 선택
agent-browser --session qa-demo click @e3
agent-browser --session qa-demo snapshot -i
agent-browser --session qa-demo errors
agent-browser --session qa-demo screenshot result.png
agent-browser --session qa-demo close
```

`@e3`는 예시일 뿐 고정된 버튼 ID가 아니다. 실제 명령에서는 **직전에 받은 snapshot에 표시된 참조**를 사용해야 한다. 페이지가 바뀌면 다시 관찰하는 게 안전하다.

## 4. Dogfood QA 스킬의 실제 구성

### 4.1 입력과 초기값

`skill-data/dogfood/SKILL.md`에서 **필수 입력은 Target URL**이다. 기본값은 도메인 기반 세션명, `./dogfood-output/` 출력 폴더, 전체 앱 범위, 인증 없음이다. 사용자가 범위·인증을 지정하면 이를 반영한다.

### 4.2 원본에 명시된 여섯 단계

```text
1 Initialize  세션·출력 폴더·보고서 준비
2 Authenticate 필요시 로그인, 인증 상태 저장
3 Orient       초기 스크린샷과 snapshot으로 사이트 파악
4 Explore      페이지별 기능·경계 조건·오류 탐색
5 Document     발견 즉시 재현 증거 확보 및 보고서 기록
6 Wrap up      이슈 수 집계·세션 종료
```

**중요:** 원본의 4단계 Explore와 5단계 Document는 완전히 분리된 일괄 처리 과정이 아니다. **탐색 도중 문제가 발견되면 즉시 멈추고 증거를 확보한 뒤 다시 탐색**하도록 명시한다.

### 4.3 초기화

```bash
mkdir -p dogfood-output/screenshots dogfood-output/videos
cp <DOGFOOD_SKILL_DIR>/templates/dogfood-report-template.md dogfood-output/report.md
agent-browser --session <SESSION> open <TARGET_URL>
agent-browser --session <SESSION> wait --load domcontentloaded
```

세션을 만들고 보고서 템플릿을 복사한다. 인증이 필요한 경우 `snapshot -i`로 입력 요소를 찾고 `fill`, `click`, `wait`로 로그인하며, 필요시 `state save`를 사용한다.

### 4.4 방향 파악(Orient)

```bash
agent-browser --session <SESSION> screenshot --annotate dogfood-output/screenshots/initial.png
agent-browser --session <SESSION> snapshot -i
```

초기 화면의 내비게이션·인터랙티브 요소를 찾아 탐색 지도를 구성한다. `snapshot -i`는 조작 가능한 요소를 찾는 데, 일반 `snapshot`은 텍스트·페이지 내용을 읽는 데 사용하도록 원본이 구분한다.

### 4.5 탐색(Explore)

원본 지침은 다음을 제안한다.

- 상위 내비게이션의 각 섹션을 방문한다.
- 버튼, 폼, 드롭다운, 모달 등 인터랙션을 시험한다.
- 빈 상태, 오류 처리, 경계 입력값을 확인한다.
- 실제 사용자의 작업 흐름을 처음부터 끝까지 시험한다.
- 콘솔 오류를 주기적으로 확인한다.
- 핵심 기능에 더 많은 시간을 쓰고, 문제가 몰린 영역은 깊게 조사한다.

페이지별 기본 관찰 명령:

```bash
agent-browser --session <SESSION> snapshot -i
agent-browser --session <SESSION> screenshot --annotate <PAGE_IMAGE>
agent-browser --session <SESSION> errors
agent-browser --session <SESSION> console
```

이는 **고정된 테스트 스크립트 실행**이 아니라 AI가 관찰 결과를 보면서 다음 행동을 선택하는 탐색적 테스트다.

### 4.6 이슈 분류 기준

`references/issue-taxonomy.md`는 다음 분류를 제공한다.

| 범주 | 예시 |
|---|---|
| Visual / UI | 레이아웃 겹침, 잘림, 반응형 문제 |
| Functional | 버튼 미작동, 잘못된 링크, 입력 검증, 상태 유실 |
| UX | 불명확한 피드백, 막힌 흐름, 혼란스러운 내비게이션 |
| Content | 오탈자, 임시 문구, 잘못된 레이블 |
| Performance | 느린 로딩, 레이아웃 이동, 과도한 요청 |
| Console / Errors | JS 예외, 실패한 요청, CORS 등 |
| Accessibility | 접근성 관련 문제(원본 분류 문서 후반부 참조) |

심각도는 `critical`(핵심 흐름 차단·데이터 손실·충돌), `high`(주요 기능 사용 불가·우회 불가), `medium`(문제 있으나 우회 가능), `low`(경미한 시각적/완성도 문제)로 나눈다.

### 4.7 재현 우선 증거 수집(Repro-First)

**인터랙션 관련 문제**는 원본 지침상 최소 한 차례 재시도로 재현 가능성을 확인한 다음:

1. 재현 영상 녹화를 시작한다.
2. 각 행동 단계 전후에 스크린샷을 찍는다.
3. 사람에게 이해되는 속도로 행동을 진행한다.
4. 최종 오류 상태를 주석 스크린샷으로 남긴다.
5. 영상 녹화를 종료한다.
6. 단계별 스크린샷을 연결한 재현 절차를 보고서에 즉시 기록한다.

```bash
agent-browser --session <SESSION> record start dogfood-output/videos/issue-001-repro.webm
agent-browser --session <SESSION> screenshot dogfood-output/screenshots/issue-001-step-1.png
# AI가 확인한 대상에 클릭/입력 수행
agent-browser --session <SESSION> screenshot dogfood-output/screenshots/issue-001-step-2.png
agent-browser --session <SESSION> screenshot --annotate dogfood-output/screenshots/issue-001-result.png
agent-browser --session <SESSION> record stop
```

원본은 영상의 가독성을 위해 행동 사이에 1~2초의 간격을 두도록 한다. **정적 문제**(오탈자, 로딩 즉시 보이는 잘림 등)는 한 장의 주석 스크린샷으로 충분하며 영상은 필요하지 않다고 한다.

### 4.8 결과 기록과 종료

원본 템플릿 `dogfood-report-template.md`는 날짜, URL, 세션, 범위, 심각도별 개수, 각 `ISSUE-001`의 제목·심각도·분류·URL·영상·설명·재현 단계·이미지를 Markdown으로 기록한다.

스킬은 5~10개의 **잘 문서화된 이슈**를 목표로 제안하지만, 이는 품질보다 개수를 우선하라는 뜻이 아니다. 마지막에 개수를 재집계하고 세션을 닫는다.

## 5. QA의 제어권은 어디에 있는가?

| 계층 | 실제 책임 | 하지 않는 일 |
|---|---|---|
| AI Agent | 무엇을 테스트할지, 다음 행동, 의심 현상 해석 | CDP 명령을 직접 실행하지 않음 |
| Dogfood Skill | 탐색 절차·분류·증거·보고서 작성 지침 | 독립적인 실행 프로그램이 아님 |
| Core Skill | CLI 사용법, snapshot·세션·도구 지침 | 버그를 최종 확정하는 규칙 엔진이 아님 |
| agent-browser CLI/Daemon | 명령 처리, 브라우저 실행, 결과 반환 | 제품 요구사항을 스스로 판단하지 않음 |
| Chrome/Chromium | 웹사이트 실행과 상태 제공 | QA 결론을 내리지 않음 |

따라서 `Dogfood Skill → 엔진이 자동으로 QA`라고 이해하면 부정확하다. **AI가 스킬을 참고하여 여러 차례 관찰→행동→판단을 반복하는 루프**다.

## 6. 원본 Dogfood의 한계와 WebTestPilot에 필요한 확장

다음은 **원본 기능**과 **우리 프로젝트에 필요한 추가 설계**를 구분한 것이다.

| 항목 | 원본 Dogfood | WebTestPilot 목표 |
|---|---|---|
| 시작 입력 | 대상 URL 중심 | 크롤러/전처리기 JSON + 대상 URL |
| 테스트 계획 | 내비게이션·기능 중심 자율 탐색 | 크롤러 정보 기반 테스트 우선순위·범위 선정 |
| 재현 | 재시도 후 영상·스크린샷 | 재현 조건·횟수·환경·실패 원인 구조화 |
| 판단 근거 | 관찰과 일반적인 QA 체크리스트 | 기술 표준·제품 요구사항·증거를 연결 |
| 결론 | 발견 이슈로 보고 | `CONFIRMED` / `NOT_A_BUG` / `INCONCLUSIVE` |
| 출력 | Markdown 보고서 | 검증 가능한 JSON → 별도 Report Generator |

**설계상 주의:** 원본 Dogfood는 일관되게 재현되지 않으면 유효한 이슈가 아니라고 안내한다. WebTestPilot은 이를 그대로 적용하기보다, 간헐적 문제나 증거 부족 사례를 `INCONCLUSIVE`로 남기는 편이 타당하다. 또한 4xx/5xx 응답이나 콘솔 오류 하나만으로 사용자 경험 버그를 확정해서는 안 된다.

## 7. WebTestPilot 통합 제안 (원본에 없는 설계)

```text
[Crawler / Preprocessor]
  └─ pages, links, UI elements, metadata, traversal context
                  │
                  ▼
[AI Agent: 테스트 계획 수립]
  ├─ 우선순위·테스트 가설
  ├─ Dogfood 전략 참고
  └─ Core 명령 지침 참고
                  │
                  ▼
[Browser Adapter]
  ├─ 선택 A: 기존 Playwright 유지
  └─ 선택 B: agent-browser CLI 도입
                  │
                  ▼
[AI Agent: 탐색·재현·증거 해석]
  ├─ UI/DOM/네트워크/콘솔 관찰
  ├─ 재현 조건 및 행동 기록
  └─ 실패 원인 분리
                  │
                  ▼
[Evidence-Guided Verification Skill]
  ├─ 공식 문서 60개: 기술적 참고 근거
  ├─ 기대 동작의 출처 검토
  └─ AI의 최종 판단 지원
                  │
                  ▼
[verification_results.json]
                  │
                  ▼
[Report Generator]
```

### 7.1 JSON 계약 예시 (제안, 원본 스키마 아님)

```json
{
  "target_url": "https://example.com",
  "run_id": "qa-run-001",
  "issues": [
    {
      "id": "ISSUE-001",
      "category": "functional",
      "title": "제출 버튼 이후 결과 화면 미표시",
      "expected_behavior": "제출 성공 시 완료 화면이 표시되어야 함",
      "expected_basis": {
        "type": "product_requirement",
        "reference": "검증된 제품 요구사항 문서 식별자"
      },
      "observed_behavior": "클릭 이후 완료 화면이 나타나지 않음",
      "reproduction": {
        "attempts": 2,
        "successful_reproductions": 2,
        "steps": ["테스트 페이지 진입", "유효한 값 입력", "제출 클릭"],
        "environment": "브라우저/버전/뷰포트 등 기록"
      },
      "evidence": [
        {"type": "screenshot", "path": "screenshots/issue-001-result.png"}
      ],
      "references": [],
      "decision": "INCONCLUSIVE",
      "decision_reason": "예시 데이터이며 실제 제품 요구사항과 실행 증거를 검증하지 않았음"
    }
  ]
}
```

이 JSON은 **형태 설명을 위한 가상 예시**다. 실제 버그가 발견되었다는 의미가 아니다. `expected_basis`는 공식 표준, 제품 요구사항, 사용자 흐름 가설 등을 구분하도록 확장하는 것이 좋다. 영상/스크린샷 경로만 남기지 말고 테스트 실행 시각·세션·원본 로그와 연결할 것을 권장한다.

### 7.2 엔진 도입 시 결정해야 할 사항

1. **기존 Playwright 유지 vs agent-browser CLI 교체**: 둘을 동시에 운영하면 세션과 브라우저 상태 동기화 문제가 생길 수 있다.
2. **AI 실행 방식**: Claude가 Bash로 CLI를 호출할지, MCP를 통해 도구를 호출할지 결정한다.
3. **스킬 호출**: Core·Dogfood를 원본 그대로 쓸지, WebTestPilot 전용으로 개작할지 정한다.
4. **판단 책임**: CLI는 실행·관찰, AI는 가설·판단, JSON Schema는 출력 검증을 맡도록 구분한다.
5. **안전 경계**: 허가된 대상, 테스트 계정, 민감 작업 제한, 인증 상태 파일 보호를 강제한다.

## 8. 원본 코드·문서 근거 색인

모든 경로는 ZIP 내부 `agent-browser-main/`을 기준으로 한다.

| 경로 | 이 문서에서 확인한 내용 |
|---|---|
| `cli/src/main.rs` | CLI 모듈 선언 및 명령 처리 진입 |
| `cli/src/commands.rs` | 명령 파싱 |
| `cli/src/connection.rs` | Request/Response, 데몬 통신, Unix/TCP 연결 |
| `cli/src/native/daemon.rs` | 세션별 데몬, `execute_command` 호출 |
| `cli/src/native/actions.rs` | 네이티브 명령 실행 분배 |
| `cli/src/native/browser.rs` | CDP 클라이언트·브라우저 실행/연결 관리 |
| `cli/src/native/snapshot.rs` | 페이지 스냅샷 |
| `cli/src/native/element.rs` | 요소 참조 해석 |
| `cli/src/native/interaction.rs` | 사용자 행동 실행 |
| `cli/src/native/network.rs` | 네트워크 기능 |
| `cli/src/native/recording.rs` | 영상 기록 |
| `cli/src/native/screenshot.rs` | 스크린샷 |
| `cli/src/native/tracing.rs` | 추적 기능 |
| `cli/src/skills.rs` | `skills/`와 `skill-data/` 구분 및 검색 |
| `skill-data/core/SKILL.md` | 브라우저 조작·세션·MCP 사용 지침 |
| `skill-data/dogfood/SKILL.md` | QA 6단계, 재현·증거 수집·보고 절차 |
| `skill-data/dogfood/references/issue-taxonomy.md` | 심각도·이슈 유형·체크리스트 |
| `skill-data/dogfood/templates/dogfood-report-template.md` | Markdown 이슈 보고서 필드 |

## 9. 최종 정리

**확인된 사실:** agent-browser는 Rust CLI/데몬/CDP 기반의 브라우저 자동화 실행 계층을 제공한다. Dogfood는 AI에게 탐색적 QA와 재현 증거 수집 절차를 알려주는 스킬이며, 결과를 Markdown 보고서로 정리한다.

**프로젝트 설계 제안:** WebTestPilot은 크롤러 JSON을 활용해 탐색을 계획하고, 브라우저 엔진으로 행동을 실행하며, Evidence-Guided Skill을 통해 AI가 근거를 검토하고 최종 판단하도록 구성한다. 최종 출력은 독립된 JSON 계약으로 검증해 보고서 생성기로 전달한다.

**분석 범위:** ZIP의 핵심 소스 파일 및 Core/Dogfood 문서를 정적 확인했다. 전체 함수 호출 그래프, 모든 브라우저 백엔드, 성능 및 실제 QA 정확도까지 검증한 문서는 아니다.
