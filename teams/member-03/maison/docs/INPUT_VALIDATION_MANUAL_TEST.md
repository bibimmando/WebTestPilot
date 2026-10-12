# 입력 검증 버그 수동 테스트 매뉴얼

작성일: 2026-10-09 (Asia/Seoul). 로컬 WebTestPilot 평가 전용. 설계는 [INPUT_VALIDATION_BUG_PLAN.md](INPUT_VALIDATION_BUG_PLAN.md), 실제 결과는 [INPUT_VALIDATION_IMPLEMENTATION.md](INPUT_VALIDATION_IMPLEMENTATION.md), 사용자 기록지는 [체크리스트](../doc/INPUT_VALIDATION_TEST_CHECKLIST.md)를 참조한다.

기존 동명 문서는 사용자 승인에 따라 [백업 폴더](backups/input-validation-20261009/)에 원문 그대로 보존했다. 기존 docs/INPUT_VALIDATION_TEST_CHECKLIST.md는 과거 3개 버그 문서이므로 이번 기록에는 사용하지 않는다.

## A. Windows 테스트 환경 준비

Node.js와 npm, Edge 또는 Chrome, PowerShell이 필요하다. 이번 실행 환경은 Node v24.20.0 / npm 11.19.0이다. Python, DB, Docker, 외부 결제·메일 계정은 필요 없다. 서버는 Vite 내장 API와 메모리 저장소를 사용하며 재시작하면 실험 데이터가 사라진다.

```powershell
Set-Location 'C:\Users\custa\Downloads\Maison-main'
node --version
npm.cmd --version
npm.cmd ci --no-audit --no-fund
```

npm 명령도 사용 가능하지만 PowerShell 실행 정책 오류가 나면 npm.cmd를 사용한다. 설치에는 npm 레지스트리 인터넷 접속이 필요하다. 의존성 설치 실패 상태에서 실행 성공으로 기록하지 않는다.

### 정상 서버 실행

각 실험 전 서버를 Ctrl+C로 종료하고, 같은 PowerShell에서 아래를 실행한다. 이 명령은 현재 실험의 5개 토글만 정리한다.

```powershell
Remove-Item Env:BUGS_ON -ErrorAction SilentlyContinue
'V3','V6','V7','V9','V11' | ForEach-Object {
  Remove-Item -LiteralPath "Env:BUG_$_" -ErrorAction SilentlyContinue
}
npm.cmd run dev -- --host 127.0.0.1 --port 8080 --strictPort
```

주소는 http://127.0.0.1:8080/ 이다. strictPort로 포트가 점유되면 자동 변경하지 않고 실패한다. 기존 프로세스가 실행 중인지 확인한다. API도 같은 포트다. localhost와 127.0.0.1은 브라우저 저장소가 다르므로 실험 내내 주소를 통일한다.

### 버그 서버 실행

정상 서버를 종료한 뒤 위 토글 정리 명령을 실행하고 **대상 버그 하나**만 켠다.

| 문서 ID | 설계·토글 ID | 설정 명령 |
|---|---|---|
| BUG-001 | V3 | `$env:BUG_V3 = '1'` |
| BUG-002 | V6 | `$env:BUG_V6 = '1'` |
| BUG-003 | V11 | `$env:BUG_V11 = '1'` |
| BUG-004 | V7 | `$env:BUG_V7 = '1'` |
| BUG-005 | V9 | `$env:BUG_V9 = '1'` |

예: 주문 이메일 결함만 켜기.

```powershell
$env:BUG_V3 = '1'
npm.cmd run dev -- --host 127.0.0.1 --port 8080 --strictPort
```

5개 모두 켜서 둘러보려면 `$env:BUGS_ON = 'all'` 후 같은 실행 명령을 사용한다. 현재 등록된 버그는 이 5개뿐이다. 개별 실험은 단독 활성화를 권장한다. BUGS_ON=all이 남아 있으면 개별 토글을 지워도 모두 켜진다. 환경변수 변경 후 반드시 서버를 재시작하고 브라우저를 새로고침한다. 웹 화면에 버그 표시를 추가하지 않았으며, 정상/결함 조건은 실행자가 관리한다.

별도 PowerShell에서 실행 준비를 확인한다.

```powershell
Invoke-RestMethod 'http://127.0.0.1:8080/api/health'
Invoke-RestMethod 'http://127.0.0.1:8080/api/bugs'
```

health.ok=true, 초기 products=13/users=2/orders=2. bugs.enabled는 정상 모드 [] 또는 설정한 V ID다. 페이지를 연 뒤 토글 응답이 완료될 때까지 기다린다(개발자 도구 Network의 /api/bugs 요청 완료 확인). 토글 수신 전에는 일시적으로 정상 검증이 적용된다. 이 관리 API는 평가 대상 에이전트의 정답으로 제공하지 않는다.

