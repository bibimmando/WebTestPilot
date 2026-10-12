# WebTestPilot 평가용 입력 검증 버그 삽입 설계

분석일: 2026-10-08~09 (Asia/Seoul). 대상: 현재 Maison-main 소스. **설계만 작성했으며 버그 삽입·등록·실행은 수행하지 않았다.**

## 1. 입력 검증 버그의 목적

WebTestPilot이 UI를 조작하면서 잘못된 입력의 수용, 정상 경계값의 거부, 검증 오류 안내 누락을 얼마나 정확히 발견하는지 평가한다. HTTP 오류 탐지만으로 충분하지 않으며, 입력값·화면·응답·실제 상태 변화를 함께 비교한다.

이 문서에서 **[확인]**은 실제 소스를 정적으로 읽어 확인한 사실, **[제안]**은 향후 변경 계획, **[예상]**은 아직 실행하지 않은 결함 동작이다. 각 후보의 정상 동작도 실행 실증이 아닌 코드상의 기준선이다. 모든 테스트는 외부 결제·메일 연동 없는 격리된 메모리 서버에서 수행한다.

경로 주의: 요청의 `/doc`는 기존에 없으며 기존 문서는 `/docs`에 있다. 먼저 `docs/PROJECT_OVERVIEW.md`, `ARCHITECTURE.md`, `SERVER_SETUP.md`, `BUG_INJECTION_GUIDE.md`, `BUG_CATALOG.md`, `bugs.md`를 읽고 코드를 대조했다. 요청된 산출물 경로를 존중하여 새 `doc/INPUT_VALIDATION_BUG_PLAN.md`만 작성한다. 기존 `/docs` 문서와 소스는 변경하지 않는다. 본문 파일 경로는 프로젝트 루트 기준이다.

## 2. 프로젝트 내 입력 처리 구조 분석

### 2.1 실제 처리 경로

[확인] `src/App.tsx`가 React Router 화면을 연결한다. 폼은 주로 `useState`와 HTML 제약 검증을 사용한다. Zod/React Hook Form 의존성은 있지만 주요 업무 폼에 연결된 스키마 검증은 확인되지 않는다.

```text
텍스트 입력 onChange → 컴포넌트 state
  → 브라우저 required/type=email/minLength 검사
  → onSubmit → 로컬 일치 검사(계정/재설정)
  → hooks/useAuth 또는 Checkout/Footer의 직접 api 호출
  → src/lib/api.ts request → 같은 origin fetch
  → vite.config.ts apiPlugin → server/vite-plugin-api.ts middleware
  → server/api.ts handleApi → JSON.parse → 분기별 검증
  → server/store.ts → 메모리 계정/주문/세션/토큰
  → 성공: 캐시·토스트·URL 갱신 / 실패: ApiError → alert·토스트
```

[확인] `Input`/`Textarea`는 `src/components/ui/input.tsx`, `textarea.tsx`에서 HTML props를 전달하는 래퍼다. `required`는 빈 문자열을 막지만 일반 text의 공백만 있는 값은 막지 않는다. `minLength`는 비밀번호 최소 8자에 사용한다. 업무 입력의 `maxLength`와 `pattern`은 확인되지 않는다. 서버 TypeScript 타입 표기는 JSON 런타임 타입 검증을 대신하지 않는다.

수량은 숫자 텍스트박스가 아닌 `QuantitySelector`의 ± 버튼이다. 기본 min=1/max=10, 이벤트 조건과 disabled 조건으로 두 번 막는다. 상세의 수량 state → `handleAddToCart` → `useCart.addItem`; 장바구니의 `onQuantityChange` → `updateQuantity`로 이어진다. 장바구니는 `localStorage`의 `maison-cart`에 저장되며 주문할 때만 서버로 전달된다.

검색은 `SearchDialog.submit`에서 trim·빈 값 차단·URL 인코딩 후 `/products?q=...`로 이동한다. `Products`의 필터/정렬 이벤트는 URL을 바꾸고 `useProducts`가 API로 전달한다. `toSearch`도 q를 trim하며 서버도 trim한다. 따라서 검색 trim 한 곳만 제거해서 전체 공백 검색 결과가 달라질 것이라고 가정해서는 안 된다.

### 2.2 문서와 실제 코드 대조

| 기존 설명 | 코드 대조 결과 |
|---|---|
| React + Vite 내장 Node/TypeScript API, 메모리 저장 | `vite.config.ts`, `server/vite-plugin-api.ts`, `api.ts`, `store.ts`와 일치. Python/DB 서버 없음 |
| 회원가입 이름/이메일/암호 필수, 암호 8자 이상 | Signup HTML 및 signup 분기의 trim/missing/isEmail/length 검사와 일치 |
| 계정 이름 변경·암호 변경·재설정 구현 | Account/ResetPassword/useAuth와 API에 실제 구현. `server/pages.ts`의 미구현 언급은 현재 구현과 다름 |
| 주문 고객 필수값의 UI/API 차이, 수량 검증 공백 | 코드와 일치. UI 필수 7개, API 필수 4개. 서버 수량 범위·정수·타입 검사 없음 |
| 버그 후보 V1~V4 | `docs/BUG_CATALOG.md`의 제안이며 `server/bugs/validation.ts`는 빈 배열. 현재 활성 버그 구현으로 간주하지 않음 |
| 기존 문서의 node_modules 없음 | 현재 폴더에는 node_modules가 존재. 과거 조사 환경 설명을 현재 상태로 재사용하지 않음 |
| Git 브랜치 기반 작업 | 현재 `git status`는 Git 저장소가 아니라고 응답. 해당 브랜치 존재를 가정하지 않음 |
| 최소길이 타입 오류 시 빌드 중단 | package.json build는 `vite build`. 별도 tsc가 필요하므로 자동 중단을 보장할 수 없음 |

[확인] 이번 작업에서는 서버/브라우저를 실행하지 않았다. 기존 문서의 정상 의도와 정적 검증 사실을 실제 성공률·재현 성공으로 표현하지 않는다.

### 2.3 기존 공백과 신규 주입의 구분

