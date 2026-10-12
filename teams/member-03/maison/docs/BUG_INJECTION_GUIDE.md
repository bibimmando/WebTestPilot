# 의도적 버그 삽입 가이드

분석일: 2026-10-08. 이 문서는 **향후 구현 제안**이다. 이번 작업에서는 버그를 구현하거나 토글을 추가하지 않았으며 기존 소스도 변경하지 않았다. 구체 후보는 [BUG_CATALOG.md](BUG_CATALOG.md)에 있다.

## 기존 기반과 구현 범위

`server/bugs/index.ts`는 분야별 배열을 allBugs로 합치고 ID 중복을 검사한다. BUGS_ON=all 또는 BUG_ID=1을 서버 모듈 초기화 시 읽는다. `enabledIds`는 화면에 목록을, `groundTruth`는 등록 항목·활성 수·집계를 제공한다. 현재 functional/validation/routing/ui 배열은 모두 비어 있다. 변수만 설정해서 후보를 재현할 수는 없다.

| 변경하려는 기능 | 향후 수정 대상 |
|---|---|
| 상품 목록·검색·정렬·연관 상품 | server/api.ts: matchesQuery, sortProducts, handleApi 상품 분기; hooks/useProducts.ts; pages/Products.tsx |
| 상세 이미지·수량·담기 | pages/ProductDetail.tsx: nextImage/prevImage/handleAddToCart; QuantitySelector.tsx |
| 장바구니 | hooks/useCart.ts: addItem/updateQuantity/removeItem/getSubtotal/getItemCount |
| 위시리스트 | hooks/useWishlist.ts; ProductCard.handleWishlistToggle; Wishlist.handleAddAllToCart |
| 주문 접수·금액·소유권 | Checkout.handleSubmit; server/api.ts 주문 분기; store.createOrder/listOrdersByUser |
| 로그인·계정·비밀번호 | hooks/useAuth.ts; Login/Signup/Account/ResetPassword; api.ts 인증 분기; store.ts |
| 이동·검색 모달·모바일 메뉴 | App.tsx; SearchDialog.submit; Header.tsx; CollectionCard/ProductCard 링크 |
| 안내·FAQ·뉴스레터 | server/pages.ts; InfoPage.Section; Footer.handleSubscribe; /api/subscribe |
| 시각 결함 | server/bugs/ui.ts + src/styles/bugs-ui.css |

표에서 `pages`, `hooks`, 컴포넌트 경로는 `src/` 기준이다. 기능을 바꾸는 실제 코드와 레지스트리 메타데이터를 모두 연결해야 한다. 등록만 하면 정답지에는 나오지만 사이트에는 결함이 생기지 않는다.

## 언어별 결함 설계

| 층 | 가능한 유형 | 관찰 방법 |
|---|---|---|
| HTML / TSX DOM | required/type/label 연결 변경, 잘못된 링크, 이미지 src, 버튼 type | DOM 속성·form.checkValidity·URL·broken image·키보드 조작 |
| CSS | 가로 overflow, 클릭 차단, 요소 숨김, 겹침·대비 | 스크린샷·boundingBox·computed style·hit test·scrollWidth |
| JavaScript / TypeScript 프론트 | no-op, 상태 미동기화, 잘못된 수량/합계, 실패 시 삭제, 중복 POST | UI 전후 비교·localStorage·네트워크 횟수 |
| Node.js TypeScript 백엔드 | 검색/정렬 오류, 검증 누락, 잘못된 금액·권한·상태코드 | API 응답과 화면 기대값 비교·다중 로그인 컨텍스트 |
| Python 백엔드 | **현재 적용 불가** | .py 서버·Python 의존성·실행 경로 없음. 일반 Flask/Django 예시를 실제 후보로 쓰지 않음 |

현재 HTML 진입점은 index.html이고 실제 업무 DOM은 TSX가 만든다. CSS는 `data-bugs` 토글을 활용하며 컴포넌트 변경 없이 주입하는 기존 docs/bugs.md 규약을 따른다. 단, 예시 `.product-card` 클래스는 실제 ProductCard의 클래스가 아니다. 현재 카드 루트는 `article.group`이므로 실재 선택자를 사용한다.

## 향후 구현 절차

1. 기준 소스를 별도 백업하거나 버전 관리한다. 현재 폴더는 Git 저장소가 아니므로 기존 문서의 develop/feature 브랜치가 실제 존재한다고 전제하지 않는다. Git 도입 후에는 기존 docs/bugs.md의 브랜치 규약을 적용할 수 있다.
2. 후보 한 건을 골라 F/V/N/U 레지스트리에 등록한다. Bug 필수 필드는 id, area, symptom, title, description, location, reproduce, detectable, needs다. `detectable`은 예상 선언이지 입증된 탐지율이 아니다.
3. 서버 분기는 `isOn('F1')`, 컴포넌트는 최상위 훅 `useBug('F1')`로 정상/결함 동작을 분기한다. 조건부 return 뒤나 일반 이벤트 함수 안에서 React Hook을 호출하지 않는다. Zustand store 내부에서도 훅을 호출하지 말고 호출 컴포넌트에서 분기하거나 별도 연결 설계를 한다.
4. UI 결함은 `src/styles/bugs-ui.css`에 `[data-bugs~="U1"] ...` 규칙을 둔다. `~=`가 정확한 공백 토큰 매칭이다. 서로 다른 ID까지 매칭하는 `*=`를 쓰지 않는다.
5. OFF의 기준선과 ON의 기대 증상을 각각 확인한다. API_DELAY_MS·브라우저 크기·데이터·계정 조건을 동일하게 고정한다. `/_reset` 후 브라우저도 초기화한다.
6. tsc(앱/서버), 기존 테스트, lint, build를 실행하고 업무 시나리오를 검증한다. build는 별도 타입 검사를 대체하지 못한다.
7. OFF로 복원해 재검증하고 실제 탐지 근거와 ground truth의 일치 여부를 기록한다. ID가 켜진 것과 증상이 발생한 것은 다른 사실이다.

