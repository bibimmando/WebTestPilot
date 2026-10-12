# QA 스킬 작업 인수인계 — 2026-10-12

## 현재 상태

**재개 후 통합 제품의 계획 작성 단계에 공식 Claude Skills 연결을 완료했다.**
등록 스킬의 파일 읽기, 컨테이너 이어가기, 호출·시간·취소 한도, 실제 JSON 계획 검증을 연결했다.
제품 코드로 가상 폼을 실제 Opus 5.5에 호출해 입력 검증 시나리오 두 개를 생성·검증했다.
아래 최초 등록 테스트 기록과 마지막 재개 기록을 함께 참고한다.

## 프로젝트 기준

- 제품 소스: `integration/`. 현재 실행 구조는 `integration/DEVELOPMENT.md`를 기준으로 읽는다.
- 흐름: 전처리 → 계획 AI → 실행 AI와 Playwright MCP → 증거 정리 → 별도 판단 AI → 재현·보고서.
- 검사 범위: `functional`, `input_validation`, `routing`, `ui`.
- 모든 URL을 FIFO로 탐색하고 탐색하면서 그래프를 만든다. 이 스킬이 URL 탐색 정책을 변경하지 않는다.
- 계획의 동작·입력값·기대 결과는 실행 전에 고정한다. 실제 결과를 보고 기대 결과를 바꾸지 않는다.
- 디자인 없이 UI의 가림·잘림·조작 방해·오류 안내를 검사한다. 제공되지 않은 디자인 수치를 정답으로 만들지 않는다.

## 완료한 스킬 수정

원본 `softaworks/agent-toolkit/skills/qa-test-planner`를 현재 범위로 재구성했다.
보안·성능·Figma 대조·릴리스 관리 지침을 제외하고 실행 가능한 시나리오 설계와 상태 의존 지침을 유지했다.
참고 자료는 별도 Markdown 파일로 연결했고, 원본 MIT 라이선스를 보존했다.

프로젝트 보관 위치:

```text
skills/webtestpilot-qa-test-planner/
├─ SKILL.md
├─ LICENSE
└─ references/
   ├─ test_case_templates.md
   ├─ regression_testing.md
   └─ test-plan-v2.md
```

동일한 수정본은 이 컴퓨터의 `C:/Users/lsc05/Desktop/webtestpilot-qa-test-planner/`에도 있다.
스킬 형식 검사, 내부 참조 파일 존재 검사, JSON 예시의 실제 계획 검증을 통과했다.

## 등록된 공식 Claude 스킬

| 항목 | 값 |
|---|---|
| 이름 | webtestpilot-qa-test-planner |
| skill_id | skill_01KhB92UZNb864EEV2PKfVHH |
| 검증한 버전 | skver_015Z2MbbXrku6CFfxrVUb8DL |
| 등록 유형 | custom |
| 호출 모델 | claude-opus-5-5 |

루트 `.env`의 `ANTHROPIC_API_KEY`로 공식 API 목록에서 등록을 확인했다.
키 값은 이 문서·스킬·테스트 산출물에 저장하지 않는다.
다른 환경에서는 해당 스킬이 등록된 API workspace에 접근할 수 있는 키가 필요하다.

## 실제 API 테스트 결과

- 생성 요청 1회, 약 **15.69초**.
- 입력 토큰 **31,398**, 출력 토큰 **1,071**. 이번 요청은 모든 참조 파일 읽기를 명시적으로 요구했다.
- Claude가 서버의 code execution 도구로 `SKILL.md`와 참고 Markdown 세 개를 실제로 읽었다.
- 서버 읽기 동작 두 번 모두 종료 코드 0, stderr 없음.
- 읽은 네 파일의 내용이 바탕화면 수정본과 일치함을 프로그램으로 확인했다.
- 가상의 이메일 폼에 대해 입력 검증 계획 한 개를 생성했다.
- 계획: `not-an-email` 입력 → 제출 버튼 클릭 → 제출 차단·검증 상태·오류 안내를 관찰할 기대 결과 작성.
- `qa_test_plan` 호출 정확히 1회. 현재 도구 JSON Schema와 `validate_plan` 검증 통과.
- 실제 사이트 검사나 버그 판정은 수행하지 않은 등록·참조 읽기·계획 생성 테스트다.

보관한 결과:

- [검증 요약](qa-skill-api-smoke-2026-10-12/summary.json)
- [생성한 계획](qa-skill-api-smoke-2026-10-12/test-plan.json)
- [실제 모델 응답과 서버 파일 읽기 결과](qa-skill-api-smoke-2026-10-12/response-1.json)

실험용 호출 스크립트·요청·원본 기록은 `.tools/skills-api-smoke-20261012/`에 있다.
원본 스킬과 수정 작업본은 `.tools/qa-test-planner-review-20261012/`에 있다.
`.tools/`는 Git에서 무시되므로 집에서 참고할 핵심 스킬·결과는 위 프로젝트 경로에 별도로 보관했다.

