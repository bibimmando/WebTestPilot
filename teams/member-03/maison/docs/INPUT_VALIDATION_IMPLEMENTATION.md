# 입력 검증 버그 구현 내역

작성·검증일: 2026-10-09 (Asia/Seoul). 대상은 현재 Maison-main 소스이며 로컬 평가 전용이다. [수동 매뉴얼](INPUT_VALIDATION_MANUAL_TEST.md), [기록 체크리스트](../doc/INPUT_VALIDATION_TEST_CHECKLIST.md).

## 분석과 범위

작업 전에 docs/PROJECT_OVERVIEW.md, SERVER_SETUP.md, ARCHITECTURE.md, BUG_INJECTION_GUIDE.md, INPUT_VALIDATION_BUG_PLAN.md, README 및 실제 코드를 대조했다. 현재 Git 저장소가 아니므로 git diff/브랜치 기반 복원은 사용할 수 없다.

기존 매뉴얼·구현 문서는 3개 구현을 주장했지만 실제 validationBugs는 빈 배열이고 해당 조건 분기도 없었다. 과거 문서의 성공 기록은 이번 실행 증거로 재사용하지 않았다. 사용자의 명시적 선택에 따라 최종 추천 3개 대신 설계의 1차 후보 5개 V3/V6/V7/V9/V11을 확정했다. 기존 동명 문서 두 개는 사용자 승인에 따라 docs/backups/input-validation-20261009/에 원문을 백업한 뒤 새 내용으로 작성했다. 기존 설계·개요·실행 안내·docs 체크리스트는 수정하지 않았다. 새 체크리스트는 요청대로 단수 doc/에 생성했다.

| BUG ID | 설계·실행 ID | 이름 | 상태 |
|---|---|---|---|
| BUG-001 | V3 | 주문 이메일 형식 검증 누락 | 구현, 기본 OFF, ON 브라우저 재현 |
| BUG-002 | V6 | 계정 이름 공백 저장 | 구현, 기본 OFF, ON 브라우저/API 재현 |
| BUG-003 | V11 | 정확히 8자인 가입 암호 거부 | 구현, 기본 OFF, ON 브라우저/API 재현 |
| BUG-004 | V7 | 배송 도시 빈값 수용 | 구현, 기본 OFF, ON 브라우저 재현 |
| BUG-005 | V9 | 재설정 암호 확인 불일치 수용 | 구현, 기본 OFF, ON 브라우저/사후 로그인 재현 |

실행 토글은 기존 규약 BUG_V3/BUG_V6/BUG_V11/BUG_V7/BUG_V9=1 또는 BUGS_ON=all이다. 문서 BUG ID는 주석과 레지스트리 title에 연결했다. API·정답지·body[data-bugs] 구조는 유지하고 사용자 화면에 결함 이름·ID를 렌더링하지 않는다. useBug는 컴포넌트 최상위에서 호출해 조건부 return 뒤 Hook 문제를 피한다.

## 파일·함수·전후 로직 및 복원

### BUG-001 / V3

- 파일/함수: src/pages/Checkout.tsx, Checkout email Input, 기존 handleSubmit.
- 전: type="email", required. 후: type={bugV3 ? "text" : "email"}, required 유지.
- 조건: V3 ON, 상품 존재, email=invalid-address, 다른 필수값 정상.
- 결과: 브라우저 email 형식 차단 없이 주문 생성, 상세 이메일에 원문 표시.
- 정상 영향: 정상 이메일 주문과 중복 제출 방어, 성공 후 cart 비우기 유지. 서버 이메일 형식 검증 공백은 기존 조건이며 변경하지 않음. 다른 이메일 폼/isEmail/공통 Input은 유지.
- 코드 복원: type="email" 복원, bugV3 hook·주석·V3 레지스트리 항목만 제거.

### BUG-002 / V6

- 파일/함수: server/api.ts, handleApi PATCH /api/auth/me 이름 전처리.
- 전: const name=(payload.name ?? "").trim() 후 if(!name) 거부.
- 후: isOn("V6")이면 trim 전 원문, OFF면 기존 trim. 거부 분기는 유지.
- 조건: 인증된 사용자가 ASCII 스페이스 3개를 제출.
- 결과: 원문 공백은 truthy라 검증 통과, 기존 store.updateUserName이 trim하여 빈 이름 저장.
- 정상 영향: 일반 이름 저장 및 trim 유지, 정확히 빈 문자열은 여전히 400. 가입 이름/인증/세션은 유지. 빈 이름 상태에서는 UI 저장 버튼 조건 때문에 재실험 전 정상 이름을 복구해야 함.
- 코드 복원: PATCH의 name을 기존 trim으로 복원하고 V6 주석·등록만 제거. signup의 name은 건드리지 않음.

