# WebTestPilot

6명이 함께 개발하는 웹 애플리케이션 테스트 프로젝트다.

## 브랜치 흐름

```text
팀원 개발 → development에 직접 push → 승인 리뷰·CI → main PR 병합
                    ↑
개인 기능 브랜치 ─ PR (선택)
```

- `main`: 테스트를 통과한 안정 버전. `development`에서 올린 PR만 받는다.
- `development`: 팀원이 승인 없이 직접 push할 수 있는 통합 브랜치. CI는 push 후 자동 실행된다.
- `feature/member-NN/<작업명>`: 작업 분리를 위한 선택 기능 브랜치.
- `main`에는 승인 리뷰 1개와 필수 CI가 필요하며 `bibimmando`만 최종 병합한다.
- 두 브랜치 모두 force push와 브랜치 삭제를 차단한다.

## 디렉터리

| 경로 | 용도 |
|---|---|
| `webtestpilot-crawler/` | 공통 Python 패키지와 검증된 구현 |
| `teams/member-01/` ~ `teams/member-06/` | 개인별 실험·작업 공간 |
| `docs/` | 협업 규칙과 GitHub 설정 안내 |
| `.github/` | CI와 PR 양식 |

개인별 디렉터리는 작업 구분을 위한 것이다. GitHub의 접근 권한은 저장소 단위이므로
팀원이 자신의 폴더에만 쓸 수 있도록 제한하는 기능은 아니다.

## 개발 시작

페이지 전처리·URL 크롤러의 설치·실행·출력 구조는 [member-01 사용 안내](teams/member-01/README.md)를 참고한다.
기존 패키지는 [크롤러 README](webtestpilot-crawler/README.md)에 정리되어 있다.
브랜치 생성, PR, 병합 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)를 따른다.
GitHub 설정은 [설정 안내](docs/GITHUB_SETUP.md)에 정리되어 있다.