## 최초 인수인계의 후속 목록 — 재개 후 1~5 완료

1. `integration/models.py`의 공식 Claude 요청에 스킬 ID·버전과 `code_execution` 도구를 전달할 수 있도록 연결한다.
2. `integration/staged.py`의 **계획 작성 단계**에서 수정 스킬을 사용한다. 실행·판정 단계와 구분한다.
3. 스킬 참조 읽기의 server tool 응답과 필요시 `pause_turn`을 처리한다. 스킬 파일 읽기는 브라우저 테스트 행동이 아니다.
4. 최종 `qa_test_plan` 인자는 기존 `plan_contract.py`로 검증한다. 코드가 저장하는 `test_plan/2` 규격을 유지한다.
5. 취소·시간·호출 한도와 사용량 기록이 스킬 요청에도 적용되도록 한다. 오류 재시도는 기존 유한한 정책을 유지한다.
6. 통합 후 작은 계획 생성 검사부터 확인하고, 이후 테스트 페이지에서 기능 흐름의 깊이·시간·토큰을 비교한다.

최초 중단 때 HTTPModel의 `container.skills` 연결은 미구현이었다. 재개 후 아래 기록의 수정으로 연결했다.
실제 Maison 사이트의 검사 깊이·탐지 성능 비교는 이번 스킬 연결 검증에 포함하지 않았다.

## 재개 후 완료 기록

- `integration/models.py`: 등록 skill ID·버전과 code execution 도구 전달, container 응답·pause_turn 검증, 스킬별 사용량 기록.
- `integration/staged.py`: 계획·계획 수정에서 스킬 사용, 같은 컨테이너·대화로 pause_turn 이어가기, 요청마다 공통 한도·시간·취소와 증거 저장.
- `integration/__main__.py`: `--planning-skill-id`, `--planning-skill-version` 및 `.env` 연결. 실행·판정 모델에는 스킬을 전달하지 않음.
- 루트 `.env`에 이 프로젝트의 확인된 ID·고정 버전을 추가. 키는 노출하거나 변경하지 않음. 공개용 `.env.example`은 빈 설정 예시.
- `integration/test_skills.py`: 스킬 전송·연속 응답·호출/턴 한도·취소·단계 분리·CLI 설정 검사.
- 통합 README·개발 기준·CI에 사용법과 검증 명령 반영.

유료 API를 사용하지 않은 검증:

```text
integration.test_skills       PASS
integration.test_performance  PASS
integration.test_integration  PASS (실제 로컬 MCP)
integration.test_staged       PASS
integration.test_regressions  PASS (초기화·시간 한도·취소)
```

Windows 샌드박스 안에서는 asyncio 내부 socketpair 생성이 정지하여 해당 로컬 테스트를 종료하고,
승인된 외부 실행으로 검증했다. 코드 실패와 환경 제약을 구분한다.

제품 코드의 실제 API 확인:

- 가상 폼 정보로 `_plan` → HTTPModel → 공식 Claude API를 호출했다. 실제 사이트 접속·초기화·조작 없음.
- Opus 5.5 생성 요청 1회, 계획 수정 0회, server tool 읽기 1회, 약 15.09초.
- 입력 19,085토큰, 출력 1,272토큰. SKILL.md와 JSON 연결 규격을 실제 읽고 반환했다.
- `not-an-email`, `user@` 두 입력을 각각 제출하는 시나리오를 생성했고 현재 test_plan/2 검증을 통과했다.
- 기록: [제품 연결 검증 결과](qa-skill-product-check-2026-10-12/result.json), [실제 API 응답](qa-skill-product-check-2026-10-12/planning_response.json).
- 실행 스크립트와 원본은 `.tools/skills-api-integration-20261012/`에 있다.

### 다음 실험

현재 스킬 설정을 적용한 작은 실제 사이트 실행에서 기능 결과까지 검사하는 시나리오가 늘었는지 확인한다.
이메일 두 입력의 생성 성공은 사이트 전체의 검사 품질·버그 탐지 개선을 입증하지 않는다.
비교 시 동일한 사이트 버전·시작 상태·요구사항·페이지/행동/시간 예산을 사용하고, 버그 정답표는 평가에만 사용한다.

## 작업 보존과 Git

이번 작업에서 Git commit/push는 수행하지 않았다.
작업 트리에는 이전 통합·파일 정리 변경이 많이 남아 있다. 이어서 작업할 때 기존 변경을 일괄 되돌리거나 전체를 무분별하게 커밋하지 않는다.
현재 작업의 핵심 파일은 `skills/webtestpilot-qa-test-planner/`와 이 인수인계 문서·연결된 테스트 기록이다.

## 공식 참고 자료

- [Claude API Skills 등록·호출](https://platform.claude.com/docs/en/build-with-claude/skills-guide)
- [참고 파일을 필요할 때 읽는 구조](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview#how-skills-work)