### BUG-003 / V11

- 파일/함수: server/api.ts, handleApi POST /api/auth/signup의 password 길이 검사.
- 전: password.length < 8. 후: isOn("V11") ? password.length <= 8 : password.length < 8.
- 조건: 정상 이름/미사용 이메일/정확히 8자 암호 Ab12!xyz.
- 결과: 400 weak_password; minLength=8 및 UI의 8자 안내는 그대로여서 유효 경계를 거짓 거부.
- 정상 영향: 9자 이상 가입/로그인 유지, 7자 이하 차단 유지. 정상 입력 중 8자만 거부하는 것이 목표 결함. 암호 변경·재설정 조건은 유지.
- 코드 복원: signup 비교를 <8로 되돌리고 주석·V11 등록 제거.

### BUG-004 / V7

- 파일/함수: src/pages/Checkout.tsx, Checkout city Input, 기존 handleSubmit.
- 전: required. 후: required={!bugV7}.
- 조건: V7 ON, City 완전히 빈 문자열, 다른 필수값 정상(특히 정상 이메일).
- 결과: 도시 없이 주문 생성, 상세 배송 주소에 도시 누락.
- 정상 영향: 도시가 있는 정상 주문 유지; postalCode/country 등 다른 required 유지. 원래 주문 API가 city 필수를 검사하지 않는 조건에 의존한다. 공백 도시는 기존 공백과 혼동하므로 실험에서 제외.
- 코드 복원: city required 복원, bugV7 hook·주석·V7 등록 제거.

### BUG-005 / V9

- 파일/함수: src/pages/ResetPassword.tsx, ResetPassword.handleSubmit.
- 전: if(password !== confirm) 로컬 오류 및 return.
- 후: if(!bugV9 && password !== confirm). 나머지 제출·오류·토큰 처리는 유지.
- 조건: 유효한 미사용 토큰, New=FirstPass!123, Confirm=OtherPass!456.
- 결과: 확인 불일치에도 첫 번째 암호로 변경, /account 이동; 기존 암호와 확인값은 로그인 실패, 새 암호만 성공.
- 정상 영향: 일치 입력 성공, required/minLength 및 서버 토큰 존재·만료·소비 검증 유지. 성공 시 기존 세션이 무효화되어 전용 합성 계정/새 토큰 필요. Account의 암호 확인 비교는 수정하지 않음.
- 코드 복원: 원래 if(password !== confirm) 복원, hook import/선언/주석·V9 등록 제거.

### 공통

server/bugs/validation.ts에 5개 메타데이터를 등록하고 server/api.ts 기존 bugs import에 isOn을 추가했다. detectable=false는 WebTestPilot 탐지율 측정값이 아니다. scripts/verify-input-validation.mjs는 로컬 서버의 OFF→ON→OFF 비교 보조 도구로 추가했다. DB 구조, 저장소 모델, 잠금 파일과 package.json은 변경하지 않았다. 외부 서비스, SQL 인젝션, 코드 실행, 인증 우회 후보 V2/V4는 구현하지 않았다.

## 실제 테스트 결과

환경: Windows, Node v24.20.0 / npm 11.19.0, npm ci --no-audit --no-fund으로 497개 패키지 설치. 최초 설치는 registry.npmjs.org ENOTFOUND와 정리 EPERM으로 실패했고, 샌드박스 밖 재시도는 성공했다. 설치 도구의 3개 install script 승인 관련 경고가 있었지만 최종 빌드·서버 실행을 확인했다.