### 계정·초기화·종료

시드 계정은 test@maison.com / test1234 (초기 주문 없음), demo@maison.com / demo1234 (초기 주문 2개)다. BUG-005는 아래의 전용 합성 계정을 사용한다. 실제 사용자 계정이나 암호는 입력하지 않는다.

각 시나리오 전후 초기화는 서버 재시작 또는 다음 로컬 명령으로 수행한다. **현재 서버의 실험 계정·주문·세션·토큰 전체가 시드로 복원**된다. DB 구조 변경·기존 영속 데이터 삭제는 없다.

```powershell
Invoke-RestMethod -Method Post 'http://127.0.0.1:8080/_reset'
```

브라우저 쿠키와 장바구니는 서버 초기화만으로 지워지지 않는다. 해당 사이트의 사이트 데이터를 삭제하거나 모든 InPrivate/시크릿 창을 닫고 새 창을 연다. 장바구니만 남으면 /cart의 삭제 버튼으로 제거한다. localStorage 키는 maison-cart, wishlist-storage다. 서버 초기화 후 열린 탭도 새로고침한다.

종료: 서버 PowerShell에서 Ctrl+C. 재시작: 같은 폴더에서 같은 실행 명령. 버그를 끄려면 정상 실행 절차로 토글을 정리하고 재시작한다. 동시에 8080/8081을 비교한다면 쿠키는 포트별로 분리되지 않으므로 다른 브라우저 프로필을 사용한다.

## B. 공통 주문 준비 및 입력

BUG-001/004는 로그인하지 않은 새 시크릿 창을 사용한다. /products에서 Arc Pendant Light를 클릭하고 수량 1을 유지한 채 Add to Bag을 클릭한다. /cart에서 상품과 수량을 확인한 후 Checkout을 클릭한다. 또는 주소창에 http://127.0.0.1:8080/checkout 을 입력한다. No Items to Checkout이면 상품 담기부터 다시 수행한다.

| 필드 | 정상 입력값 |
|---|---|
| First Name * | Pilot |
| Last Name * | Tester |
| Email * | pilot@example.test |
| Phone | 빈칸 |
| Street Address * | 123 Test Street |
| City * | Seoul |
| Postal Code * | 04524 |
| Country * | South Korea |
| Order Notes | 빈칸 |

각 실험에서 지정한 필드 하나만 바꾼다. 주문 완료 URL은 /order/MA-번호 형태이며 번호는 현재 서버 상태에 따라 달라진다. 고정 MA-1003을 기대하지 않는다.

## BUG-001 / V3 — 주문 이메일 형식 검증 누락

- 페이지·기능·URL: Checkout 주문 요청, http://127.0.0.1:8080/checkout.
- 사전 조건: V3 ON, 장바구니에 상품 1개, 비로그인, 토글 로딩 완료.
- 정확한 결함 입력: Email *에 `invalid-address` (따옴표 없이). 다른 값은 공통 정상표와 동일.

1. 공통 주문 준비를 수행한다.
2. 모든 필드를 표대로 입력하고 Email *만 invalid-address로 바꾼다.
3. Submit Order Request를 클릭한다.
4. Order Request Submitted 안내와 /order/실제번호 이동을 확인한다.
5. 주문 상세의 Delivery To에 invalid-address가 그대로 표시되는지 확인한다.
6. 정상 모드에서 초기화 후 같은 입력을 반복한다. 이메일 형식 안내로 제출이 차단되고 Checkout에 남으며 장바구니가 유지되어야 한다.
7. 양쪽 모드에서 정상 이메일 pilot@example.test로 주문한다. 접수와 상세 표시가 성공해야 한다.

정상 기대: 브라우저 email 형식 검증 차단. 결함 기대: 잘못된 이메일 주문 생성·상세 원문 표시·장바구니 비움. 판단: 성공 토스트만으로 PASS하지 않고 주문 상세 이메일까지 확인한다. 원래 API에는 이메일 형식 검증이 없으므로 API로 invalid-address를 직접 보내는 것은 신규 버그 재현 증거가 아니다.

소스: src/pages/Checkout.tsx, Checkout의 email Input; 제출은 기존 handleSubmit. 복구: V3 OFF 재시작, 서버 초기화 및 브라우저 상태 초기화. 정상 이메일 재주문은 새 상품 담기부터 시작한다.

## BUG-002 / V6 — 계정 이름 공백 저장

