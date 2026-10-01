# 팀 개발 규칙

## 작업 순서

1. `development`를 최신 상태로 받는다.
2. 개인 기능 브랜치를 만든다.
3. 배정된 작업 폴더에서 개발하고 필요한 테스트를 작성한다.
4. 기능 브랜치를 push하고 `development`를 대상으로 PR을 연다.
5. CI와 코드 리뷰를 통과하면 총괄 담당자가 병합한다.
6. 배포·데모 가능한 묶음은 `development` → `main` PR로 올린다.

```powershell
git switch development
git pull --ff-only origin development
git switch -c feature/member-01/작업명
# 개발 후
git add <변경한-파일>
git commit -m "feat: 작업 설명"
git push -u origin feature/member-01/작업명
```

## 병합과 리뷰

- `main`과 `development`에는 직접 push하지 않는다.
- 최종 병합 담당자는 한 명으로 지정한다. 팀원에게 Admin 권한을 부여하지 않는다.
- 변경된 코드에 맞는 테스트가 통과하고 리뷰 의견이 해결된 후 병합한다.
- `main` PR의 출발 브랜치는 같은 저장소의 `development`여야 한다.
- force push와 보호 브랜치 삭제는 허용하지 않는다.
- PR 작성자도 다른 팀원의 리뷰를 받는다.

## 작업 폴더와 공통 코드

`teams/member-01`부터 `teams/member-06`까지 각자 한 폴더를 배정한다.
각 폴더 README에 이름·GitHub 아이디·담당 모듈을 적는다. 공통 패키지 수정이 필요한 경우
해당 모듈 담당자와 조율하고 PR에 영향 범위를 적는다. 공통 구현의 최종 위치는
`webtestpilot-crawler/webtestpilot_crawler/`다.

## 비밀값과 실행 결과

API 키, 로그인 비밀번호, 인증 세션 파일은 커밋하지 않는다.
벤치마크 원본·브라우저 trace·실행 로그는 로컬에 보관하고, 공유할 때는 마스킹한 요약을 사용한다.

