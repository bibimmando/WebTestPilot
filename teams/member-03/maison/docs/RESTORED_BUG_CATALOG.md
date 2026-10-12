# 복원 버그 목록 및 문서 대조

작성: 2026-10-09 (Asia/Seoul). 현재 브랜치 main 유지. 기존 docs Markdown 9개를 모두 분석했으며 변경하지 않았다. 과거 실행 기록은 이번 검증 결과로 재사용하지 않았다.

## 범위와 ID 변경

구체적인 입력 검증 후보는 **14개**, 실제 구현 이력이 문서에 기록된 것은 **5개**, 이번 복원은 **5개**다. docs/bugs.md의 F1 주문 중복 제출과 V2 길이 검사, U1 CSS는 설명용 예시이며 복원 대상이 아니다. BUG_CATALOG.md는 링크만 있고 파일이 없어 해당 문서의 추가 후보 수/구현 이력은 확인할 수 없다. Functional / Routing / UI의 구체 구현 이력은 제공된 문서에서 확인되지 않았다.

사용자의 추가 지시로 과거 V3/V6/V7/V9/V11을 순서대로 V1/V2/V3/V4/V5로 재번호화했다. BUG-001~005의 의미와 명칭은 유지한다. **이 문서의 새 V ID는 기존 설계의 동명 V ID와 의미가 다를 수 있다.** 과거 ID를 별칭 토글로 제공하지 않는다. 특히 BUG_V3는 이제 도시 결함이며 과거 이메일 결함이 아니다. 과거 설계 후보는 아래에서 반드시 `과거 Vn`으로 표기한다.

| 새 ID | 기존 문서 ID | 과거 V ID | 이름 / 유형 | 토글 | 상태 및 이번 검증 |
|---|---|---|---|---|---|
| V1 | BUG-001 | V3 | 주문 이메일 형식 검증 누락 / Input Validation | BUG_V1=1 | 복원. 실제 Checkout의 typeMismatch OFF true / ON false, required 유지. 브라우저 주문 E2E 미검증 |
| V2 | BUG-002 | V6 | 계정 이름 공백 저장 / Input Validation | BUG_V2=1 | 복원. HTTP OFF 400/이름 유지, ON 200/재조회 빈 이름, 정상 이름 및 빈 문자열 통제 PASS |
| V3 | BUG-004 | V7 | 배송 도시 빈값 수용 / Input Validation | BUG_V3=1 | 복원. 실제 Checkout의 valueMissing OFF true / ON false, 다른 required 유지. 브라우저 주문 E2E 미검증 |
| V4 | BUG-005 | V9 | 재설정 암호 확인 불일치 수용 / Input Validation | BUG_V4=1 | 복원. 실제 handler OFF alert/요청 없음, ON 첫 암호 mutation, 일치 입력 양쪽 PASS. 실제 브라우저 사후 로그인 E2E 미검증 |
| V5 | BUG-003 | V11 | 정확히 8자인 가입 암호 거부 / Input Validation | BUG_V5=1 | 복원. HTTP 7자 양쪽 400, 8자 OFF 201/ON 400, 9자 양쪽 201 PASS |

각 항목은 docs/INPUT_VALIDATION_IMPLEMENTATION.md의 같은 BUG-번호 절, INPUT_VALIDATION_MANUAL_TEST.md의 같은 시나리오, INPUT_VALIDATION_BUG_PLAN.md의 **과거** V ID 절에 대응한다. INPUT_VALIDATION_TEST_CHECKLIST.md도 현재 파일 내용은 5개를 열거한다.

## 구현하지 않은 설계 후보

모두 INPUT_VALIDATION_BUG_PLAN.md에만 계획이 있고 구현 이력이 없다. 정보가 충분해도 이번에는 새로 구현하지 않는다.

| 과거 ID | 이름 | 발생 조건 / 제안 구현 | 제외 이유 |
|---|---|---|---|
| V1 | 7자 가입 암호 허용 | Signup minLength=7 및 signup 서버 길이 <7 | 설계만 존재. 과거 V11과 같은 길이 분기 충돌 |
| V2 | 잘못된 현재 암호 허용 | Account에서 틀린 현재 암호, verifyPassword 거부 우회 | 설계만 존재. 인증 검증 약화 |
| V4 | 사용한 재설정 토큰 재수용 | 성공한 링크 재사용, consumeResetToken 생략 | 설계만 존재. 토큰 보안 검증 약화 |
| V5 | 가입 이름 공백 수용 | signup의 name trim 제거, 저장 시 trim | 설계만 존재 |
| V8 | 공백 주소 수용 | 주문 address만 raw truthiness 검증 | 설계만 존재 |
| V10 | 계정 암호 확인 불일치 수용 | Account의 확인값 비교 우회 | 설계만 존재 |
| V12 | 상세 수량 11 허용 | 상세 QuantitySelector max=11, 신규 cart 행 | 설계만 존재 |
| V13 | 상세 수량 0 허용 | 상세 QuantitySelector min=0, 신규 cart 행 | 설계만 존재 |
| V14 | 재설정 불일치 오류 안내 누락 | ResetPassword localError 표시만 제거, return 유지 | 설계만 존재. 과거 V9가 켜지면 증상 은폐 |