| 검사 | 실제 결과 |
|---|---|
| 앱/서버 타입 검사 | PASS: node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit 및 tsconfig.node.json |
| build | 최초 샌드박스 realpath EPERM 실패, 권한 허용 재시도 PASS: 2162 modules, 17.23초 |
| 기존 Vitest | 최초 realpath EPERM 실패, 재시도 PASS: example.test.ts 1건. 업무 시나리오를 검증하는 테스트는 아님 |
| 수정 소스 lint | PASS: api.ts, validation.ts, Checkout.tsx, ResetPassword.tsx |
| 전체 lint | FAIL: 기존 command.tsx:24, textarea.tsx:5 no-empty-object-type, tailwind.config.ts:129 no-require-imports. 오류 3/경고 7. 관련 없는 소스는 수정하지 않음 |
| 서버 시작 | PASS: 127.0.0.1:8080 OFF / 8081 전체 ON, API_DELAY_MS=0, strictPort. 서버 시작 오류 없음 |
| API 보조 비교 | PASS: node scripts/verify-input-validation.mjs, OFF→ON→OFF 세 단계 모두 통과 |
| 주요 화면 | 브라우저 상품 목록 13개, 상세, Checkout, 주문 상세, 로그인, Account, Signup, Forgot/Reset Password, Orders 로딩·상호작용 확인. 홈은 로그아웃 도착 확인 |

브라우저는 Codex 내장 Chromium의 Playwright locator 인터페이스를 사용했다. 프로젝트에 Playwright 의존성은 추가하지 않았다. ON에서 5개를 함께 켰으나 시나리오별 비정상 입력 필드는 하나만 사용했다. 이메일·도시 주문은 비로그인, 이름 테스트는 시드 test 계정, 재설정은 ui-v9@example.test 합성 계정으로 분리했다. OFF와 ON 사이 쿠키 공유 가능성을 고려해 서버별 세션을 비교 근거로 재사용하지 않았다.

| BUG | 비정상 입력 실측 | 정상 통제 및 OFF 비교 | 판정 |
|---|---|---|---|
| BUG-001 | ON invalid-address 주문 MA-1003 생성, 상세 원문 이메일·빈 cart 확인 | OFF type=email/typeMismatch=true 및 Checkout 유지. OFF 정상 주문 MA-1005 생성, 정상 주문 API 양쪽 201 | PASS(관측 범위) |
| BUG-002 | ON 스페이스 3개 저장 Saved, F5 후 빈 이름/빈 메뉴 이름 확인 | API OFF 공백 400/기존 이름 유지, ON 200/빈 이름. 일반 이름 양쪽 저장, 정확히 빈값 양쪽 400. OFF→ON→OFF PASS | PASS(관측 범위) |
| BUG-003 | ON Ab12!xyz 제출에 8자 이상 오류·Signup 잔류 | ON Ab12!xyzQ 가입 후 Orders/No orders yet. API 7자 양쪽 400, 8자 OFF 201/ON 400, 9자 양쪽 201, OFF→ON→OFF PASS | PASS(관측 범위) |
| BUG-004 | ON 빈 도시 주문 MA-1004 생성, 상세 04524 앞 Seoul 누락 | OFF required=true/valueMissing=true/Checkout 유지. 정상 도시 주문 및 API 정상 주문 성공 | PASS(관측 범위) |
| BUG-005 | ON 불일치 제출 후 Account 이동. 합성 계정 기존/확인 암호 401, 첫 새 암호 200 | OFF 불일치 안내·화면 잔류. OFF 일치 값 제출 성공, ON 새 링크에서 SecondPass!123 일치 제출 성공. API 정상 reset·토큰 재사용 400·새 암호 로그인 성공 | PASS(관측 범위) |

초기 브라우저 열기는 서버 시작 전 ERR_CONNECTION_REFUSED였다. 새 탭으로 재시도해 정상 로딩했다. AX의 대문자 버튼 표시와 실제 Playwright 이름이 달라 첫 Add to Bag 선택이 실패했고 대소문자 무시 선택자로 재시도했다. OFF 주문 정상값 변경 직후 첫 제출·URL 대기는 완료되지 않았으나 DOM 확인 후 재제출하여 성공했다. 준비/동기화 실패와 코드 결함을 혼동하지 않는다.

