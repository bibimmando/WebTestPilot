# 팀원 4 작업 공간

- 이름 / GitHub 아이디: shlee705
- 담당 모듈: 미정
- 작업 브랜치: `development` (기능 브랜치 `feature/member-04/<작업명>`는 선택)
- 개발 변경은 `development`에 승인 없이 직접 push할 수 있다.
- `main` 반영은 `development` → `main` PR의 승인·CI 통과 후 총괄 담당자가 병합한다.


admin page - 축소버전
https://github.com/shlee705/email_page/tree/bug-page
- [기능 결함 3개](functional.md)
  [F2](functional.md#f2-email-내-compose-송신-실패) | 기능 | Email 내 Compose 송신 실패
  [F3](functional.md#f3-계정-선택-후-현재-계정-유지) | 기능 | 계정 선택 후 현재 계정 유지
  [F4](functional.md#f4-메일-열람-시-자동-읽음-처리-누락) | 기능 | 메일 열람 시 자동 읽음 처리 누락 
- [UI 결함 4개](ui.md)
  [U2](ui.md#u2-폴더라벨-활성-표시-누락) | UI | 폴더·라벨 활성 표시 누락
  [U3](ui.md#u3-계정-메뉴-버튼-겹침) | UI | 계정 메뉴 버튼 겹침
  [U4](ui.md#u4-사이드바-compose-시각적-누락) | UI | 사이드바 Compose 시각적 누락 
  [U5](ui.md#u5-다크-모드의-검정-글씨-유지) | UI | 다크 모드의 검정 글씨 유지
- [입력 검증 결함 3개](validation.md)
  [V6](validation.md#v6-미등록-수신자-발송-성공-및-sent-저장) | 입력 검증 | 미등록 수신자 발송 성공 및 Sent 저장
  [V7](validation.md#v7-수신자-형식-및-도메인-검증-누락) | 입력 검증 | 수신자 형식 및 도메인 검증 누락
  [V8](validation.md#v8-회원가입-비밀번호-최소-길이-검증-누락) | 입력 검증 | 회원가입 비밀번호 최소 길이 검증 누락
- [이동/라우팅 결함 1개](routing.md)
  [N2](routing.md#n2-new-mail의-존재하지-않는-페이지-연결) | 이동/라우팅 | New mail의 존재하지 않는 페이지 연결