- 주문 API는 수량의 양수·정수·1~10 제한을 검증하지 않는다. 신규 버그는 이 검사를 제거하는 것이 아니라 **현재 UI의 차단을 잘못 바꾸는 것**으로 설계한다(V12/V13).
- 주문 API는 이메일 형식을 검사하지 않는다. V3는 UI의 `type=email` 변경이 새 결함이며 서버 공백은 기존 조건이다.
- city/postalCode/country는 UI에서만 required다. V7 역시 UI 검증 약화만 새 주입이다. 공백만 있는 city는 이미 수용될 수 있으므로 V7은 정확히 빈 문자열로 재현한다.
- 전화는 optional `type=tel`, 우편번호·국가는 자유 text, notes는 optional이다. 전화/우편번호 형식·메모 최대길이를 임의의 정상 계약으로 만들지 않는다.
- 이름·주소 최대길이, 상품 검색 최대길이의 기존 제한은 없다. 최대길이 검증 제거 후보는 제외한다. 길이 오류는 실재하는 암호 최소 8자 계약의 7/8/9 경계로 평가한다.
- API의 JSON 타입 공백, 관련상품 limit의 숫자 처리, 알 수 없는 sort의 featured fallback은 기존 특성이다. API 직접 조작만으로 재현되는 기존 공백을 새 UI 주입으로 집계하지 않는다.
- 배송비의 정확히 $500 경계 불일치는 입력 검증보다는 가격 정책 문제이므로 본 후보에서 제외한다.

## 3. 입력 검증이 적용된 기능 및 파일 목록

[확인] 아래는 주요 업무 입력을 전수로 묶은 표다. 표시용 이미지 선택·FAQ·하트·삭제·메뉴 버튼은 뒤에 따로 정리한다.

| 페이지/요소 | JavaScript 이벤트·함수 | API | 프론트 검증 | 백엔드 검증·저장 |
|---|---|---|---|---|
| `/signup`: name/email/password | Signup.handleChange/handleSubmit → useSignup | POST `/api/auth/signup` | 모두 required, email type, password minLength=8, pending 방어 | api.ts: 이름·이메일 trim, missing_fields 400, isEmail 400, length<8 400, 이메일 중복 409 → createUser(이메일 소문자·trim, 이름 trim), createSession |
| `/login`: email/password | Login.handleChange/handleSubmit → useLogin | POST `/api/auth/login` | 둘 required, email type; 암호 minlength 없음 | 이메일 trim, 누락 400, findUserByEmail+verifyPassword 불일치 401. 독립 isEmail 검사 없음 |
| `/account`: name | Account.handleNameSubmit → useUpdateName | PATCH `/api/auth/me` | required, pending 방어 | 인증 401, trim 후 빈 이름 400 → updateUserName에서도 trim |
| `/account`: current/new/confirm password | onChange → handlePasswordSubmit → useChangePassword | POST `/api/auth/password` | 모두 required, 새 암호 minLength=8, next!==confirm 로컬 차단 | 인증/누락, 현재 암호 검증 401, next.length<8 400, next===current 400 → updateUserPassword. confirm은 서버에 보내지 않음 |
| `/forgot-password`: email | onChange → handleSubmit → useForgotPassword | POST `/api/auth/forgot` | required, email type | trim, 빈값 또는 isEmail 실패 400. 없는 계정도 200/resetUrl=null. 존재 시 createResetToken |
| `/reset-password`: URL token, password/confirm | useSearchParams → useResetToken; handleSubmit → useResetPassword | GET `/api/auth/reset?token=...`, POST `/api/auth/reset` | 토큰 없음/GET 오류면 Link Expired, 암호 required/minLength=8, confirm required, 불일치 로컬 차단 | POST token trim/필수, 암호 length<8 400, GET/POST 토큰 조회·만료 검사 → 변경 후 consumeResetToken. 확인값 서버 전송 없음 |
| 모든 Layout의 Footer: email | onChange → handleSubscribe | POST `/api/subscribe` | required, email type, sending 방어 | trim, 누락 400, isEmail 실패 400 → 202 접수만, 저장/발송 없음 |
| Header 검색: q | onChange → SearchDialog.handleSubmit/submit | 이동 후 GET `/api/products?q=...` | trim, 빈 검색 무시, encodeURIComponent | useProducts.toSearch/서버 trim, matchesQuery의 단어 AND; 빈 q는 전체 목록 의미 |
| `/products`: collection 버튼·sort select·검색 해제 | handleFilterChange/handleSortChange/handleClearSearch | GET `/api/products` | 정의된 컬렉션과 5종 sort 옵션 선택 | collection 유효성 404; sortProducts default=featured. limit은 유한수·>0일 때 slice, 정수 강제 없음 |
| `/product/:slug`: 수량 ±/Add to Bag | QuantitySelector.decrease/increase → setQuantity → handleAddToCart | 선택·담기 API 없음; 상세 조회 GET `/api/products/:slug` 및 `/related?limit=4` | 선택 기본 1~10, 버튼 disabled+조건 | addItem 기존 행은 min(합계,10), 신규 행은 받은 수량 그대로. 상품 slug 미존재 404. 서버 주문 수량 검사 없음 |
| `/cart`: 행 수량 ± | QuantitySelector → useCart.updateQuantity | API 없음, 체크아웃 시 POST `/api/orders` | 기본 1~10; store는 <1이면 행 삭제, 그 외 min(qty,10) | localStorage 상태. 주문 서버는 실제 상품 id 조회/422만 검사 |
| `/checkout`: firstName/lastName/email/address/city/postalCode/country | handleInputChange → handleSubmit | POST `/api/orders` | 7개 required, email type | items 비어 있음 400, 앞의 4개만 trim 기반 필수 400, 상품 id 존재 422; customer 원문 저장. 이메일 형식·나머지 3개·길이 검증 없음 |
| `/checkout`: phone/notes | 같은 handleInputChange/handleSubmit | 같은 POST | phone optional tel, notes optional textarea; pattern/최대길이 없음 | customer에 그대로 저장, 별도 검증 없음 |

추가 입력/선택 경로 [확인]: ProductDetail의 prevImage/nextImage/썸네일 setCurrentImageIndex는 제공된 이미지 목록 내 선택, ProductCard/상세의 handleWishlistToggle은 상품 id로 add/remove, Wishlist.handleAddAllToCart는 각 상품 수량 1로 addItem, Cart 삭제는 removeItem, AccountMenu 로그아웃은 useLogout → POST `/api/auth/logout`이다. 사용자 자유 입력 검증 후보로 선정하지 않는다. 안내 Section FAQ·Header 메뉴는 펼침/이동 상태로 신규 데이터 제출이 없다. `/order/:orderId`, `/info/:slug` 등 URL 입력은 각각 `useOrder`/`useInfoPage` → 조회 API에서 존재 여부, 주문은 추가 소유권 검사를 한다. 범용 `components/ui`의 달력·slider·OTP 파일이 있다고 실제 입력 기능으로 간주하지 않는다.

## 4. 입력 검증 버그 후보 요약표