빌드 경고: 오래된 browserslist 데이터, 기존 Tailwind duration 클래스 모호성, 500KB 초과 JS 청크. 미검증: 단독 토글별 서버 실행, preview 모드, 전체 페이지/모바일 전수 회귀, 모든 입력 조합, WebTestPilot의 실제 탐지 성능. 프론트 OFF→ON→OFF 전체 재시작 비교는 수동 매뉴얼에 제공했으나 이번 자동화에서 완주하지 않았다. V9 OFF 차단 후 기존 암호 유지에 대한 별도 로그인은 미검증(로컬 차단 화면 확인); ON 변경 후 로그인은 실측했다. 모든 정상 기능을 보장한다고 주장하지 않는다.

## 복원 및 데이터 처리

실행 동작 복원: Ctrl+C → BUGS_ON 및 BUG_V3/V6/V11/V7/V9 제거 → 재시작 → 새 브라우저 상태 → /api/bugs enabled=[] 확인. reset만으로 토글은 꺼지지 않는다.

상태 복원: 서버 재시작 또는 POST /_reset은 실험 서버 메모리를 시드로 되돌린다. 별도 DB 변경·영속 데이터 삭제 없음. 브라우저 쿠키/cart/wishlist/Query 캐시는 사이트 데이터 삭제·새 창·새로고침으로 정리한다. V6은 정상 이름 재저장으로 개별 복구할 수 있고 V9는 전용 계정의 새 링크로 정상 재설정할 수 있다.

영구 코드 복원은 위 버그별 로직만 원래대로 바꾸고 validation.ts의 해당 5개 항목을 제거한다. 다른 사람이 추가한 항목은 보존한다. 서버의 isOn 사용이 없어지면 import도 제거한다. 보조 스크립트는 필요 없으면 해당 파일만 제거한다. 타입 검사·빌드 후 재시작하며 preview 사용 시 재빌드가 필요하다. 문서는 감사 기록으로 보존 가능하다.

## 설계 차이 및 보류

- 최종 추천 3개와 1차 후보 5개 간 범위 차이는 사용자가 5개를 명시해 해소했다.
- 기존 V ID 토글을 유지하면서 BUG-001~005를 추가 매핑했다. 과거 3개 문서의 BUG-003=V11 매핑을 유지하고 V7/V9를 004/005에 추가했다.
- 설계의 정적 경로·함수·검증 조건은 실제 코드와 일치했다. 코드 변경으로 행 번호가 이동하므로 endpoint/함수로 추적한다.
- V1은 V11과 동일 가입 길이 조건 충돌, V14는 V9와 불일치 분기 충돌. 선정 밖 V5/V8/V10/V12/V13은 적용하지 않았다.
- V2/V4는 인증·토큰 보안 검증 우회 성격이라 범위에서 제외했다.
- V3/V7의 서버 검증 공백은 기존 조건이다. 해당 서버 검증을 새로 추가하면 설계 결함이 UI에서 차단될 수 있으므로 이번 작업에서 기준선을 강화하지 않았다.

## 수정·추가 파일

- server/api.ts — V6/V11 국소 분기, isOn import.
- server/bugs/validation.ts — 5개 등록.
- src/pages/Checkout.tsx — V3/V7 필드 검증 토글.
- src/pages/ResetPassword.tsx — V9 확인값 비교 토글.
- scripts/verify-input-validation.mjs — 신규 API 비교 검사.
- docs/INPUT_VALIDATION_MANUAL_TEST.md — 새 매뉴얼 내용(원문 백업).
- docs/INPUT_VALIDATION_IMPLEMENTATION.md — 새 구현 기록(원문 백업).
- doc/INPUT_VALIDATION_TEST_CHECKLIST.md — 신규 기록지.
- docs/backups/input-validation-20261009/INPUT_VALIDATION_MANUAL_TEST.md 및 INPUT_VALIDATION_IMPLEMENTATION.md — 원문 보존본.

node_modules/dist 및 도구 캐시는 설치·빌드 산출물이다. 기존 docs/INPUT_VALIDATION_BUG_PLAN.md, docs/INPUT_VALIDATION_TEST_CHECKLIST.md와 나머지 문서는 그대로 보존했다.

### 추가 확인·화면 증거

ON에서 일치 입력 SecondPass!123으로 재설정한 후 해당 암호 로그인 200을 추가 확인했다. API 보조 스크립트 lint도 PASS다. BUG-004 주문 상세(도시 없이 주문 접수) 화면 증거는 [BUG-004-browser.png](backups/input-validation-20261009/BUG-004-browser.png)에 저장했다. 검증용 서버는 작업 종료 시 중지한다.