- 페이지·기능·URL: Account 이름 수정, http://127.0.0.1:8080/account.
- 사전 조건: V6 ON, 초기화된 test 계정의 이름은 Test User.
- 정확한 결함 입력: ASCII 스페이스 3개. 문자로 `   `를 입력하는 것이며 따옴표·백틱은 넣지 않는다. 완전히 빈칸과 다르다.

1. /login에서 Email *=test@maison.com, Password *=test1234를 입력하고 Sign In을 클릭한다.
2. 로그인 완료 후 /account로 이동한다.
3. Display Name *을 클릭하고 Ctrl+A로 기존 이름을 전부 선택한다.
4. Space 키를 정확히 3번 누른다.
5. Save Name을 클릭한다. Saved 및 이름이 변경되었습니다 안내를 확인한다.
6. F5로 새로고침한다. Display Name이 비어 있고 계정 메뉴 이름도 비어 있는지 확인한다.
7. Display Name에 Normal Pilot을 입력해 Save Name을 클릭한다. 새로고침 후 정상 이름이 유지되어야 한다.
8. 정상 모드에서 초기화하고 1~4를 반복한다. 저장 실패 안내가 나오고 F5 후 Test User가 유지되어야 한다.
9. 양쪽에서 입력을 완전히 지우고 저장을 시도하면 required 검증이 차단해야 한다.

정상 기대: trim 후 빈 이름을 400으로 거부. 결함 기대: 공백은 검증 통과, 저장소 trim 후 빈 이름 저장. 판단: Saved와 F5 후 빈 이름을 함께 확인. 이름이 이미 비어 있으면 버튼이 비활성일 수 있으므로 정상 이름 저장 또는 초기화부터 수행한다.

소스: server/api.ts의 handleApi PATCH /api/auth/me; server/store.ts의 updateUserName은 수정하지 않음. UI는 Account.handleNameSubmit. 복구: Normal Pilot 또는 Test User로 다시 저장하거나 서버 초기화. V6 OFF 재시작으로 검증 복원.

## BUG-003 / V11 — 정확히 8자인 가입 암호 거부

- 페이지·기능·URL: 회원가입, http://127.0.0.1:8080/signup.
- 사전 조건: V11 ON, 비로그인 새 창, 미사용 이메일(초기화 후 pilot-v11@example.test 사용 가능).
- 입력: Name *=Pilot, Email *=pilot-v11@example.test, Password *=`Ab12!xyz` (8자).

1. /signup으로 이동한다. Already Signed In이면 계정 메뉴의 Sign Out 후 다시 방문한다.
2. 위 입력을 정확히 채우고 Create Account를 클릭한다.
3. “비밀번호는 8자 이상이어야 합니다.” 오류가 나오며 가입 화면에 남는지 확인한다. 화면의 8자 이상 안내와 모순된다.
4. 같은 이메일과 이름을 유지하고 암호만 Ab12!xyzQ (9자)로 바꾼다.
5. Create Account를 클릭한다. /orders로 이동하고 로그인 상태가 되어야 한다.
6. 정상 모드 초기화 후 8자 값으로 다시 가입한다. 이번에는 성공해야 한다.
7. 별도 초기화·비로그인 상태에서 Ab12!xy (7자)는 양쪽에서 차단되는지 확인한다. 브라우저 직접 입력 기준이며 API 보조 검사도 400이다.

정상 기대: 8자·9자 가입 성공, 7자 실패. 결함 기대: 8자만 거짓 거부, 9자 성공. 판단: 이메일 중복 오류가 아닌 길이 오류인지 확인한다. 9자로 이미 가입한 이메일을 재사용할 때는 초기화하거나 이메일을 바꾼다.

소스: server/api.ts의 handleApi POST /api/auth/signup 길이 분기; Signup HTML minLength=8은 유지. 복구: V11 OFF 재시작 및 서버 초기화로 실험 계정 제거. 다른 암호 변경·재설정의 최소 8자 검사는 유지된다.

## BUG-004 / V7 — 배송 도시 빈값 수용

- 페이지·기능·URL: Checkout 주문 요청, http://127.0.0.1:8080/checkout.
- 사전 조건: V7 ON, 장바구니 1개, 비로그인. V3는 OFF 권장.
- 정확한 결함 입력: City *를 완전히 빈 문자열로 만든다. 공백을 넣지 않는다. Email은 정상 pilot@example.test.

1. 공통 주문 준비를 수행하고 공통 표대로 입력한다.
2. City *를 클릭해 Ctrl+A 후 Backspace를 눌러 완전히 비운다.
3. Submit Order Request를 클릭한다.
4. 성공 안내와 /order/실제번호 이동을 확인한다.
5. Delivery To에서 주소·우편번호·국가는 표시되지만 Seoul 도시가 빠졌는지 확인한다.
6. 정상 모드에서 초기화 후 같은 절차를 수행한다. 도시 필수 입력 안내와 Checkout 잔류, 장바구니 유지가 기대된다.
7. 양쪽에서 City *=Seoul을 입력한 정상 주문은 성공해야 한다.

