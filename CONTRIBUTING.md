# 팀 개발 규칙

AI로 구현을 작성하기 전에 [공용 개발·통합 가이드](docs/INTEGRATION_GUIDE.md)를 읽고 전처리기의 연결 계약을 따른다.

## 작업 순서

1. `development`를 최신 상태로 받는다.
2. 배정된 작업 폴더에서 개발하고 필요한 테스트를 실행한다.
3. 변경한 파일을 커밋하고 `development`에 직접 push한다. 승인 리뷰는 필요하지 않다.
4. push 후 GitHub Actions 결과를 확인하고 실패하면 수정한다.
5. 배포·데모 가능한 묶음은 `development` → `main` PR로 올린다.
6. 다른 팀원의 승인 리뷰 1개와 CI를 통과하면 `bibimmando`가 `main`에 병합한다.

```powershell
git switch development
git pull --ff-only origin development
# 배정된 폴더에서 개발하고 테스트한 후
git add <변경한-파일>
git commit -m "feat: 작업 설명"
git pull --rebase origin development
git push origin development
```

다른 팀원이 먼저 push했다면 다시 `git pull --rebase origin development`로 반영한다.
충돌을 해결한 뒤 테스트하고 일반 push한다. force push는 사용하지 않는다.
작업을 분리하고 싶으면 개인 기능 브랜치를 만들고 `development` 대상으로 PR을 올려도 된다.

## 병합과 리뷰

- `development`: 저장소 쓰기 권한이 있는 팀원이 직접 push하거나 PR을 병합할 수 있다. 승인·CI는 push 전 강제 조건이 아니며 CI는 push 후 자동 실행된다.
- `main`: 직접 push하지 않는다. 같은 저장소의 `development`에서 만든 PR만 받는다.
- `main`에는 다른 사람의 승인 리뷰 1개, 마지막 push 작성자 이외의 승인, 리뷰 대화 해결과 `Branch policy`·`Python tests` 통과가 필요하다. 새 커밋은 이전 승인을 무효화하며 최신 대상 브랜치를 반영해야 한다.
- `main`의 최종 병합 담당자는 `bibimmando` 한 명이다. 팀원에게 Admin 권한을 부여하지 않는다.
- 두 브랜치 모두 force push와 브랜치 삭제를 허용하지 않는다.

## 작업 폴더와 공통 코드

`teams/member-01`부터 `teams/member-06`까지 각자 한 폴더를 배정한다.
각 폴더 README에 이름·GitHub 아이디·담당 모듈을 적는다. 공통 패키지 수정이 필요한 경우
해당 모듈 담당자와 조율하고 커밋이나 PR에 영향 범위를 적는다.
페이지 전처리·URL 크롤러는 `teams/member-01/page-preprocessor/`에 있다.
기존 공통 구현은 `webtestpilot-crawler/webtestpilot_crawler/`에 있다.

## 비밀값과 실행 결과

API 키, 로그인 비밀번호, 인증 세션 파일은 커밋하지 않는다.
벤치마크 원본·브라우저 trace·실행 로그는 로컬에 보관하고, 공유할 때는 마스킹한 요약을 사용한다.