[제안] 기존 후보와의 ID 충돌을 피하려고 V1~V4의 의미를 유지했다. V5~V14는 이 문서의 신규 제안이며 아직 등록되지 않았다. V4는 형식 검증보다 입력 토큰의 상태 유효성 검증에 해당하는 확장 후보다.

| ID | 이름 | 우선 유형 | 변경 층 | UI 결과 차이 | 우선순위 |
|---|---|---|---|---|---|
| V1 | 7자 가입 암호 허용 | 길이 경계 오류 | 프론트+서버 | 차단 → 가입 성공 | P2 |
| V2 | 잘못된 현재 암호 허용 | 잘못된 값 정상 처리 | 서버 | 401 → 암호 변경 성공 | P2 |
| V3 | 주문 이메일 형식 검증 누락 | 데이터 형식 | 프론트 | 제출 차단 → 주문 생성 | P1 |
| V4 | 사용한 재설정 토큰 재수용 | 상태 유효성 | 서버 | Link Expired → 두 번째 변경 | P3 |
| V5 | 가입 이름 공백 수용 | 공백 문자열 | 서버 | 400 → 빈 이름 계정 생성 | P2 |
| V6 | 계정 이름 공백 저장 | 공백 문자열 | 서버 | 실패 → Saved·빈 이름 | P1 |
| V7 | 배송 도시 빈값 수용 | 필수 입력 누락 | 프론트 | 제출 차단 → 주문 생성 | P1 |
| V8 | 공백 주소 수용 | 공백·검증 조건 오류 | 서버 | 400 → 주문 생성 | P2 |
| V9 | 재설정 암호 확인 불일치 수용 | 입력 간 관계 | 프론트 | 로컬 오류 → 암호 변경 | P1 |
| V10 | 계정 암호 확인 불일치 수용 | 입력 간 관계 | 프론트 | 로컬 오류 → 암호 변경 | P2 |
| V11 | 정확히 8자인 가입 암호 거부 | 경계값·층간 불일치 | 서버 | 가입 성공 → weak_password | P1 |
| V12 | 상세 수량 11 허용 | 최댓값 경계 오류 | 프론트 | 최대 10 → 11 담기 | P2 |
| V13 | 상세 수량 0 허용 | 최솟값 경계 오류 | 프론트 | 최소 1 → 0 담기/주문 | P2 |
| V14 | 재설정 불일치 오류 안내 누락 | 오류 메시지 누락 | 프론트 | 오류 설명 → 조용한 무응답 | P2 |

P1은 처음 평가할 후보, P2는 입력 종류 확대, P3은 다단계 상태 검증이다. 높은 우선순위가 실제 탐지 성공을 보장하지는 않는다.

## 5. 버그별 상세 삽입 설계

다음 항목은 모두 **향후 변경 제안**이다. 공통 토글/복구 규칙은 6~8절에 정의한다. 정상과 결함의 비교는 같은 시나리오의 OFF/ON/OFF에서 확인한다. 암호 예시는 격리 테스트용 합성 입력이며 실제 계정에 사용하지 않는다.

### V1 — 7자 가입 암호 허용

- **기능·페이지·근거:** `/signup`, `src/pages/Signup.tsx` password Input/handleSubmit, `src/hooks/useAuth.ts` useSignup, `server/api.ts` handleApi signup의 `password.length < 8`(현재 224행), `server/store.ts` createUser.
- **현재 정상·검증 위치 [확인]:** HTML required/minLength=8, 서버 8자 미만 400 weak_password. UI만 완화하면 서버가 막는다.
- **변경할 코드·방향 [제안]:** V1 ON에서 해당 Input의 minLength를 7, signup 분기의 기준만 `< 7`로 변경한다. 6자는 계속 거부하는 경계 오류로 설계하고 reset/password 분기는 유지한다. 두 변경을 같은 ID에 묶는다.
- **구체 입력·UI 재현:** 비로그인 새 컨텍스트 → `/signup` → name=`Pilot`, 미사용 `v1@example.test`, password=`Ab12!xy`(7자) → Create Account.
- **예상 비정상·관찰:** POST 201, `/orders` 이동 및 로그인 상태. 길이 안내는 여전히 8자 이상인데 7자로 가입된다.
- **Oracle:** OFF의 사용자 직접 입력/제출은 차단되어 가입 POST 0건; API 보조 검사는 동일 7자 입력에 400. ON은 201 및 `/api/auth/me`에 해당 계정. 6자 거부·8자 수용을 통제 입력으로 확인한다.
- **원상복구:** minLength=8과 서버 `<8` 복원, V1 OFF·재시작·reset으로 계정 제거.
- **영향 가능성:** 생성된 짧은 암호 계정은 로그인 가능하다. 암호 변경/재설정의 8자 규칙은 유지되어 층/기능 간 불일치가 남는다. 다른 평가에 계정을 재사용하지 않는다.

### V2 — 잘못된 현재 암호 허용

- **기능·페이지·근거:** `/account` 암호 폼, Account.handlePasswordSubmit → useChangePassword → POST `/api/auth/password`, `server/api.ts`의 `if (!verifyPassword(user, current))`, store.updateUserPassword.
- **현재 정상·검증 위치 [확인]:** 현재값이 틀리면 401 wrong_password, Account.describePassword가 alert를 표시하고 암호는 유지된다. 새 암호 길이·확인은 별도로 검증한다.
- **변경할 코드·방향 [제안]:** ON에서 현재 암호 불일치 거부 분기만 우회한다. 인증·누락·새 암호 최소길이·동일 암호 금지는 유지한다.
- **구체 입력·UI 재현:** 임시 계정을 가입해 로그인 → `/account` → current=`Wrong!123`, new/confirm=`NewPass!234` → Change Password. current가 실제 암호와 다름을 사전에 보장한다.
- **예상 비정상·관찰:** POST 200, Password changed 토스트, 폼 초기화. 실제 암호도 바뀐다.
- **Oracle:** OFF는 401+오류, 원래 암호 로그인 성공/새 암호 실패. ON은 200+성공, 별도 컨텍스트 로그인에서 원래 암호 실패/새 암호 성공. 토스트만으로 판정하지 않는다.
- **원상복구:** verifyPassword 거부 복원, OFF·재시작·reset 후 새 테스트 계정.
- **영향 가능성:** 암호 변경 시 기존 세션 전부 무효화되므로 같은 계정의 다른 테스트를 중단시킨다. 전용 계정 사용. 입력값 검증과 인증 경계가 겹치는 후보로 분류한다.

### V3 — 주문 이메일 형식 검증 누락

