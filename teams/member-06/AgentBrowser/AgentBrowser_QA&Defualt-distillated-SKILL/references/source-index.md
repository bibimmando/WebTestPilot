# 입력 자료와 기능 대응

이번 스킬의 내용 근거는 사용자 제공 `agent-browser-main.zip`과 `WebTestPilot_Integrated_AI_Skill_Prompt.md` 두 파일이다. 작업 폴더의 기존 스킬·프로젝트·60 URL 데이터셋은 사용하지 않았다. 외부 원문 인용 목록은 비어 있다. 해당 데이터셋을 받으면 필요 범주별로 원문 접근, 문서 권위, 관련 절과 접근 실패를 따로 기록한다. 확인되지 않은 출처를 확인된 표준으로 취급하지 않는다.

ZIP 경로는 `agent-browser-main/` 아래 상대 경로다. `package.json`은 agent-browser 0.39.1, Apache-2.0, Node >=24, pnpm >=11을 선언한다. 이것은 원본 조건이며 본 스킬 의존성은 Python/Playwright/jsonschema다. 원본 `LICENSE`는 Apache License Version 2.0이다. 원본 소스와 문장을 복사하지 않고 동작 패턴을 새 코드·지침으로 작성했다.

`skills/agent-browser/SKILL.md`는 발견용 stub이다. 실제 Core/Dogfood는 `skill-data/core/SKILL.md`, `skill-data/dogfood/SKILL.md`이며 `cli/src/skills.rs`가 CLI 스킬 배포 구현이다. CLI 기능 존재와 본 runner 구현 여부를 구분한다.

| 원본 기능 | 근거 경로 | 결정 / Playwright 대응 |
|---|---|---|
| snapshot, @eN | core/references/snapshot-refs.md; cli/src/native/snapshot.rs | 수정: 의미 locator와 선택 DOM 관찰. @eN 호환·전체 AX 트리는 구현하지 않음 |
| click/fill/check/select/wait | core/SKILL.md; cli/src/native/actions.rs | 채택: locator API, 명시 대기, perform adapter |
| named session/auth restore | core/references/session-management.md; authentication.md; cli/src/native/auth.rs | 설계 채택: 기존 Page 재사용 우선. 독립 runner 인증 저장/복원 제외 |
| screenshot/annotation | core/SKILL.md; cli/src/native/actions.rs | 수정: opt-in mask screenshot; ref annotation 제외 |
| video/contact sheet | core/references/video-recording.md; cli/src/native/recording.rs | 조건부: 원본은 ffmpeg/codec 필요. runner 제외, 기존 실행기 확장점 |
| console/network/HAR/mock | core/SKILL.md; cli/src/native/network.rs | 수정: 이벤트 종류/HTTP 상태만 수집. HAR·응답 본문·mock 제외 |
| exploratory QA and taxonomy | dogfood/SKILL.md; dogfood/references/issue-taxonomy.md | 채택: 사용자 흐름 탐색, 후보 즉시 증거화. 네 범주와 Other로 정리 |
| retry gate / 5–10 bugs / mandatory video | dogfood/SKILL.md | 제외: AI 판단, 불확실성 보류, 필요 증거에 맞춘 수집 |
| Markdown report template | dogfood/templates/dogfood-report-template.md | 변경: versioned JSON contract. 최종 보고서 생성은 후속 역할 |
| WebMCP, React, axe, cloud, Electron | core/SKILL.md; 기타 skill-data | 제외: 기본 네 범주 검증 도구의 필수 의존성이 아님 |

지원 여부 확인은 첨부 ZIP의 스킬 문서·파일 구조를 기준으로 한다. 원본 CLI를 빌드하거나 실행하지 않았다. 원본 구현 파일에서 관련 심볼을 확인해 문서와의 대응을 점검했으나 전체 CLI 구현을 검증한 것은 아니다. 새 runner는 별도 구현이다. 실제 WebTestPilot API 연동, 외부 사이트 검증, AI SDK 도구 루프는 포함하지 않는다.
