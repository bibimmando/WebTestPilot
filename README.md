# WebTestPilot

웹사이트의 URL을 FIFO 큐로 순회하며 페이지 전처리, AI 테스트 계획, Playwright MCP 실행, 실행 증거 후처리, 별도 AI 판단을 연결하는 프로젝트입니다.

## 현재 개발 기준

현재 검사 프로그램은 **`teams/member-01/integration/`**에서 개발합니다.

1. [통합 개발 기준](teams/member-01/integration/DEVELOPMENT.md): 완료 범위, 담당 모듈, 연결 계약.
2. [설치·실행·출력 안내](teams/member-01/integration/README.md).
3. **AI팀: [판단용 JSON 연결 규격](teams/member-01/integration/docs/JUDGMENT_CONTRACT.md)** — `judge_input/2`, 응답, 이미지, 증거 ID 사용법.
4. [입력 예시](teams/member-01/integration/examples/judge_input.v2.example.json) · [응답 예시](teams/member-01/integration/examples/scenario_judgments.example.json).
5. [개발 문서 목록](docs/README.md).
6. [최근 실제 검사 결과·미완료 항목](docs/reviews/QA_SKILL_MAISON_TEST_2026-10-12.md).

```text
URL 큐 → 페이지 전처리 → AI 시나리오·실행 계획
→ 실행 AI ↔ Playwright MCP → 실행 결과 후처리
→ 판단 AI → 후보 재현·보고서 → 다음 URL
```

통합 프로그램의 API 키는 `teams/member-01/.env.example`을 같은 폴더의 `.env`로 복사해 로컬에 입력합니다. 설치·실행은 member-01 폴더에서 진행합니다.

```powershell
cd teams/member-01
python -m integration --url http://localhost:8080/ --provider mock --max-pages 3
```

`mock`은 연결 확인용이며 실제 AI 버그 판단을 수행하지 않습니다. 공식 Claude API·모델·스킬 설정은 통합 실행 안내를 따릅니다.

## 주요 경로

| 경로 | 용도 |
|---|---|
| `teams/member-01/integration/preprocessor/` | 페이지 전처리·URL 큐·수집 중 그래프 |
| `teams/member-01/integration/` | 계획·실행 AI·MCP·후처리·판단·재현·보고서 |
| `teams/member-01/integration/docs/`, `schemas/`, `examples/` | 협업 계약·JSON Schema·합성 예시 |
| `teams/member-01/skills/webtestpilot-qa-test-planner/` | 계획 작성에 사용하는 수정 스킬과 참조 파일 |
| `teams/member-03/maison/` | 팀원이 관리하는 테스트 사이트 |
| `teams/` | 팀별 담당 안내·프로토타입 |
| `webtestpilot-crawler/` | 기존 크롤러 참고 코드 |
| `output/`, `.tools/` | 로컬 실행 결과·설치 도구. Git 제외 |

제품 코드는 팀 폴더의 프로토타입을 import하지 않습니다. 최근 12페이지 실행에서는 112개 계획 중 85개 실행 완료, 후보 3건(F3·U5 두 유형), 재현 확정 0건이었습니다. 실제 탐지·재현의 보완 사항은 검사 결과 문서에 기록했습니다.

## 협업

- `development`: 개발 코드 직접 push 또는 필요에 따라 기능 브랜치 PR.
- `main`: 검증한 development 변경을 PR로 반영하며 `bibimmando`가 최종 병합.
- CI는 통합 프로그램의 전처리·계획·스킬·실행·MCP·초기화 검증을 실행합니다.

구체적인 Git 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)를 따릅니다.