- **기능·페이지·근거:** `/checkout`, `src/pages/Checkout.tsx`의 id=email Input/handleSubmit → POST `/api/orders`; `server/api.ts` 주문 required 배열.
- **현재 정상·검증 위치 [확인]:** UI `type=email required`가 `invalid-address`를 차단한다. 서버는 이메일의 trim 후 존재만 검사한다.
- **변경할 코드·방향 [제안]:** ON에서 **Checkout의 email만** `type="text"`로 바꾸고 required는 유지한다. 다른 폼과 전역 isEmail은 바꾸지 않는다.
- **구체 입력·UI 재현:** 빈 cart에서 상품 1개 담기 → checkout의 나머지 필수값 정상 입력, email=`invalid-address` → Submit Order Request.
- **예상 비정상·관찰:** POST 201, 성공 토스트·`/order/{응답 orderId}` 이동, 주문 상세에 잘못된 이메일이 표시된다.
- **Oracle:** OFF typeMismatch=true/폼 invalid, 주문 POST 없음·cart 유지. ON은 201·상세 email 일치·cart 비움. 정상 이메일은 양쪽 모두 성공한다.
- **원상복구:** type=email 복원, OFF·새 컨텍스트·reset으로 주문 제거.
- **영향 가능성:** 주문 연락처 품질만 영향. 기존 서버 공백을 활용하지만 새 주입은 DOM 변경 한 곳이다. 실제 메일 전송은 없다.

### V4 — 사용한 재설정 토큰 재수용

- **기능·페이지·근거:** `/forgot-password` → `/reset-password`, ForgotPassword/useForgotPassword/useResetToken/useResetPassword, GET/POST `/api/auth/reset`; `server/api.ts`의 `consumeResetToken(token)`(현재 418행), `store.ts` resetTokens.
- **현재 정상·검증 위치 [확인]:** 성공하면 토큰을 삭제하고 다음 GET/POST를 400 invalid_token으로 거부한다. TTL은 30분이다.
- **변경할 코드·방향 [제안]:** ON에서 POST 성공 경로의 consumeResetToken 호출만 생략한다. 토큰 존재·만료 검사 및 사용자 연결은 유지한다.
- **구체 입력·UI 재현:** 임시 계정의 이메일로 forgot 제출 → 화면의 Set New Password 링크 URL을 평가 제어기가 임시 보관 → 첫 암호/확인=`FirstPass!123`로 변경 → 30분 이내 같은 링크를 새 페이지에서 재개방 → 두 번째 암호/확인=`SecondPass!123` 제출.
- **예상 비정상·관찰:** 두 번째 GET 200, 폼 노출, 두 번째 POST 200·계정 화면 이동. 사용 완료 토큰으로 두 번 변경된다.
- **Oracle:** OFF 두 번째 GET 400+Link Expired, 두 번째 변경 불가. ON 두 번째 변경 후 두 번째 암호로 로그인 성공. 토큰을 모르는 다른 사용자나 임의 토큰 수용까지 기대하지 않는다.
- **원상복구:** consume 호출 복원, OFF·재시작·reset으로 잔존 토큰/세션 삭제.
- **영향 가능성:** 계정 세션·암호 상태가 여러 번 바뀐다. 다른 토큰 테스트와 격리. 순수 문자열 검증만 평가하는 실험에서는 이 확장 후보를 제외한다.

### V5 — 가입 이름 공백 수용

- **기능·페이지·근거:** `/signup`, Signup.handleSubmit → POST `/api/auth/signup`; `server/api.ts`의 `const name=(payload.name??'').trim()` 및 missing 배열(현재 209~215행); store.createUser.
- **현재 정상·검증 위치 [확인]:** text required는 공백을 통과시키지만 서버 trim 후 name이 비어 400 missing_fields로 거부한다. createUser도 이름을 trim한다.
- **변경할 코드·방향 [제안]:** signup의 name 지역변수만 ON에서 trim 없이 `(payload.name ?? '')`로 받는다. `!name` 검사는 그대로 두어 진짜 빈값은 계속 거부한다. createUser는 변경하지 않는다.
- **구체 입력·UI 재현:** `/signup` name=`   `, 미사용 `v5@example.test`, 8자 이상 암호 → Create Account.
- **예상 비정상·관찰:** 201·로그인/주문 화면 이동. 검증은 raw 공백을 통과시키고 저장은 trim하여 user.name이 빈 문자열이 된다.
- **Oracle:** OFF 400, payload.fields에 name, 가입 오류 alert. ON 201·응답 user.name=`''`, `/account` 이름 입력이 빈 상태. 정상 이름 수용/빈 문자열 거부는 유지한다.
- **원상복구:** signup name trim 복원, OFF·reset으로 계정 제거.
- **영향 가능성:** 이름 표시·계정 폼 초기값에 영향. email 및 로그인 로직은 바꾸지 않는다. V6와는 다른 API 분기다.

### V6 — 계정 이름 공백 저장

- **기능·페이지·근거:** `/account` 이름 폼, Account.handleNameSubmit → useUpdateName → PATCH `/api/auth/me`; api.ts 이름 trim(현재 307행); store.updateUserName.
- **현재 정상·검증 위치 [확인]:** UI required는 공백을 통과시킨다. 서버 trim 후 빈 이름이면 400·저장 실패 토스트, 원래 이름 유지.
- **변경할 코드·방향 [제안]:** PATCH 분기의 name 변수만 ON에서 trim 없이 받아 `if (!name)`를 유지한다. store의 trim은 그대로 두어 검증·저장 기준 불일치를 만든다.
- **구체 입력·UI 재현:** 유효 이름으로 임시 가입 → `/account` 이름을 스페이스 3개로 교체 → 이름 폼 Save 클릭 → 새로고침.
- **예상 비정상·관찰:** PATCH 200, Saved 토스트, 응답·다시 읽은 계정 이름 빈 문자열. React effect의 `if(user?.name)` 때문에 직후 폼에는 공백 원문이 남을 수 있으므로 새로고침 후 확인한다.
- **Oracle:** OFF 400·실패 토스트·재조회 원래 이름. ON 200·성공 토스트·재조회 name=`''`. 빈 문자열 입력은 HTML이 계속 막고 정상 이름은 양쪽 저장된다.
- **원상복구:** PATCH name trim 복원, OFF 후 유효 이름 저장 또는 reset·계정 재생성.
- **영향 가능성:** 로그인 이름 표시·계정 캐시에 영향. 주문 고객 이름은 별도 formData이므로 자동 변경되지 않는다.

### V7 — 배송 도시 빈값 수용

