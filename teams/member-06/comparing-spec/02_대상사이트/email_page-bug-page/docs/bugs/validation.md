# 입력 검증 결함 상세

기준일: 2026-11-02 (Asia/Seoul). 사용자가 요청하여 추가한 결함만 수록한다. 기존 결함 ID를 유지한다.

[유형별 개수 및 요약](overview_buf.md) · [문서 안내](bugs.md)

## V6: 미등록 수신자 발송 성공 및 Sent 저장

| 항목 | 값 |
|---|---|
| Bug ID | V6 |
| 유형 | validation |
| 구현 상태 | 검증 완료 |
| 수정 파일 | backend/mail.py |
| 기준일 | 2026-11-02 |
| 발생 위치 | compose.html → POST /api/mail/send |

### 1. 버그 개요

수신자 계정의 존재·활성 여부 검증을 누락하여 미등록 주소로 발송해도 성공하고 Sent에 DB 레코드가 저장된다. UI에서 전용 Compose로 재현한다. Email 내부 모달은 F2로 발송 전에 실패한다.

### 2. 정상 기대 동작 (Expected Behavior)

To/Cc/Bcc 중 미등록 또는 비활성 계정이 있으면 서버가 422를 반환하고 발신자의 Sent와 수신자 Inbox 어느 쪽에도 저장하지 않는다.

### 3. 결함 동작 (Actual Defective Behavior)

미등록 수신자는 배달 대상에서 조용히 생략한다. 발신자에게는 201 및 delivered-internal 성공을 반환하며 주소를 포함한 전체 메일을 Sent에 저장한다. 같은 요청에 유효한 계정이 있으면 그 계정에는 정상 배달한다. 모든 수신자가 미등록이어도 성공한다.

### 4. 재현 조건 (Preconditions)

서버 실행 후 test / testtesttest로 로그인. hi@adminator.test가 없는 DB에서 내부 메일 모드 사용. Mock 모드는 원래 실제 배달하지 않으므로 판정에 사용하지 않는다. V6 단독 주입 시 주소 형식·필수 제목/본문 검증을 유지하고 계정 존재 검증만 누락했다. 현재 조합에서는 V7이 주소 형식 검증도 생략한다.

### 5. 재현 절차 (Steps to Reproduce)

1. 주소창에서 /compose.html로 직접 이동한다. 상단 New mail은 N2로 존재하지 않는 페이지에 연결된다.
2. To에 hi@adminator.test, 고유 제목과 본문을 입력한다.
3. Send를 누르고 성공 메시지를 확인한다.
4. email.html의 Sent를 열어 방금 보낸 메일을 확인한다.
5. 새로고침 또는 서버 재시작 후에도 동일 메일이 조회되는지 확인한다.
6. 유효한 admin@adminator.test를 Cc에 함께 입력한 경우 admin의 Inbox에는 실제 배달되는지 대조한다.

### 6. 예상 관찰 결과

미등록 주소임에도 오류 없이 성공하며 Sent의 해당 메일에 수신자 주소가 남는다. DB internal_mail의 발신자 소유 행에 folderId=sent로 저장된다. 미등록 계정의 Inbox 행이나 예약 배달 레코드는 생성하지 않는다.

### 7. 버그 구현 방법

backend/mail.py의 send에서 계정 조회 실패 시 HTTPException 대신 continue한다. 발신자 메일 저장·커밋과 성공 응답은 그대로 실행한다. 직접 API 호출에도 동일 결함이 적용된다. To/Cc/Bcc 모두 적용되며 비활성 계정도 같은 경로로 생략한다.

### 8. 탐지 방법

가입되지 않은 주소로 발송 후 HTTP 201, 성공 안내, Sent의 재조회 및 DB 저장을 대조한다. 활성 계정이 섞인 요청은 해당 계정의 Inbox도 확인한다. 재시도 중복 방지는 유지한다.

### 9. 검증 기준

미등록 수신자 발송이 성공하고 Sent에 영속 저장되어야 한다. 유효한 수신자 배달과 기존 6개 결함이 유지되어야 한다. 나중에 해당 주소로 가입해도 과거 메일을 소급 배달하지 않는 방식으로 구현했다. hi는 현재 가입 규칙의 최소 3자에 미달하므로 소급 여부 검증에는 missing@adminator.test를 사용한다.

### 10. 검증 결과

