# WebTestPilot

6명이 함께 개발하는 웹 애플리케이션 테스트 프로젝트다.

## 브랜치 흐름

```text
feature/member-01/<작업명> ─┐
feature/member-02/<작업명>  │
...                        ├─ PR → development ─ PR → main
feature/member-06/<작업명> ─┘
```

- `main`: 테스트를 통과한 안정 버전. `development`에서 올린 PR만 받는다.
- `development`: 팀 개발 결과를 통합하는 브랜치.
- `feature/member-NN/<작업명>`: 각 팀원의 실제 작업과 push 대상.
- `main`과 `development`의 최종 병합은 지정한 총괄 담당자만 수행한다.

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

프로젝트 설치와 실행은 [크롤러 README](webtestpilot-crawler/README.md)를 참고한다.
브랜치 생성, PR, 병합 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)를 따른다.
GitHub 설정은 [설정 안내](docs/GITHUB_SETUP.md)에 정리되어 있다.

