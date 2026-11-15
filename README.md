# WebTestPilot

URL만 주면 사이트를 스스로 탐색해 기능을 찾고, 검사 계획을 세워 실행한 뒤 결함 후보를 판정하고 보고서를 만드는 QA 프로그램이다. 현재 제품 소스는 `qa/`(v2) 하나다.

## 개발 시작

먼저 [프로젝트 공통 지침](AGENTS.md)을 읽는다. 테스트 사이트는 검증 수단이며, 최종 목표는 사이트에 의존하지 않는 범용 QA 능력이다.

1. [qa 사용 안내](qa/README.md): 설치·실행·출력.
2. [v2 설계](docs/design/V2_ARCHITECTURE.md): 구조와 계약.
3. [작업 인수인계](docs/HANDOFF.md): 최근 변경·실측 결과·남은 일.
4. [개발 문서 목록](docs/README.md): 설계·리뷰·논문·공유 자료.
5. [팀 개발 규칙](CONTRIBUTING.md): development 개발과 main 반영.

## 설치와 검증

```powershell
npm install                       # 저장소 루트: Playwright
npx playwright install chromium   # 처음 한 번
cd qa
npm install
npm test                          # 무료 테스트(로컬 fixture 서버와 가짜 모델)
```

실제 실행(Claude API, 유료)은 [qa 사용 안내](qa/README.md)를 따른다. API 키는 환경변수 또는 루트 `.env`에 둔다(커밋하지 않는다).

## 디렉터리

| 경로 | 용도 |
|---|---|
| `qa/` | 제품 코드(`src/`)·프롬프트·테스트. 실행 결과는 `qa/runs/`(Git 제외) |
| `docs/` | 설계·인수인계·리뷰·멘토링·발표·논문·공유 PDF |
| `eval/` | 평가용 변형 앱과 사후 채점 자료(계획·실행 입력에 넣지 않는다) |
| `teams/member-01/` ~ `teams/member-06/` | 담당 안내 |
| `archives/` | 이전 프로토타입 코드 보관(Git 제외) |
| `.claude/`·`.codex/` | Claude Code·Codex CLI 설정 |
| `.github/` | CI(qa 무료 테스트)와 PR 양식 |
| `.env` | 로컬 API 키·테스트 계정. Git 제외 |

## 협업

- `development`: 직접 push하거나 필요에 따라 기능 브랜치 PR을 사용한다.
- `main`: 검증한 development 결과를 PR로 반영하고 `bibimmando`가 최종 병합한다.
- 개인 폴더는 담당 구분이며 폴더별 GitHub 쓰기 권한 제한은 아니다.

CI의 `QA tests`는 qa의 타입 검사와 무료 테스트를 돌린다. 유료 API는 부르지 않는다.
