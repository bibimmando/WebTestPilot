# 복원 구현 내역

작성: 2026-10-09 (Asia/Seoul). 범위·ID 대응·결과는 [목록](RESTORED_BUG_CATALOG.md), UI 조작은 [수동 테스트](RESTORED_BUG_MANUAL_TEST.md), 병합은 [호환성](BUG_MERGE_COMPATIBILITY.md).

## 수정 및 추가 파일

| 파일 | 관련 함수 / 변경 |
|---|---|
| server/bugs/validation.ts | validationBugs에 V1~V5 메타데이터. BUG-001~005 및 과거 ID 연결 |
| server/bugs/validation-behavior.ts (신규) | accountNameForValidation(V2), rejectsSignupPassword(V5). 서버 검증 결함 전용 모듈 |
| server/api.ts | 전용 모듈 import, signup 길이 조건 및 PATCH 이름 전처리의 2개 호출 지점 |
| src/bugs/validation/useValidationBugs.ts (신규) | useCheckoutValidationBugs(V1/V3), useResetValidationBug(V4). 기존 useBug 사용 |
| src/pages/Checkout.tsx | 최상위 hook, email type / city required 2개 속성 |
| src/pages/ResetPassword.tsx | 최상위 hook, handleSubmit의 불일치 거부 조건 |
| src/test/restored-validation-api.test.ts (신규) | 실제 HTTP 서버/handleApi/저장소/레지스트리 통합 검증 |
| src/test/restored-validation-ui.test.tsx (신규) | 실제 Checkout 및 ResetPassword의 필드/handler 검증 |

package.json·잠금 파일·공통 토글 index/types·useBugs·store·다른 분야 레지스트리·CSS는 수정하지 않는다. hooks는 조기 return 전에 호출하며 기존 제출 방어/인증/토큰 검사를 보존했다.

## 정상 및 ON 동작

| 새 ID | OFF (원래 로직) | ON (과거 구현 재현) |
|---|---|---|
| V1 | Checkout email type=email, required 유지 | type=text, invalid-address가 브라우저 형식 검사를 통과 |
| V2 | PATCH 이름 trim 후 빈값 400 | raw 이름 검증. 스페이스가 truthy라 통과하고 기존 updateUserName이 trim해 빈 이름 저장 |
| V3 | Checkout city required=true | city required=false, 빈 도시가 제출 가능 |
| V4 | reset password!==confirm이면 localError/return | 불일치 비교만 우회. 첫 password만 서버에 전달, 성공 시 기존 흐름대로 /account |
| V5 | signup password.length<8 거부 | password.length<=8 거부. UI 안내와 서버 minLength 응답값은 8 유지 |

V2는 정확히 빈 문자열을 계속 거부하며 일반 이름은 저장소에서 trim한다. V5는 7자 거부/9자 성공 유지하며 암호 변경·재설정 길이 검사는 바꾸지 않는다. V4는 required/minLength/토큰 검사를 유지하며 Account의 확인값 비교는 바꾸지 않는다. V1/V3는 서버 검증을 새로 제거하지 않는다.

## 활성화와 복원

기존 서버 process.env 체계를 사용한다. 새 토글 BUG_V1~BUG_V5의 값이 정확히 문자열 '1'일 때 ON, 미설정이면 OFF. BUGS_ON='all'은 등록된 다른 유형까지 전부 켠다. 서버 시작 때 고정하며 환경변수 변경 후 재시작 + 화면 새로고침이 필요하다. /api/bugs와 /gt.json은 자동으로 새 ID를 제공한다. 브라우저 토글 수신 전에는 기존 정상 동작이 적용된다.

```powershell
Set-Location 'C:\Users\custa\OneDrive\Desktop\we\Maison'
$env:BUG_V1 = '1'
npm.cmd run dev -- --host 127.0.0.1 --port 8080 --strictPort
```

동작 복원: Ctrl+C → BUGS_ON와 BUG_V1~BUG_V5 제거 → 재시작 → 새 브라우저 상태 → enabled=[] 확인. 과거 BUG_V3는 의미가 바뀌었으므로 이전 명령을 재사용하지 않는다. BUG_V6/V7/V9/V11은 이제 등록되지 않아 효과가 없다. 기존 설계의 과거 V1/V2/V4/V5도 같은 키를 예약할 수 없으며 다른 번호를 부여해야 한다.

상태 복원: V2는 정상 이름 재저장, V4는 전용 계정의 새 링크로 정상 암호 재설정. 실제 사용 중인 서버에 /_reset을 호출하지 않는다. 자동 테스트는 독립 메모리 서버를 닫는 것으로 자체 데이터를 정리한다. DB 삭제/초기화를 수행하지 않았다.

코드 복원은 위 연결 지점만 원래 식으로 되돌리고 validation.ts의 이번 5개 항목과 사용하지 않는 전용 모듈/테스트만 제거한다. 다른 사람이 추가한 버그는 보존한다. 원래 식: Checkout type="email"/city required, ResetPassword if(password!==confirm), signup if(password.length<8), PATCH const name=(payload.name??"").trim(). 전체 git reset/checkout으로 다른 변경을 덮어쓰지 않는다. 마지막으로 타입 검사/빌드/재시작하고 preview는 프론트 재빌드한다.

## 검사 명령 및 결과

```powershell
node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.node.json --noEmit
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

tsc 양쪽, Vitest 17건, 변경 파일 lint, build PASS. 전체 lint의 기존 3개 오류는 미수정. Windows 샌드박스 설치 ENOTFOUND/build·test realpath EPERM은 권한 허용 재시도로 해소했다. UI 테스트는 jsdom 제약 속성/validity와 실제 handler를 확인하며 실제 브라우저의 클릭 제출·네트워크·페이지 이동을 종단 검증하지 않는다. 상세 한계는 목록의 미검증 항목 참조.