- **기능·페이지·근거:** `/checkout` id=city Input, Checkout.handleInputChange/handleSubmit → POST `/api/orders`; api.ts required 배열에는 city 없음.
- **현재 정상·검증 위치 [확인]:** 도시 빈값은 HTML required로 제출 차단. 서버는 city 누락을 검사하지 않는다.
- **변경할 코드·방향 [제안]:** ON에서 city Input의 required만 false로 바꾼다. 별표·라벨과 나머지 필수값을 유지해 계약 위반이 보이게 한다.
- **구체 입력·UI 재현:** 상품 1개 → checkout에서 city만 `''`, 나머지 6개 필수값 정상 → Submit Order Request.
- **예상 비정상·관찰:** 201·주문 상세 이동. 응답 상세 customer.city가 빈값이며 주소 표시에서 도시가 빠진다.
- **Oracle:** OFF city.valueMissing=true·POST 0건, ON 201·조회 customer.city=`''`. postalCode는 정상값으로 두어 주소의 다른 부분과 혼동하지 않는다. 공백 city는 기존 공백이므로 이 후보 입력으로 쓰지 않는다.
- **원상복구:** city required 복원, OFF·reset·cart 정리.
- **영향 가능성:** 배송지 표시만 영향. 서버 필수 4개 기준은 바뀌지 않는다. UI 요구와 API 계약 차이를 노출하는 신규 UI 주입이다.

### V8 — 공백 주소 수용

- **기능·페이지·근거:** `/checkout` address, Checkout.handleSubmit → POST `/api/orders`; api.ts `required.filter(k => !payload.customer?.[k]?.trim())`(현재 620행).
- **현재 정상·검증 위치 [확인]:** UI text required는 공백 주소를 통과시키고 서버의 trim 기반 필수값 검사가 400으로 차단한다. store.createOrder는 customer 원문을 저장한다.
- **변경할 코드·방향 [제안]:** ON에서 missing 계산 중 **k==='address'인 경우에만** raw truthiness로 판단하고 나머지 필드는 기존 trim 검사를 유지한다. required 배열 자체는 유지한다.
- **구체 입력·UI 재현:** 상품 담기 → checkout address=`   `, 나머지 필수값 정상 → 제출.
- **예상 비정상·관찰:** 201·성공 이동, 상세의 주소 줄이 시각적으로 비어 있고 조회 customer.address는 공백 원문이다.
- **Oracle:** OFF 400 missing_fields/fields에 address, 실패 토스트·cart 유지. ON 201 및 상세조회 `customer.address.trim()===''`·cart 비움. 실제 빈값은 양쪽 거부, 정상 주소는 양쪽 수용.
- **원상복구:** address도 trim 기반 조건으로 복원, OFF·reset·새 컨텍스트.
- **영향 가능성:** 주문 기록의 주소만 부정확. 필터 전체의 trim을 제거하면 이름/이메일까지 동시 결함이 되므로 금지한다.

### V9 — 재설정 암호 확인 불일치 수용

- **기능·페이지·근거:** `/reset-password`, ResetPassword.handleSubmit의 `if(password !== confirm)`; POST `/api/auth/reset`에는 token/password만 전송.
- **현재 정상·검증 위치 [확인]:** 두 값 불일치 시 localError를 설정하고 return한다. 서버는 confirm을 받지 않아 관계 검증을 할 수 없다.
- **변경할 코드·방향 [제안]:** ON에서 불일치 거부 조건만 우회한다. required/minLength/토큰 유효성 검사는 유지한다.
- **구체 입력·UI 재현:** 임시 계정으로 forgot 링크 발급 → Set New Password → password=`NewPass!123`, confirm=`Different!456` → Set Password.
- **예상 비정상·관찰:** POST 200·`/account` 이동. password 값으로 실제 변경되며 confirm 값은 무시된다.
- **Oracle:** OFF 로컬 alert “두 비밀번호가 서로 다릅니다.”·POST 0건, 기존 암호 유지. ON POST 200·새 password로 로그인 성공, confirm으로는 실패. 같은 값 통제 입력은 양쪽 성공하되 매 실험 새 토큰을 쓴다.
- **원상복구:** 불일치 가드 복원, OFF·reset·새 계정/토큰.
- **영향 가능성:** 해당 계정 암호/세션·토큰을 변경/소비한다. 일반 로그인 및 Account 확인 로직은 그대로다.

### V10 — 계정 암호 확인 불일치 수용

- **기능·페이지·근거:** `/account`, Account.handlePasswordSubmit의 `pw.next !== pw.confirm`, useChangePassword → POST `/api/auth/password`.
- **현재 정상·검증 위치 [확인]:** 로컬 pwLocalError+return, POST 없음. 서버는 currentPassword/newPassword만 받는다.
- **변경할 코드·방향 [제안]:** ON에서 로컬 불일치 차단만 우회한다. 서버 현재 암호·새 암호 8자·이전값과 다름 검사는 유지한다.
- **구체 입력·UI 재현:** 임시 계정 로그인 → account의 current는 올바른 값, new=`NextPass!123`, confirm=`OtherPass!456` → Change Password.
- **예상 비정상·관찰:** POST 200·Password changed 토스트, 폼 초기화. new 암호가 저장된다.
- **Oracle:** OFF “새 비밀번호가 서로 다릅니다.” alert·POST 0건·기존 암호 유지. ON 200·new 암호 로그인 성공. confirm 값은 로그인 실패. V2와 구분하기 위해 current를 반드시 정확히 입력한다.
- **원상복구:** 로컬 가드 복원, OFF·reset 또는 알고 있는 합성 암호로 정상 재변경.
- **영향 가능성:** 암호 및 다른 세션 무효화. V2를 함께 켜면 실패 원인을 구분하기 어려우므로 단독 평가한다.

### V11 — 정확히 8자인 가입 암호 거부

- **기능·페이지·근거:** `/signup`, Signup password minLength=8·8자 안내, api.ts signup의 `password.length < 8`.
- **현재 정상·검증 위치 [확인]:** 8자는 UI와 서버 모두 수용한다. 길이는 JS 문자열 length 기준이며 이번 비교는 ASCII만 쓴다.
- **변경할 코드·방향 [제안]:** ON에서 signup 조건만 `password.length <= 8`로 변경한다. UI minLength·안내 및 서버 minLength 응답값 8은 유지한다. 검증 제거가 아니라 비교 연산자 오류다.
- **구체 입력·UI 재현:** 새 이메일·이름과 password=`Ab12!xyz`(정확히 8자) 입력 → Create Account.
- **예상 비정상·관찰:** 브라우저 유효 폼인데 POST 400 weak_password, “8자 이상” 입력하라는 모순된 alert·가입 실패.
- **Oracle:** OFF 같은 8자 입력 201·로그인, ON 400·계정 미생성. 9자는 양쪽 성공, 7자는 양쪽 UI 차단. 반복마다 미사용 이메일을 쓴다.
- **원상복구:** `<8` 복원, OFF·재시작·생성한 통제 계정 reset.
- **영향 가능성:** 신규 가입의 경계값에만 영향, 로그인/변경/재설정 길이는 그대로. V1과 같은 조건을 수정하므로 두 후보 동시 활성화 금지.

