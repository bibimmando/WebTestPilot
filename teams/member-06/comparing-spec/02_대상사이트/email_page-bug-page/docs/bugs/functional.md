# 기능 결함 상세

기준일: 2026-11-02 (Asia/Seoul). 사용자가 요청하여 추가한 결함만 수록한다. 기존 결함 ID를 유지한다.

[유형별 개수 및 요약](overview_buf.md) · [문서 안내](bugs.md)

## F2: Email 내 Compose 송신 실패

| 항목 | 값 |
|---|---|
| Bug ID | F2 |
| 유형 | functional |
| 구현 상태 | 검증 완료 |
| 수정 파일 | src/assets/scripts/2026/email/ui.js |
| 기준일 | 2026-11-01 |

### 1. 버그 개요

email.html 내부 작성 모달에서만 발송이 실패한다. 답장·전달도 같은 모달을 사용하므로 영향을 받는다.

### 2. 정상 기대 동작 (Expected Behavior)

내부 모달과 compose.html 전용 페이지 모두 수신자의 Inbox에 메일을 전달한다.

### 3. 결함 동작 (Actual Defective Behavior)

내부 모달은 발송 오류를 표시하며 발송 API를 호출하지 않는다. 수신자 Inbox 및 발신자 Sent에 새 메일이 없다. 전용 페이지는 정상 발송한다.

### 4. 재현 조건 (Preconditions)

서버 실행 후 test / testtesttest, admin / adminadminadmin 사용. 기본 내부 메일 모드. Chrome PC(1440×900), 모바일(390×900).

### 5. 재현 절차 (Steps to Reproduce)

1. test로 로그인하고 Email의 Compose를 누른다.
2. 수신자 admin@adminator.test, 고유 제목과 본문을 입력하고 Send를 누른다.
3. 오류와 수신자 미수신을 확인한다.
4. 주소창에서 /compose.html로 직접 이동하거나 좌측의 숨겨진 Compose 영역을 클릭해 같은 메일을 보내고 admin으로 수신을 확인한다.

### 6. 예상 관찰 결과

Message could not be sent. Please try again. 표시. 모달 입력은 남아 있고 전용 작성 페이지에서는 delivered-internal 성공 상태가 표시된다.

### 7. 버그 구현 방법

폼 submit에서 standalone이 false이면 service.sendEmail 호출 전에 예외를 발생시킨다. 서버 송신 구현은 정상 유지한다.

### 8. 탐지 방법

발송 경로별 화면 오류, /api/mail/send 요청 유무, 두 계정의 Sent/Inbox를 비교한다.

### 9. 검증 기준

내부 모달 실패와 전용 페이지 성공을 모두 재현해야 한다. Mock 모드는 원래 실제 전달하지 않으므로 내부 메일 모드로 판정한다.

### 10. 검증 결과

2026-11-01: npm run test:bugs:e2e 통과. Chrome 1440×900 및 390×900에서 결함 재현과 전용 Compose 발송·Add account 정상 동작을 확인했다. 정상 동작을 기대하는 기존 이메일 E2E는 이 결함에서 실패하는 것이 의도된 결과다.

## F3: 계정 선택 후 현재 계정 유지

| 항목 | 값 |
|---|---|
| Bug ID | F3 |
| 유형 | functional |
| 구현 상태 | 검증 완료 |
| 수정 파일 | src/assets/scripts/2026/auth/accounts-ui.js |
| 기준일 | 2026-11-01 |

### 1. 버그 개요

Switch Account에서 다른 계정을 선택해도 활성 계정이 바뀌지 않는다.

### 2. 정상 기대 동작 (Expected Behavior)

추가된 다른 계정을 선택하면 사용자 정보와 메일함이 그 계정으로 전환된다.

### 3. 결함 동작 (Actual Defective Behavior)

선택 모달이 닫히고 새로고침되지만 전환 직전 계정이 그대로 유지된다.

### 4. 재현 조건 (Preconditions)

서버 실행 후 test / testtesttest, admin / adminadminadmin 사용. 기본 내부 메일 모드. Chrome PC(1440×900), 모바일(390×900).

### 5. 재현 절차 (Steps to Reproduce)