## Windows 비교 실행 예시

아래 명령은 후보의 실제 분기·등록을 **향후 구현한 뒤** 사용하는 예시다. 서버를 시작하기 전 두 터미널 모두 프로젝트 루트로 이동한다. 현재 레지스트리 0건에서는 ON도 정상 코드다.

터미널 A:

```powershell
Remove-Item Env:BUGS_ON -ErrorAction SilentlyContinue
Remove-Item Env:BUG_F1 -ErrorAction SilentlyContinue
$env:API_DELAY_MS = '250'
npm run dev -- --port 8080
```

터미널 B:

```powershell
Remove-Item Env:BUGS_ON -ErrorAction SilentlyContinue
$env:BUG_F1 = '1'
$env:API_DELAY_MS = '250'
npm run dev -- --port 8081
```

두 터미널에 이전 실험의 다른 BUG_ID 변수가 남아 있다면 해당 변수도 제거한다. 시작 후 실제 포트를 확인한다. origin이 포트별로 달라 localStorage는 분리되지만 **쿠키는 포트별로 격리되지 않는다**. 같은 브라우저 컨텍스트로 두 localhost 서버에 로그인하면 세션 쿠키가 서로 덮어써질 수 있으므로 Playwright BrowserContext를 반드시 분리한다.

## Playwright 에이전트 관찰 설계(제안)

프로젝트에 Playwright 실행기는 없다. 아래는 에이전트/별도 하네스 설계 지침이며 실행 완료된 테스트가 아니다.

- 평가 제어기만 `/gt.json`, `/api/bugs`, `/_reset`을 호출한다. 에이전트는 이 엔드포인트와 `body[data-bugs]`를 정답으로 활용하지 않도록 한다. 정답의 공개 여부를 실험 조건에 명시한다.
- 새 BrowserContext를 만든 뒤 서버 reset과 테스트 계정 생성/로그인을 수행한다. 정상/결함 컨텍스트와 증거 디렉터리를 분리한다.
- `page.on('console')`, `page.on('pageerror')`, requestfailed, response 상태, 주문 POST 횟수를 수집한다. requestfailed는 4xx/5xx와 다른 신호다.
- role/status/alert, URL, 보이는 상품명·순서·가격, cart 총수량과 합계, 버튼 disabled를 비교한다. 애니메이션과 로딩 완료를 기다린다. bugs 응답 및 body 속성 적용 전에 조작하면 ON인데 정상 동작을 관찰할 수 있다.
- CSS는 같은 viewport에서 screenshot·scrollWidth·computed style·elementFromPoint로 확인한다. 클릭 차단은 Playwright click timeout뿐 아니라 중앙 좌표에 어떤 요소가 있는지 함께 기록한다.
- broken image는 응답 실패 외에 `img.complete && img.naturalWidth === 0`을 확인한다. 외부 이미지/폰트의 기준선 장애를 주입 결함으로 잘못 집계하지 않는다.
- 순서/금액/권한 결함은 HTTP 200에서도 생긴다. “오류 로그 없음”만으로 정상으로 판단하지 않고 기대값을 명시한다.
- 회원가입 길이처럼 브라우저 검증과 서버 검증이 중첩된 경우 두 층을 구분한다. 서버 분기만 바꾸면 짧은 비밀번호를 일반 UI로 제출할 수 없으므로 API 경로를 별도 검사하거나 해당 후보에서 두 층 모두 토글한다.

## 복원

**상태 복원:** `POST /_reset` → 새 BrowserContext 또는 사이트 데이터 삭제 → 새로고침. 계정·암호·주문·세션을 실험 전 상태로 되돌린다.

**토글 복원:** Ctrl+C → BUGS_ON과 사용한 BUG_ID 환경변수 제거 → 재시작 → `/api/bugs`가 빈 목록인지 확인 → 화면 새로고침. 현재 구현은 reset만으로 토글을 변경하지 못한다.

**코드 복원:** 후보 관련 분기·레지스트리·CSS만 백업본/해당 변경 이력으로 되돌린다. 다른 작업을 함께 덮어쓰는 전체 reset/checkout은 피한다. UI 배포본을 사용했다면 재빌드한다. 토글을 끄는 것은 실행 동작 복원이며 소스 수정 자체를 제거하는 것은 아니다.

본 문서 후보와 [ARCHITECTURE.md](ARCHITECTURE.md)의 기존 기준선 공백을 혼합해 신규 주입 버그 수로 집계하지 않는다.