### V12 — 상세 수량 11 허용

- **기능·페이지·근거:** `/product/:slug`, ProductDetail의 QuantitySelector 호출·handleAddToCart; QuantitySelector max 기본 10; useCart.addItem 신규 행.
- **현재 정상·검증 위치 [확인]:** 10에서 증가 버튼 disabled이고 increase 조건도 실패한다. 신규 cart 행은 전달 수량 그대로 저장하지만 정상 상세 UI는 11을 만들 수 없다.
- **변경할 코드·방향 [제안]:** 상세 호출에만 ON에서 `max={11}`, OFF에서 `max={10}`을 전달한다. 공유 QuantitySelector 내부 가드나 useCart는 바꾸지 않는다. 따라서 두 겹 차단 모두 같은 잘못된 상한 11을 따른다.
- **구체 입력·UI 재현:** 반드시 대상 상품이 cart에 없는 상태 → `/product/arc-pendant-light` → +로 10까지 → 한 번 더 클릭 → Add to Bag → `/cart`.
- **예상 비정상·관찰:** 11 선택·토스트·cart Qty 11. Arc 단가 485 기준 소계 5,335. 서버는 수량을 검증하지 않아 주문까지 11을 전달할 수 있다.
- **Oracle:** OFF 10에서 증가 불가·cart 10/소계 4,850, ON 상세와 새 cart 행 모두 11/소계 5,335. 기존 행에 추가하면 addItem의 합산 clamp=10이 가려 버리므로 신규 행 전제를 확인한다.
- **원상복구:** 상세 max=10 복원, OFF·maison-cart 비움·생성 주문 reset.
- **영향 가능성:** cart에서 수량을 다시 변경하면 updateQuantity가 10으로 줄일 수 있다. 조정 전에 증거를 수집한다. 위시리스트·Cart 선택기는 기본 상한 10 유지.

### V13 — 상세 수량 0 허용

- **기능·페이지·근거:** ProductDetail의 QuantitySelector·handleAddToCart, useCart.addItem 신규 행, Checkout의 `items.length===0` 조건, POST `/api/orders`.
- **현재 정상·검증 위치 [확인]:** min=1이라 감소 불가. 신규 addItem은 0을 거부하지 않고 Checkout/API는 항목 개수만 보므로 UI 제한이 핵심 차단이다.
- **변경할 코드·방향 [제안]:** 상세 호출의 min만 ON에서 `min={0}`, OFF에서 `min={1}`로 전달한다. 공유 선택기·store는 유지한다.
- **구체 입력·UI 재현:** 빈 cart → Arc 상세 → 수량 1에서 - 한 번 → Add to Bag → cart → checkout 필수값 정상 입력 → 제출.
- **예상 비정상·관찰:** 수량 0인 상품 행·소계 0, Checkout은 빈 장바구니로 보지 않음. 서버 201·주문 Qty 0, 소계 0/배송 25/총액 25.
- **Oracle:** OFF 최소 1·감소 불가. ON 0 선택/담기 및 조회 order.items의 quantity=0. 금액 보조 Oracle은 서버 원본 상품/현 배송식 기준이다. 실제 신규 행 존재와 수량을 우선 확인한다.
- **원상복구:** 상세 min=1 복원, OFF·cart 정리·reset.
- **영향 가능성:** Cart의 updateQuantity(0)는 삭제하지만 상세 신규 담기는 해당 함수를 거치지 않는다. Cart에서 조정하기 전에 관찰한다. 0개 주문은 메모리 데이터이므로 격리·reset한다.

### V14 — 재설정 불일치 오류 안내 누락

- **기능·페이지·근거:** ResetPassword.handleSubmit의 localError 설정/return 및 폼의 `{(reset.isError || localError) && ... role="alert"}` 표시, `/reset-password`.
- **현재 정상·검증 위치 [확인]:** 불일치면 네트워크 요청 없이 localError alert를 보여주고 폼을 유지한다.
- **변경할 코드·방향 [제안]:** ON에서 **로컬 불일치 오류만** alert 표시 조건에서 제외하고 return과 오류 state 설정은 유지한다. 서버 mutation 오류 alert는 계속 보인다. 검증 통과 결함이 아니라 사용자 오류 안내 누락이다.
- **구체 입력·UI 재현:** 새 유효 토큰 → 8자 이상 password=`NewPass!123`, confirm=`OtherPass!456` → Set Password.
- **예상 비정상·관찰:** 폼/입력/URL 그대로·POST 0건·설명 없음. 버튼은 활성으로 남아 반복 클릭해도 반응 없어 보인다.
- **Oracle:** OFF는 해당 폼 안에 불일치 설명이 있는 visible alert, ON은 같은 불일치에서 설명 없음. 양쪽 POST 0건·암호 미변경. 값을 일치시키면 양쪽 성공해야 하므로 네트워크 단절/비활성 버튼 결함과 구분된다.
- **원상복구:** alert 조건에 localError 복원, OFF·새 컨텍스트로 오류 state 제거. 필요 시 reset/새 토큰.
- **영향 가능성:** 로컬 오류 표시만 영향. V9와 동시에 켜면 return을 우회해 안내 누락이 가려지므로 단독 평가한다.

## 6. 버그 재현 및 검증 방법

### 6.1 공통 데이터와 실행 절차 [제안]