2026-11-02: backend/tests/test_unknown_recipient_bug.py 통과. 미등록 To/Bcc 수용, 등록된 Cc 배달, DB 직접 저장 확인, 서버 재시작 후 유지, 재시도 중복 방지, 후속 가입 시 소급 배달 없음 확인. npm run test:bugs:e2e도 Chrome PC(1440×900)·모바일(390×900)에서 통과하여 전용 Compose 성공 안내·Sent 표시와 기존 6개 결함을 함께 확인했다. npm run lint:js 통과. 모두 격리 DB를 사용했다.

## V7: 수신자 형식 및 도메인 검증 누락

| 항목 | 값 |
|---|---|
| Bug ID | V7 |
| 유형 | validation |
| 구현 상태 | 검증 완료 |
| 수정 파일 | src/assets/scripts/2026/email/model.js |
| 기준일 | 2026-11-02 |
| 발생 위치 | compose.html → validateMessage → POST /api/mail/send |

### 1. 버그 개요

수신자 주소 형식 검증을 생략해 다른 도메인과 로컬 부분이 빠진 주소도 발송 성공 및 Sent 저장된다. Registered @adminator.test recipients only 안내 문구는 유지되어 실제 허용 동작과 모순된다.

### 2. 정상 기대 동작 (Expected Behavior)

@af.asd처럼 로컬 부분이 없는 잘못된 주소는 프런트엔드가 거부해야 한다. 안내 기준으로 내부 계정 외 도메인도 거부해야 한다. 이전 V6 주입 시점에는 다른 도메인의 정상 형식 주소는 이미 서버에서 수용했지만, 잘못된 형식은 프런트엔드에서 거부했다.

### 3. 결함 동작 (Actual Defective Behavior)

someone@af.asd, @af.asd 모두 Send 성공 안내가 표시되고 Sent 및 DB에 주소 원문을 포함한 메일이 저장된다. Cc/Bcc도 형식 검증을 생략한다. 외부 SMTP 전송은 하지 않으며 미등록 수신자의 Inbox도 생성하지 않는다.

### 4. 재현 조건 (Preconditions)

test / testtesttest로 로그인하여 내부 메일 모드의 compose.html 전용 페이지 사용. Email 내부 모달은 F2로 발송 실패하므로 전용 페이지에서 재현한다. To 비어 있음, 빈 제목/본문, 라벨·첨부파일 검증은 기존대로 유지한다.

### 5. 재현 절차 (Steps to Reproduce)

1. 주소창에서 /compose.html로 직접 이동한다. 상단 New mail은 N2로 존재하지 않는 페이지에 연결된다.
2. To에 someone@af.asd, 고유 제목과 본문을 입력하여 Send한다.
3. 성공 상태 및 Sent 저장을 확인한다.
4. To를 @af.asd로 바꾸고 같은 과정을 반복한다.
5. Cc에 cc@other.example, Bcc에 @broken을 입력한 경우에도 성공하는지 확인한다.
6. Sent 재조회 및 새로고침 후 주소 원문이 보존되는지 확인한다.

### 6. 예상 관찰 결과

Invalid address 오류 없이 서버의 201/delivered-internal 성공 응답이 표시된다. Sent에 각 메일이 저장되고 재조회에서도 To/Cc/Bcc가 유지된다.

### 7. 버그 구현 방법

validateMessage의 To/Cc/Bcc 정규식 검사를 제거한다. 배열 형태와 필수 내용 검증은 유지한다. 공통 서비스이므로 Mock/REST 어댑터에도 동일한 프런트엔드 검증 누락이 적용된다. 내부 서버는 V6에 의해 알 수 없는 주소를 배달 대상에서 생략하고 Sent를 저장한다.

### 8. 탐지 방법

입력값 someone@af.asd, @af.asd, @broken을 대조하며 성공 안내와 Sent를 확인한다. 주소 문자열은 DB에서 재조회한 값과 비교한다. 안내 문구와 실제 허용 범위를 대조한다.

### 9. 검증 기준

외부 도메인·잘못된 형식 주소 모두 전용 Compose에서 수용하고 영속 Sent 기록을 남겨야 한다. 기존 F2·F3·F4·U2·U3·U4·V6가 함께 재현되어야 한다. 후속 가입에 대한 소급 배달은 하지 않는다.

### 10. 검증 결과

2026-11-02: npm run test:bugs:e2e 통과. 격리 DB와 Chrome PC(1440×900)·모바일(390×900)에서 someone@af.asd 및 @af.asd의 성공 안내·Sent 표시, 새로고침 후 To/Cc/Bcc 원문 재조회와 기존 7개 결함 유지를 확인했다. npm run build 및 npm run lint도 통과했다.


## V8: 회원가입 비밀번호 최소 길이 검증 누락