미복원된 **구현 이력 확인 항목은 0개**다. 확인할 수 없는 외부/누락 문서 내용은 추측하지 않았다.

## 실제 코드 대조와 불일치

- server/api.ts의 handleApi signup/PATCH auth/me/order/reset 분기, store.updateUserName, Checkout.handleSubmit과 email/city Input, ResetPassword.handleSubmit, Signup minLength=8, useBug/isOn이 실제 존재한다. 과거 5개 구현 조건을 그대로 적용할 수 있다.
- 작업 시작 시 네 분야 레지스트리는 모두 빈 배열이고 해당 5개 분기가 없다. 구현 문서의 완료 주장은 **과거 이력**으로만 사용했다.
- docs/PROJECT_OVERVIEW.md·SERVER_SETUP.md·BUG_INJECTION_GUIDE.md는 과거 Git 없음/npm 없음/레지스트리 0개를 설명한다. 지금 Git main과 Node/npm이 존재하며 복원 후 등록 5개다. 최초 node_modules는 없었고 이번 npm ci로 설치했다.
- BUG_CATALOG.md, docs/backups/input-validation-20261009, scripts/verify-input-validation.mjs, doc/INPUT_VALIDATION_TEST_CHECKLIST.md 등 과거 링크/산출물은 현재 없다. 이를 존재하는 증거로 취급하지 않는다. 이번에는 새 테스트 2개를 제공한다.
- 구현 문서/수동 매뉴얼은 docs 체크리스트가 과거 3개라고 설명하지만 현재 체크리스트 실제 내용은 5개다. 설계 문서는 doc에 작성했다고 설명하지만 현재 설계 파일은 docs에 있다.
- 문서의 Maison-main/Downloads 경로와 현재 작업 경로가 다르다. 현재 서버는 Node/Vite, 메모리 저장소이며 Python/DB/결제/메일 외부 연동은 없다.
- 문서의 타입 오류 시 빌드 중단 설명과 달리 build는 vite build만 실행하므로 tsc를 따로 실행했다.
- server/pages.ts의 암호 재설정 미구현 주석은 실제 API/UI와 불일치한다. 상품 컬렉션은 실제 8개이며 과거 일부 설명의 5개와 다르다.

## 기존 검증 공백 (신규 주입 수에 포함하지 않음)

정적 코드에서 주문 이메일 형식/도시·우편번호·국가 필수/수량 양수·정수·1~10 검증 누락, JSON 런타임 타입 검사 공백, $500 초과 무료배송과 안내의 $500 이상 차이, reset/ground truth 메서드·인증 제한 없음, 서버 세션 TTL 검사 없음, 구독 미저장을 확인했다. V1/V3는 기존 API 공백에 의존하므로 OFF에서도 API를 직접 호출하면 잘못된 이메일/빈 도시가 수용될 수 있다. 이것은 브라우저 결함의 ON 증거가 아니다. 해당 공백은 강화/변경하지 않았다. 외부 이미지·폰트 장애도 주입 결함으로 집계하지 않는다.

## 자동 검증 범위

Vitest 3개 파일 **17/17 PASS** (기존 1개 + API 8개 + UI 8개). 각 새 파일은 OFF → V1 → V2 → V3 → V4 → V5 → 전체 ON → OFF 순서. API는 매번 새 모듈/새 메모리 store/임의 로컬 포트를 사용한다. UI는 실제 페이지를 렌더링하되 useBug·API·인증 hooks 및 Layout/cart를 mock한다. 서버 API 테스트와 화면 테스트를 결합한 브라우저 E2E라고 주장하지 않는다.

앱/서버 tsc PASS, 변경 파일 lint PASS, build PASS, Vite 127.0.0.1:18080 기동 PASS. 전체 lint는 기존 command.tsx/textarea.tsx/tailwind.config.ts 오류 3개·경고 7개로 FAIL. 최초 설치 ENOTFOUND 및 샌드박스 realpath EPERM은 권한 허용 재시도로 해소했다. build의 browserslist/Tailwind duration/청크 크기 경고는 남아 있다.

미검증: Playwright/실제 브라우저 E2E, 모바일·전체 화면 회귀, preview, 실제 다른 유형 브랜치와 병합, 모든 32가지 토글 조합, WebTestPilot 탐지 성능. detectable=false는 측정된 탐지율이 아니다.