1. 향후 구현 전에 원본을 백업하고 파일 해시·코드 버전을 기록한다. 현재 Git 저장소가 아니므로 Git 복원을 전제하지 않는다.
2. 후보 한 건만 구현·등록한 후 OFF 서버에서 정상 입력과 후보 입력을 모두 실행한다. ON만 실행해서 이미 존재하는 문제를 신규 주입으로 오인하지 않는다.
3. 제어기가 `POST /_reset`을 호출하고 새 BrowserContext를 만든다. reset은 서버 메모리만 복원한다. 쿠키/localStorage/React Query는 새 컨텍스트로 격리한다.
4. 주문 공통 입력은 firstName=`Test`, lastName=`Pilot`, email=`pilot@example.test`, address=`12 Test Street`, city=`Seoul`, postalCode=`04524`, country=`Korea`; phone/notes는 비워도 된다. 후보 대상 필드만 변경한다. 상품은 실제 `arc-pendant-light`, 상품 id `arc-pendant`, 단가 485를 사용한다.
5. 인증 후보는 `/signup`에서 매 실험 미사용 합성 이메일과 유효 이름·암호로 임시 계정을 만든다. V1/V5/V11의 테스트 대상 가입은 준비 가입과 구분한다. V4/V9/V14는 forgot UI가 제공하는 링크로 이동하고 토큰을 인위적으로 생성하지 않는다.
6. ON 서버에서도 같은 데이터·조작·지연(기본 250ms)·viewport·브라우저 버전을 사용한다. UI 토글 목록 수신이 끝난 뒤 조작한다. 서버와 브라우저를 다시 시작해 OFF로 복구한 뒤 동일 Oracle이 돌아오는지 확인한다.
7. 계정/주문 변화는 API 보조 조회 또는 UI 재조회로 확인한다. 보조 API는 증거 확인용이며, 결함 유발 조작은 UI로 수행한다. DOM 강제변경·request body 변조·강제 클릭으로 브라우저 검증을 우회하지 않는다.

서로 다른 localhost 포트의 서버라도 쿠키는 포트로 격리되지 않는다. OFF/ON에는 반드시 별도 BrowserContext를 사용한다. 서버 reset을 실행 중인 다른 실험과 공유하지 않는다.

### 6.2 Playwright 관찰 설계 [제안, 미실행]

프로젝트에 Playwright 패키지·설정·script는 없다. 아래는 향후 외부 평가 하네스 설계이며 실행 가능한 테스트 파일을 이번에 추가하지 않는다.

- 텍스트는 `getByLabel` 또는 실제 id 기반 locator로 입력한다. Footer/본문에 이메일 필드가 동시에 있으므로 signup/checkout/reset의 **대상 폼 범위**를 지정한다. V14의 alert도 Footer 등의 alert와 구분한다.
- 제출 버튼을 실제 클릭한다. 브라우저가 막는 정상 경로에서는 submit 이벤트 자체가 없을 수 있으므로 응답을 무조건 기다리면 타임아웃이 난다. 요청 listener를 먼저 붙이고 DOM validity와 요청 개수를 함께 확인한다.
- `required`, `type`, `minLength`, `validity.valueMissing/typeMismatch/tooShort`, `checkValidity()`를 보조 증거로 읽는다. `page.evaluate`는 관찰에만 사용하고 제약 속성을 지우거나 강제 submit하지 않는다.
- minlength의 실제 브라우저 판정은 입력 방식의 영향을 받는다. 암호 경계 테스트는 `pressSequentially` 등 실제 키 입력 경로로 값을 넣고 validity를 먼저 확인한다. fill만 사용한 자동화에서 너무 짧은 값이 전송되더라도 서버 400과 UI 오류로 정상 차단 여부를 별도 판정한다. 테스트 주입 효과와 입력 방식 효과를 혼동하지 않는다.
- QuantitySelector는 ± 버튼에 명시적인 접근성 이름이 없다. 상품 상세의 수량 영역/선택기 안 버튼 두 개를 DOM으로 확인하여 감소/증가로 구분하고 중간 숫자 span을 읽는다. 전역의 첫 번째 아이콘 버튼을 클릭하지 않는다. click(force:true)는 쓰지 않는다.
- 기대 응답은 `waitForResponse`를 클릭 전에 등록하고 URL+HTTP 메서드를 함께 필터링한다. 기대 무요청은 사전에 붙인 이벤트 카운터와 동기적인 로컬 오류/invalid 상태를 확인하고, 고정된 충분한 관찰 구간을 둔다. 무요청 타임아웃 하나만으로 오류 메시지 누락을 판정하지 않는다.
- response 4xx는 `requestfailed`가 아니다. 응답 상태·error 코드·visible alert/토스트·URL·폼 유지·cart 상태를 각각 수집한다. 성공 2xx도 부적절한 입력 수용의 증거가 될 수 있다.
- 비밀번호 변경의 실제 결과는 별도 새 컨텍스트의 정상 로그인 UI로 확인한다. 실패 확인 후 성공 확인은 상태를 분리한다. 토큰 만료 화면은 새로운 page/context에서 재조회하여 캐시가 성공 결과를 재사용하지 않게 한다.
- 주문 orderId는 POST 응답에서 취득하고 고정 MA-1003을 가정하지 않는다. 상세의 Qty/고객 필드 및 상태를 확인한다. name/address는 HTML 공백 렌더링 때문에 textContent만으로 혼동할 수 있어 응답의 원문/trim 결과를 보조 확인한다.
- console/pageerror/requestfailed는 부가 증거다. 외부 이미지/폰트 장애는 같은 OFF 기준선과 비교하며 주입 결함으로 집계하지 않는다.

### 6.3 객관적 판정·증거 포맷

[제안] 실행별 ID, OFF/ON, 원본 해시/변경 파일, 시드 초기화 시각, 입력 종류·길이, 조작 단계, URL, validity, 요청 횟수·상태·오류 코드, 화면 증거, 사후 상태, 통제 입력 결과, 복구 결과를 남긴다. 암호·세션·재설정 토큰 원문은 마스킹하고 스크린샷/trace/URL에도 포함되는지 확인한다.

판정은 다음을 모두 만족해야 한다.

1. OFF에서 후보의 정상 Oracle을 충족한다. 충족하지 못하면 기준선 실패/실험 미성립으로 분리한다.
2. ON에서 해당 후보의 예상 차이가 재현되며, 일반 정상 입력 통제 사례는 유지된다(V11처럼 정상 경계값 거부 자체가 목표인 경우 해당 경계만 제외).
3. OFF로 되돌리면 정상 Oracle이 다시 충족된다.
4. 제어기만 읽는 활성 ID와 관측 증상이 일치한다. 활성 ID 존재만으로 탐지 성공이라 하지 않는다.

`/gt.json`, `/api/bugs`, `body[data-bugs]`, `/_reset`은 평가 제어기용이다. 평가 대상 에이전트가 정답을 읽거나 상태를 초기화하지 않도록 실험 접근 정책을 정한다. 결과는 탐지/미탐/오탐/기준선 실패/환경 실패로 분리한다. 이 문서는 재현 가능성 설계이며 측정된 탐지율을 제공하지 않는다.

## 7. 버그 간 독립성 및 우선순위

### 7.1 독립 삽입 규칙