1. admin으로 로그인한다.
2. Switch Account → Add account에서 test를 추가한다. 추가 성공 시 기존 정상 동작대로 test가 활성화된다.
3. 다시 Switch Account를 열어 admin을 선택한다.
4. test 계정과 메일함이 유지되는지 확인한다.

### 6. 예상 관찰 결과

목록에는 두 계정이 존재하나 선택 후 /api/auth/me도 test를 반환한다.

### 7. 버그 구현 방법

선택 버튼은 account.id 대신 client.user.id를 switchAccount에 전달한다. Add account의 비밀번호 검증과 추가 처리는 유지한다.

### 8. 탐지 방법

선택한 계정 ID, switch 요청 accountId, 서버 /api/auth/me 및 화면 사용자 이름을 비교한다.

### 9. 검증 기준

Add account 성공 후 다른 계정 선택 시 전환 직전 사용자 ID가 유지되어야 한다.

### 10. 검증 결과

2026-11-01: npm run test:bugs:e2e 통과. Chrome 1440×900 및 390×900에서 결함 재현과 전용 Compose 발송·Add account 정상 동작을 확인했다. 기존 정상 계정 전환 E2E와 기대 결과가 반대다.

## F4: 메일 열람 시 자동 읽음 처리 누락

| 항목 | 값 |
|---|---|
| Bug ID | F4 |
| 유형 | functional |
| 구현 상태 | 검증 완료 |
| 수정 파일 | src/assets/scripts/2026/email/ui.js |
| 기준일 | 2026-11-01 |

### 1. 버그 개요

메일 내용을 열어도 자동으로 읽음 처리되지 않는다. 내부 메일과 Mock 메일의 공통 상세 열람 경로에 적용한다.

### 2. 정상 기대 동작 (Expected Behavior)

읽지 않은 메일을 열면 isRead가 true로 저장되고 목록의 미읽음 강조와 폴더의 unread 수가 갱신된다.

### 3. 결함 동작 (Actual Defective Behavior)

본문은 열리지만 isRead는 false로 남는다. 새로고침 후 다시 열어도 미읽음 상태와 unread 수가 유지된다. 수동 Mark read 버튼은 정상 작동한다.

### 4. 재현 조건 (Preconditions)

admin 계정에 읽지 않은 메일이 있어야 한다. F2 때문에 새 메일 준비는 test 계정의 compose.html 전용 페이지에서 admin@adminator.test로 발송한다. F3 때문에 두 계정은 별도 브라우저 세션을 사용한다.

### 5. 재현 절차 (Steps to Reproduce)

1. test / testtesttest로 로그인하고 전용 Compose에서 admin에게 고유 제목의 메일을 보낸다.
2. 별도 브라우저 세션에서 admin / adminadminadmin으로 로그인한다.
3. Inbox의 새 메일을 열어 본문을 확인한다.
4. 미읽음 강조와 폴더 unread 수가 유지되는지 확인한다.
5. 새로고침 후 다시 열어도 미읽음 상태인지 확인한다.
6. 수동 Mark read를 클릭하면 읽음으로 바뀌는지 대조한다.

### 6. 예상 관찰 결과

본문 표시 후에도 목록의 data-read는 false, 상세 버튼은 Mark read, 서버 응답의 isRead는 false다. U2로 현재 폴더 제목은 숨겨져 있으므로 unread 수는 폴더 버튼에서 확인한다.

### 7. 버그 구현 방법

select(id)에서 getEmailById 이후 자동 markAsRead 호출을 생략한다. 상세 표시와 수동 읽음/미읽음 변경 API는 유지한다.

### 8. 탐지 방법

본문 열람 전후의 목록 강조, 폴더 unread 수, GET /api/mail/emails/{id}의 isRead를 비교한다. 열람 시 자동 읽음 PATCH 요청이 발생하지 않는다.

### 9. 검증 기준

열람 및 새로고침 후 재열람에도 unread가 유지되고 수동 Mark read만 성공해야 한다. 기존 F2·F3·U2도 계속 재현되어야 한다.

### 10. 검증 결과

2026-11-01: npm run test:bugs:e2e 통과. Chrome PC(1440×900) 및 모바일(390×900)에서 열람·재열람 후 isRead=false 유지, 수동 Mark read 성공 및 기존 F2·F3·U2 재현을 확인했다. 빌드와 JS 린트도 통과했다.
