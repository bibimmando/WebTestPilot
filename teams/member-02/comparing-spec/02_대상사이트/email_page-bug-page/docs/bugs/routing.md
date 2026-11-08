# 이동 및 라우팅 결함 상세

기준일: 2026-11-02 (Asia/Seoul). 사용자가 요청한 결함만 수록한다.

[유형별 개수 및 요약](overview_buf.md) · [문서 안내](bugs.md)

## N2: New mail의 존재하지 않는 페이지 연결

| 항목 | 값 |
|---|---|
| Bug ID | N2 |
| 유형 | routing |
| 구현 상태 | 검증 완료 |
| 수정 파일 | src/assets/scripts/2026/Shell.js |
| 발생 위치 | 오른쪽 위 New mail 링크 |

### 1. 버그 개요

Compose 전용 페이지로 연결하려던 상단 New mail의 링크가 잘못되어 존재하지 않는 /NewMail page로 이동한다. 해당 페이지 파일이나 서버 라우트는 만들지 않는다.

### 2. 정상 기대 동작 (Expected Behavior)

상단 New mail을 누르면 /compose.html로 이동해 전용 메일 작성 폼을 표시해야 한다.

### 3. 결함 동작 (Actual Defective Behavior)

/NewMail page로 이동하고 서버가 404를 반환한다. 브라우저 URL의 공백은 %20으로 인코딩되어 /NewMail%20page가 된다. Compose 폼은 나타나지 않는다.

### 4. 재현 조건 (Preconditions)

test / testtesttest로 로그인 후 email.html 사용. Chrome PC 1440×900 및 모바일 390×900.

### 5. 재현 절차 (Steps to Reproduce)

1. 로그인 후 오른쪽 위 New mail을 누른다.
2. 주소가 /NewMail%20page인지 확인한다.
3. 404 응답과 작성 폼 부재를 확인한다.
4. 뒤로 가기로 Email에 돌아간다.
5. 주소창에서 /compose.html로 직접 이동하거나 좌측의 숨겨진 Compose 영역을 클릭하면 전용 작성 페이지가 열리는지 대조한다.

### 6. 예상 관찰 결과

상단 링크를 통한 이동만 잘못된 경로로 이루어진다. 존재하지 않는 페이지에 대한 서버 오류 응답이 표시되며 URL은 /compose.html이 아니다.

### 7. 버그 구현 방법

Shell.js의 상단 New mail 앵커 href를 compose.html에서 /NewMail page로 바꾼다. 사이드바 Compose 링크와 실제 compose.html 파일 및 서버의 404 처리는 유지한다.

### 8. 탐지 방법

href, 클릭 후 URL, 문서 요청 HTTP 404, Compose 폼 부재를 확인한다. 뒤로 가기로 Email 복귀 및 기존 직접 Compose 진입도 확인한다.

### 9. 검증 기준

PC·모바일에서 New mail 클릭 시 존재하지 않는 페이지로 이동하고 404가 나와야 한다. 기존 10개 결함도 계속 재현되어야 한다. 다른 결함을 검사할 때 전용 Compose는 /compose.html로 직접 접근한다.

### 10. 검증 결과

2026-11-02: npm run test:bugs:e2e 통과. Chrome PC(1440×900)·모바일(390×900)에서 상단 New mail만 /NewMail%20page로 이동하여 HTTP 404가 반환되고 작성 폼이 없는 것을 확인했다. 뒤로 가기로 Email에 복귀하고 좌측의 숨겨진 Compose 링크를 일반 클릭하면 정상 /compose.html로 이동하는 것도 확인했다. 기존 10개 결함이 함께 재현됐다. npm run build 및 npm run lint:js 통과.