정상 기대: HTML required가 빈 도시 제출 차단. 결함 기대: 도시 없이 주문 접수. 판단: 주문 상세 도시 누락까지 확인한다. 도시 공백 문자열은 기존 서버에서도 수용될 수 있어 이 결함의 입력으로 쓰지 않는다.

소스: src/pages/Checkout.tsx, Checkout의 city Input required; 기존 handleSubmit 및 주문 API는 유지. 복구: V7 OFF 재시작, 서버·브라우저 초기화. 주문 생성 시 cart가 비워지므로 매번 새로 담는다.

## BUG-005 / V9 — 재설정 암호 확인 불일치 수용

- 페이지·기능: Forgot Password → Reset Password → 로그인.
- URL: http://127.0.0.1:8080/forgot-password 및 화면 링크의 /reset-password?token=실제토큰. 토큰을 임의 입력하거나 과거 링크를 재사용하지 않는다.
- 사전 조건: V9 ON, 전용 계정 Pilot / pilot-v9@example.test / Ab12!xyzQ를 /signup에서 생성. 유효한 토큰(30분 이내, 아직 사용하지 않음). 준비 암호는 9자라 V11과 충돌하지 않는다.
- 정확한 결함 입력: New Password *=FirstPass!123, Confirm Password *=OtherPass!456.

1. 전용 계정을 가입하고 /forgot-password를 방문한다.
2. Email *에 pilot-v9@example.test를 입력하고 Send Reset Link를 클릭한다.
3. 화면의 Set New Password 링크를 클릭한다. 실제 메일함을 확인할 필요가 없다.
4. New Password에 FirstPass!123, Confirm Password에 OtherPass!456을 입력한다.
5. Set Password를 클릭한다.
6. 서로 다르다는 오류 없이 /account로 이동하는지 확인한다.
7. 계정 메뉴 → Sign Out을 클릭한다. /login에서 전용 이메일과 기존 암호 Ab12!xyzQ로 로그인하면 실패해야 한다.
8. 확인값 OtherPass!456으로 로그인해도 실패해야 한다.
9. 새 암호 FirstPass!123으로 로그인하면 성공해야 한다. 화면 이동만으로 판단하지 않고 실제 로그인까지 확인한다.
10. 정상 모드에서 서버를 초기화하고 계정 생성·새 링크 발급부터 다시 한다. 불일치 입력은 “두 비밀번호가 서로 다릅니다.” 안내를 표시하고 재설정 화면에 남아야 하며 기존 암호가 유지되어야 한다.
11. 정상 입력 통제로 **새 링크**를 발급하고 New/Confirm 모두 FirstPass!123으로 입력한다. 양쪽 모드에서 재설정·새 암호 로그인이 성공해야 한다.

정상 기대: 두 값 불일치 차단, 암호 유지. 결함 기대: 첫 번째 암호로 변경되고 확인값은 무시됨. 판단: 불일치 제출 후 새 암호만 로그인 성공. 토큰 없음·만료·사용 완료 검사, 최소 길이와 인증 처리는 유지된다.

소스: src/pages/ResetPassword.tsx의 ResetPassword.handleSubmit; 서버 POST /api/auth/reset은 수정하지 않음. 복구: 전용 계정의 새 링크로 원하는 암호를 일치시켜 재설정하거나 서버 초기화; V9 OFF 재시작. 성공한 링크는 소비되므로 후속 실험에 재사용할 수 없다.

## C. 기록 및 자동 검증

각 BUG에서 OFF 기준선 → ON 재현 → OFF 복원, 정상 입력 통제를 따로 기록한다. PASS는 의도한 결함이 재현되고 필요한 정상 기능이 유지되는 경우다. 서버 미실행·토글 미확인·토큰 만료·설치 실패 등은 BLOCKED로 사유를 기록한다.

제공된 API 보조 검사는 정상 8080, 전체 ON 8081 서버를 동시에 실행한 뒤 사용한다. 로컬 합성 계정·주문을 생성하므로 실험 전후 초기화한다.

```powershell
node scripts/verify-input-validation.mjs
npm.cmd test
npm.cmd run build
```

API 스크립트는 V6/V11와 정상 주문·토큰 소비를 검증한다. V3/V7/V9의 프론트 결함을 API만으로 검증했다고 기록하지 않는다. 기존 Vitest 1건도 업무 재현을 대신하지 않는다. 상세 실측과 미검증 범위는 구현 내역 문서를 따른다.