| 항목 | 값 |
|---|---|
| Bug ID | V8 |
| 유형 | validation |
| 구현 상태 | 검증 완료 |
| 수정 파일 | backend/schemas.py, src/assets/scripts/2026/auth/client.js, src/signup.html |
| 기준일 | 2026-11-02 |
| 발생 위치 | signup.html → POST /api/auth/register |

### 1. 버그 개요

화면에는 12–128 characters.라는 비밀번호 규칙을 표시하지만 최소 12자 검증을 생략하여 짧은 비밀번호로 가입된다.

### 2. 정상 기대 동작 (Expected Behavior)

12자 미만은 거부하고 12–128자 범위만 허용해야 한다. 비밀번호 확인도 일치해야 한다.

### 3. 결함 동작 (Actual Defective Behavior)

1–11자 비밀번호(예: test)로도 회원가입과 이후 로그인이 성공한다. 화면 안내는 그대로 12–128이다. 빈 비밀번호, 128자 초과, 확인 불일치는 거부한다.

### 4. 재현 조건 (Preconditions)

아직 등록되지 않은 유효한 사용자 이름으로 signup.html 사용. Chrome PC 1440×900 및 모바일 390×900. 필수 이름과 비밀번호 확인을 입력한다.

### 5. 재현 절차 (Steps to Reproduce)

1. Create account로 회원가입 화면에 이동하여 12–128 characters. 안내를 확인한다.
2. 새 아이디와 Display Name을 입력한다.
3. Password 및 Confirm Password에 test를 입력하고 가입한다.
4. 로그인 화면으로 이동하고 새 아이디/test로 로그인하여 성공을 확인한다.
5. 경계값 1, 3, 4, 11, 12, 128자와 빈 값, 129자, 확인 불일치도 대조한다.

### 6. 예상 관찰 결과

짧은 비밀번호임에도 가입 API가 201을 반환하고 로그인 API도 성공한다. DB에는 비밀번호가 Argon2 해시로 저장된다. 0자·129자·불일치는 422로 거부된다.

### 7. 버그 구현 방법

프런트엔드 validateRegistration에서 12자 미만 조건을 제거한다. 회원가입 HTML의 minlength=12도 제거하되 required, maxlength=128 및 안내 문구는 유지한다. 백엔드 RegisterInput의 password/confirmPassword는 최소 1자와 최대 128자만 검사한다. 비밀번호 확인 일치·해시 저장·로그인 절차는 유지한다.

### 8. 탐지 방법

표시된 규칙과 실제 가입 허용 결과를 비교한다. 짧은 비밀번호로 새 계정을 만들고 재로그인하여 서버 저장까지 검증한다. 직접 API 호출로 경계값 및 해시 저장을 대조한다.

### 9. 검증 기준

비밀번호 test로 UI와 API 가입·로그인이 성공해야 한다. 화면은 계속 12–128로 안내하고 최대 길이·빈 값·확인 일치 검사는 동작해야 한다. 기존 9개 결함도 유지되어야 한다.

### 10. 검증 결과

2026-11-02: backend/tests/test_short_password_bug.py의 8개 검사가 통과했다. 1·4·11·12·128자 가입과 로그인 및 Argon2 저장, 빈 값·129자·확인 불일치 거부를 확인했다. npm run test:bugs:e2e가 Chrome PC(1440×900)·모바일(390×900)에서 통과하여 12–128 안내 유지 및 test로 가입·로그인, 기존 9개 결함 재현을 확인했다. npm run build와 npm run lint도 통과했다. 격리 DB를 사용했다.

### 실행 서버 반영 보완 (2026-11-02)

실행 중이던 127.0.0.1:8000 서버가 변경 전 RegisterInput(minLength=12)을 메모리에 유지하여 3자리 비밀번호를 거부한 것을 실제 OpenAPI 응답에서 확인했다. 해당 프로젝트 서버를 재시작하여 password와 confirmPassword의 minLength=1 적용을 확인했다. 기존 test 계정에 abc로 중복 가입 요청 시 길이 검증을 통과하고 409를 반환함을 확인했으며 기존 계정은 변경하지 않았다. start_server.bat에 --reload --reload-dir backend를 추가하여 이후 백엔드 Python 변경을 자동 반영한다. 격리 가입·로그인 검사에 abc를 명시적으로 추가했다.

보완 검증 결과: backend/tests/test_short_password_bug.py 9개 통과(abc 포함). npm run test:bugs:e2e가 Chrome PC·모바일에서 3자리 abc 가입·로그인과 12–128 안내 유지 및 기존 결함을 모두 확인했다. npm run lint:js도 통과했다.
