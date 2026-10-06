# GitHub 협업 설정

저장소: https://github.com/bibimmando/WebTestPilot

## 브랜치와 권한

- 공개 저장소이며 기본 브랜치는 `main`이다.
- `development`는 팀 개발 결과를 통합한다. 저장소 쓰기 권한이 있는 팀원은 승인 없이 직접 push하거나 PR을 병합할 수 있다.
- `main`의 병합 담당자는 `bibimmando` 한 명이다.
- `main`에는 같은 저장소의 `development`에서 만든 PR만 올린다.
- 팀원은 Collaborator로 초대하며 Admin 권한을 추가하지 않는다.

## 보호 규칙

### development

- `Development branch safety`: force push와 브랜치 삭제만 차단한다.
- PR·승인 리뷰·필수 CI를 push 조건으로 요구하지 않는다.
- GitHub Actions는 push 후 자동 실행된다. 실패한 변경은 팀원이 수정한다.

### main

1. PR을 통해서만 변경한다. 직접 push는 차단한다.
2. 다른 사람의 승인 리뷰 1개가 필요하다. 마지막 push 작성자가 자신의 변경을 승인할 수 없다.
3. 새 커밋을 올리면 이전 승인 리뷰를 다시 받는다.
4. 리뷰 대화를 해결해야 한다.
5. `Branch policy`와 `Python tests` 검사를 통과해야 한다.
6. 최신 대상 브랜치를 반영해 검사해야 한다.
7. force push와 브랜치 삭제를 차단한다.

`Owner-only protected branch updates`와 `Required reviews and CI`는 `main`에만 적용한다.
첫 번째 규칙은 `bibimmando`에게만 PR 병합 경로를 허용하며 두 번째 규칙에는 예외가 없다.
따라서 병합 담당자도 CI와 리뷰를 생략할 수 없다. 저장소 소유자는 설정 자체를 관리할 수 있다.

## 6명 작업 공간

| 폴더 | 담당자 |
|---|---|
| `teams/member-01/` | bibimmando — 총괄·병합 |
| `teams/member-02/` | 배정 예정 |
| `teams/member-03/` | 배정 예정 |
| `teams/member-04/` | 배정 예정 |
| `teams/member-05/` | 배정 예정 |
| `teams/member-06/` | 배정 예정 |

폴더는 양쪽 브랜치에 동일하게 존재한다. Git 브랜치별로 별도의 권한 체계가 있는 디렉터리는 아니다.
개인 폴더는 작업 구분을 위한 것이며 저장소 쓰기 권한이 있는 팀원은 다른 폴더도 수정할 수 있다.
각 폴더의 README에 담당자와 모듈을 기록한다.

## 팀원 초대

Settings → Collaborators → Add people에서 팀원 5명의 GitHub 아이디로 초대한다.
초대를 수락하면 `development`에 직접 push하고 승인 리뷰를 남길 수 있다.
`main` PR은 병합 담당자가 작성했더라도 다른 팀원의 승인 리뷰가 필요하다.

개발 명령과 PR 양식은 루트 `CONTRIBUTING.md`와 `.github/pull_request_template.md`를 참고한다.
