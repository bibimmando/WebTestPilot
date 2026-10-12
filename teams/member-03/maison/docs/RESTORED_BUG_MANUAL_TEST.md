# Windows 수동 테스트

작성: 2026-10-09 (Asia/Seoul). 이 문서는 실행 절차다. **이번 작업에서 실제 브라우저 수동/E2E 실행은 미검증**이며 자동 검사 범위는 [목록](RESTORED_BUG_CATALOG.md)에 명시한다. 테스트에는 합성 계정만 사용한다.

## 실행 / URL / 종료

```powershell
Set-Location 'C:\Users\custa\OneDrive\Desktop\we\Maison'
node --version
npm.cmd --version
# 최초 설치에만 실행
npm.cmd ci --no-audit --no-fund

# OFF: 현재 셸의 실험 토글 정리
Remove-Item Env:BUGS_ON -ErrorAction SilentlyContinue
'V1','V2','V3','V4','V5','V6','V7','V9','V11' | ForEach-Object {
  Remove-Item -LiteralPath "Env:BUG_$_" -ErrorAction SilentlyContinue
}
npm.cmd run dev -- --host 127.0.0.1 --port 8080 --strictPort
```

주소: http://127.0.0.1:8080/. API도 같은 포트. 종료 Ctrl+C. ON은 위 OFF 정리 후 대상 하나만 `$env:BUG_V1='1'`처럼 설정하고 동일 명령으로 시작한다. V1~V5 중 선택한다. 모두 켜려면 BUGS_ON='all'; 향후 다른 유형도 함께 활성화된다. OFF 복원은 Ctrl+C 후 토글 정리/재시작. 환경변수 변경·reset만으로 실행 중 토글은 바뀌지 않는다.