[제안] 한 ID가 여러 층을 바꾸더라도 하나의 입력 계약 위반을 유발하면 한 결함으로 취급한다. V1의 프론트/서버 길이 변경이 이에 해당한다. 한 층만 바꿔 UI 재현이 막히는 것을 독립 삽입으로 착각하지 않는다.

| 관계 | 충돌/은폐 가능성 | 평가 방법 |
|---|---|---|
| V1 ↔ V11 | signup의 같은 길이 조건을 반대 방향으로 변경 | 동시 활성화 금지. 각각 6/7/8 및 7/8/9 경계 통제 |
| V9 ↔ V14 | 불일치 return 우회 시 표시 오류가 사라짐 | 동시 활성화 금지 |
| V2 ↔ V10 | 같은 암호 변경 절차. 현재값/확인값 오류 원인 혼합 | 단독 활성화, 비대상 값은 정상 고정 |
| V3/V7/V8 | 같은 checkout 폼. 여러 잘못된 고객 필드가 한 주문에 섞임 | 각 실험 대상 필드 하나만 비정상 |
| V12 ↔ V13 | 상세 선택기의 상한/하한 조합 및 cart 잔존 상태 | 단독 활성화, 대상 상품 신규 cart 행 보장 |
| V4/V9/V14 | 토큰 소비·암호 변경으로 후속 실험 준비 상태 변함 | 매 실험 reset·새 계정·새 토큰 |
| V5 ↔ V6 | 가입과 이름 수정의 다른 분기지만 같은 name 저장소 | V6 준비 계정은 정상 이름으로 생성 |

공통 `isEmail`, API request 래퍼, 공유 store 검증을 전역 변경하면 여러 화면으로 영향이 번진다. 후보별 endpoint/필드/호출 위치에 국소 분기한다. V12/V13은 공유 QuantitySelector를 고치지 않고 상세 prop만 바꾸므로 Cart 기본 범위를 보존한다. 별도 의미를 가진 유사 후보를 동시에 켜지 않는다.

### 7.2 진행 순서

[제안] 1차 V3/V6/V7/V9/V11로 형식·공백·필수·관계·경계 탐지를 평가한다. 2차 V1/V5/V8/V10/V12/V13/V14로 중첩 검증·숫자·오류 피드백을 추가한다. 3차 V2/V4로 인증 상태와 다단계 토큰을 평가한다. V2의 구현은 쉽지만 사후 로그인 확인·세션 영향 때문에 운영 순서는 뒤로 둘 수 있다.

실제 탐지 성능은 HTTP 오류만 찾는 에이전트, 의미적 입력 계약을 이해하는 에이전트, 사후 상태까지 추적하는 에이전트 사이에서 다를 수 있다. 같은 후보에 UI 탐지와 API/상태 증거 수집 여부를 따로 기록한다.

## 8. 향후 구현 시 고려사항

- [제안] 기존 `docs/bugs.md`의 환경변수 토글 원칙을 따른다. 향후 `server/bugs/validation.ts`에만 입력 검증 메타데이터를 등록하고 실제 동작 분기와 연결한다. V1~V4는 기존 문서와 같은 의미를 유지하며 새 ID 중복도 다시 확인한다. 이번에는 등록하지 않았다.
- [확인] `server/bugs/index.ts`는 등록된 ID에 대해서만 `BUG_아이디=1` 또는 `BUGS_ON=all`을 읽고 서버 시작 시 고정한다. 현재 `validationBugs=[]`라 변수만 설정해도 이 문서의 결함은 생기지 않는다.
- [제안] 컴포넌트 최상위에서 `useBug('Vn')`, 서버에서 `isOn('Vn')`로 분기한다. 조기 return 뒤나 이벤트 함수·Zustand 내부에서 Hook을 호출하지 않는다. 토글 조회 전 false인 구간이 있으므로 실험 제어기가 준비 완료를 기다린다.
- [제안] 메타데이터 area는 validation, 대부분 symptom은 false_result, V14는 no_response로 선언할 수 있다. needs에는 UI validity/visible error/state comparison 등 실제 하네스 관찰 기준을 적는다. detectable은 예상이며 검증 후 갱신한다.
- [제안] 복구는 세 단계다. (1) BUGS_ON과 해당 BUG_Vn을 해제하고 서버 재시작/브라우저 새 컨텍스트로 동작 복원, (2) reset 및 브라우저 저장소 초기화로 상태 복원, (3) 해당 조건·props·등록만 백업으로 되돌려 코드 복원. reset만으로 토글이나 localStorage가 초기화되지 않는다. preview 프론트 변경은 재빌드가 필요하다.
- [제안] 향후 구현 후 tsc 앱/서버, npm test, lint, build와 해당 후보 OFF/ON/OFF 시나리오를 확인한다. 현재 example.test.ts는 업무 검증이 아니므로 기존 테스트 성공만으로 주입 검증을 대체할 수 없다. 이번 작업은 문서만 생성하므로 빌드나 업무 테스트를 실행하지 않았다.
- [제안] 코드 변경과 별개로 기준선을 보강할 경우(예: 주문 API 수량/이메일 검증 추가) 실험 기준선 버전을 새로 고정한다. 현재 설계의 V3/V7/V12/V13은 기존 서버 공백에 의존하므로 강화된 서버에서는 그대로 재현되지 않을 수 있다. 새 기능을 임의로 가정하여 기존 계획의 성공을 주장하지 않는다.

### 최종 추천 3개

1. **V3 — 주문 이메일 형식 검증 누락:** Checkout의 type 한 곳만 국소 변경한다. 잘못된 이메일 입력 → 주문 성공 → 상세에서 값 확인이라는 짧고 명확한 UI 증거가 있다. 형식 검증과 잘못된 성공 처리를 함께 평가한다.
2. **V6 — 계정 이름 공백 저장:** PATCH 분기의 trim 처리 한 곳으로 검증·저장 불일치를 만든다. 스페이스만 입력 → Saved → 재조회 이름 빈값이라는 강한 사후 상태 Oracle이 있고, 서버 공백 문자열 검증 탐지력을 평가하기 좋다.
3. **V11 — 정확히 8자인 가입 암호 거부:** 비교 연산자 `<`를 `<=`로 바꾸는 작은 변경이다. 7/8/9 경계와 UI 안내·서버 응답의 모순이 명확해 단순 검증 제거보다 정교한 탐지 성능을 평가한다. 정상 입력 거짓 거부도 평가 범위에 포함할 수 있다.

추천은 구현 난이도·UI 재현 길이·Oracle 명확성에 근거한 설계 판단이며 실제 재현 또는 탐지 성능을 측정한 결과는 아니다.