별도 터미널:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8080/api/health'
Invoke-RestMethod 'http://127.0.0.1:8080/api/bugs'
```

신규 서버 health는 products=13/users=2/orders=2, enabled는 OFF [] 또는 대상 ID. 브라우저 Network에서 /api/bugs 완료를 기다리고 조작한다. OFF/ON은 별도 브라우저 프로필 또는 서로 격리된 BrowserContext로 사용한다. 쿠키는 포트별로 격리되지 않는다. URL host를 혼용하지 않는다.

## 공통 준비

주문(V1/V3): 새 비로그인 시크릿 창 → /product/arc-pendant-light → 수량 1 → Add to Bag → /cart → Checkout → /checkout.

| 필드 | 정상값 |
|---|---|
| First Name | Pilot |
| Last Name | Tester |
| Email | pilot@example.test |
| Street Address | 123 Test Street |
| City | Seoul |
| Postal Code | 04524 |
| Country | South Korea |
| Phone / Notes | 빈값 |

대상 필드 하나만 비정상으로 변경한다. 주문 ID는 응답/실제 URL에서 확인하며 고정 번호를 가정하지 않는다. 각 주문 후 cart가 비워지므로 다음 주문은 다시 담는다.

## V1 / BUG-001 / 과거 V3: 주문 이메일

1. 공통 주문 준비 후 Email만 `invalid-address`로 변경한다.
2. Submit Order Request를 클릭한다.
3. OFF: 이메일 형식 안내, /checkout 잔류, 주문 요청 없음, cart 유지.
4. ON: 주문 접수, /order/실제번호 이동, Delivery To에 invalid-address 표시, cart 비움.
5. 양쪽에서 정상 이메일로 다시 주문하면 성공해야 한다. 직접 API 잘못된 이메일 수용은 기존 공백이므로 이 결함의 UI 증거로 쓰지 않는다.

## V2 / BUG-002 / 과거 V6: 이름 공백

1. /signup에서 Pilot, 매번 고유한 `pilot-name-실험번호@example.test`, `Ab12!xyzQ`로 합성 계정을 만든다.
2. /account → Display Name을 Ctrl+A → Space 3번으로 교체 → Save Name.
3. OFF: 저장 실패, 새로고침 후 Pilot 유지.
4. ON: Saved, 새로고침 후 Display Name과 계정 이름 빈값.
5. Normal Pilot으로 다시 저장하고 새로고침해 정상 이름 유지 확인. 정확히 빈 문자열은 양쪽 required로 차단된다. 이미 빈 이름인 경우 먼저 정상 이름을 복구한다.

## V3 / BUG-004 / 과거 V7: 도시 빈값

1. 공통 주문 준비 후 City만 Ctrl+A/Backspace로 완전히 비운다. 공백 문자열을 사용하지 않는다.
2. Submit Order Request를 클릭한다.
3. OFF: 필수 입력 안내, /checkout 잔류, 요청 없음/cart 유지.
4. ON: 접수 및 /order/실제번호, 배송 주소에 Seoul 누락, 나머지 주소/우편번호/국가 유지.
5. 양쪽에서 City=Seoul 정상 주문 성공 확인. 이메일은 정상으로 유지한다.

## V4 / BUG-005 / 과거 V9: 재설정 확인 불일치

1. /signup에서 Pilot, 매번 고유한 `pilot-reset-실험번호@example.test`, `Ab12!xyzQ`로 계정 생성.
2. /forgot-password에서 해당 이메일 → Send Reset Link → 화면 Set New Password 링크. 실제 메일 발송은 없다.
3. /reset-password?token=실제값에서 New=`FirstPass!123`, Confirm=`OtherPass!456` → Set Password. 유효/미사용/30분 이내 링크만 사용한다.
4. OFF: 두 비밀번호 불일치 alert, 재설정 POST 없음/현재 화면 유지. 별도 로그인 컨텍스트에서 기존 암호 성공 확인.
5. ON: /account 이동. 로그아웃 후 기존 암호 및 OtherPass!456 로그인 실패, FirstPass!123 로그인 성공 확인.
6. 새 링크를 발급해 New/Confirm 모두 FirstPass!123으로 제출: 양쪽 성공 및 새 암호 로그인 확인. 이미 소비된 링크는 재사용하지 않는다. 토큰·세션 원문을 결과 기록에 남기지 않는다.

## V5 / BUG-003 / 과거 V11: 가입 8자 경계

1. 비로그인 /signup → Pilot, 고유한 `pilot-length-실험번호@example.test`, `Ab12!xyz`(8자) → Create Account.
2. OFF: 성공·자동 로그인·/orders 이동.
3. ON: weak_password/8자 이상 안내, /signup 잔류, 계정 미생성.
4. 새 이메일로 Ab12!xyzQ(9자)는 양쪽 성공. 새 이메일로 Ab12!xy(7자)는 양쪽 차단. 7자는 브라우저 직접 키 입력 경로로 검사한다.
5. 중복 이메일 오류를 길이 오류로 오인하지 않는다. 암호 변경/재설정 최소 길이는 그대로다.

## 격리·데이터 정리와 기록

실행 중인 공용/기존 서버에는 초기화 요청을 보내지 않는다. 테스트 전용 포트에서 새로 시작한 메모리 서버를 사용하고 종료하여 자체 데이터를 폐기한다. DB는 없고 삭제/초기화 명령도 필요 없다. 자동 검사는 새 메모리 서버/임의 포트로 격리하며 /_reset을 호출하지 않는다.

전용 테스트 서버만 시드 복원이 필요할 때 POST /_reset을 사용할 수 있으나 그 서버의 모든 실험 계정/주문/세션/토큰이 바뀐다. 서버 재시작도 메모리를 시드로 시작한다. 브라우저 쿠키/cart/wishlist/Query는 별개이므로 시크릿 컨텍스트를 닫고 새로 열거나 UI에서 cart 삭제 및 새로고침한다. 사용 중인 일반 프로필 데이터는 지우지 않는다.

각 버그 OFF → 단독 ON → OFF 복원, 정상 입력 통제, 입력/URL/응답 상태/사후 데이터/관찰 근거를 기록한다. V1/V3는 native validity와 주문 POST 횟수, V2는 재조회, V4는 사후 로그인, V5는 7/8/9 경계를 확인한다. 활성 ID만으로 재현 성공을 판정하지 않는다. 실행하지 않은 항목은 미검증으로 기록한다.
