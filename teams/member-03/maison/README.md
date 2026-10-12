# Maison

WebTestPilot 캡스톤 프로젝트의 **테스트 대상 사이트**입니다. 조명·도자기·가구·텍스타일을 다루는 홈 인테리어 편집숍 형태의 쇼핑몰이며, 크롤러와 AI 검사기의 성능을 재기 위해 만들었습니다.

기본 레이아웃은 [Lovable](https://lovable.dev) 로 생성한 뒤, 측정에 필요한 구조를 직접 붙였습니다.

## 왜 이렇게 만들었나

벤치마크 대상이 되려면 **정상 동작이 깨끗해야** 합니다. 원래 어딘가 어설픈 기능에 결함을 심으면 "원래 이상한 건지 심은 건지" 구분이 안 되고, 측정 수치가 의미를 잃습니다. 그래서 결함을 넣기 전에 다음을 먼저 맞췄습니다.

- 상품 데이터를 서버로 옮기고 **AJAX 로 전환** — 로딩·실패 상태가 화면에 드러나야 그 위에 결함을 심을 수 있습니다
- `fetch` 가 4xx·5xx 에서 조용히 통과하지 않도록 **응답 상태를 한 곳에서 검사**
- 중복 제출 방어, 성공 응답 확인 후 상태 변경 등 **방어 코드를 제자리에 배치**
- 로딩·실패·빈 결과를 `role=status` / `role=alert` 로 **접근성 트리에 남김**

지금 저장소에는 **결함이 하나도 들어 있지 않습니다.** 이 상태가 측정의 기준선입니다.

## 실행

```sh
npm install
npm run dev          # http://localhost:8080
```

화면과 API 가 같은 포트에서 돕니다. 별도 서버를 띄울 필요가 없습니다.

```sh
npm run build        # 프로덕션 빌드 → dist/
npm run preview      # 빌드 결과 확인 → http://localhost:4173 (API 도 같이 돈다)
npm test             # vitest
```

`preview` 는 `dev` 와 포트가 다릅니다(4173). 빌드된 결과물로 도는 것이라
코드를 고쳐도 반영되지 않습니다. 다시 `build` 해야 합니다.

### 데모 계정

```
demo@maison.com / demo1234     주문 2건이 미리 들어 있음
test@maison.com / test1234     주문 없음 — 계정별 분리 확인용
```

공개 데모 사이트의 고정 계정입니다. 크롤러의 로그인 패스가 이 값을 씁니다.

### 상태 초기화

```sh
curl -X POST http://localhost:8080/_reset
```

계정·주문을 시드 상태로 되돌립니다. 계정과 주문은 **메모리에만** 있습니다. 영속 저장을 쓰면 실행을 반복할수록 주문이 쌓여 `/orders` 화면이 매번 달라지고, 같은 상태가 새 상태로 잡혀 재현성이 깨지기 때문입니다.

### 버그 토글

결함은 코드에 박아두지 않고 환경변수로 켜고 끕니다. 정상 사이트와 버그
사이트가 같은 코드에서 나와야, 두 버전의 차이가 주입한 결함뿐이라고 말할
수 있습니다.

```sh
npm run dev                     # 정상 사이트 (기본값)
BUGS_ON=all npm run dev         # 버그 전부 켬
BUG_F1=1 BUG_U2=1 npm run dev   # 지정한 것만
```

두 벌을 동시에 띄워 비교할 수 있습니다.

```sh
npm run dev -- --port 8080                 # 정상
BUGS_ON=all npm run dev -- --port 8081     # 버그
```

```
GET /api/bugs    지금 켜진 ID 목록
GET /gt.json     정답지. 레지스트리에서 생성되므로 코드와 어긋나지 않음
```

기본값이 "꺼짐"인 이유는 환경변수를 깜빡해도 멀쩡한 사이트가 뜨게 하기
위해서입니다. 버그를 추가하는 방법은 [docs/bugs.md](docs/bugs.md)
를 보세요.

### API 응답 지연

```sh
API_DELAY_MS=600 npm run dev    # 기본 250ms
```

로컬 API 는 1ms 안에 응답해서 스켈레톤이 화면에 뜨지 않습니다. 로딩 상태를 관찰할 수 있게 최소 지연을 둡니다. 결함이 아니라 현실성 보정입니다.

## 구조

```
server/
  data.ts              상품·컬렉션 원본. 클라이언트 번들에 들어가지 않음
  store.ts             계정·세션·주문. 데이터 접근을 전부 여기 함수로 모음
  pages.ts             안내 페이지 본문 (배송·관리·FAQ·약관)
  api.ts               요청 핸들러. 프레임워크 없이 Node 기본 API
  vite-plugin-api.ts   Vite 개발·프리뷰 서버에 /api 를 붙임

src/
  lib/api.ts           fetch 래퍼. 4xx·5xx 를 ApiError 로 던짐
  hooks/               useProducts · useAuth · useOrder · useInfoPage …
  components/          Header · Footer · AccountMenu · SearchDialog · ErrorState …
  pages/               17개 라우트
```

`server/store.ts` 가 데이터 접근의 단일 출입구라, 나중에 파일이나 SQLite 로 바꿔도 바깥 코드는 바뀌지 않습니다.

## 화면

| 경로 | 내용 |
|---|---|
| `/` | 홈 |
| `/products` | 상품 목록. 컬렉션 필터 · 정렬 · 검색(`?q=`) |
| `/product/:slug` | 상품 상세 · 연관 상품 |
| `/cart` `/checkout` | 장바구니 · 주문 요청 |
| `/order/:orderId` | 주문 완료 |
| `/orders` | 주문 내역 (로그인 필요) |
| `/wishlist` | 위시리스트 |
| `/login` `/signup` | 로그인 · 회원가입 |
| `/forgot-password` `/reset-password` | 비밀번호 재설정 (토큰 1회용, 30분) |
| `/account` | 계정 설정 |
| `/info` `/info/:slug` | 고객센터 · 안내 6종 |
| `/about` | 브랜드 소개 |

## API

```
GET    /api/products              ?collection= &sort= &q= &limit= &featured= &new=
GET    /api/products/:slug
GET    /api/products/:slug/related
GET    /api/collections

POST   /api/auth/signup | login | logout
GET    /api/auth/me               비로그인도 200 + user:null
PATCH  /api/auth/me               이름 변경
POST   /api/auth/password         현재 비밀번호 확인 후 변경
POST   /api/auth/forgot | reset
GET    /api/auth/reset?token=     링크 유효성 확인

GET    /api/orders                내 주문만 (로그인 필요)
POST   /api/orders                로그인 시 계정 연결, 아니면 게스트 주문
GET    /api/orders/:id

GET    /api/pages | /api/pages/:slug
POST   /api/subscribe

GET    /api/bugs                  켜진 버그 ID 목록
GET    /gt.json                   정답지
GET    /api/health
POST   /_reset
```

`GET /api/auth/me` 가 비로그인일 때 401 이 아니라 `200 + user: null` 인 이유: 모든 화면이 이 조회를 하므로 401 을 쓰면 브라우저가 페이지마다 콘솔 오류를 찍고, 크롤러의 `console_error` 검사가 전 페이지에서 오탐합니다. 실제로 19개 상태 전부에서 1건씩 발생했습니다. 보호가 필요한 `/api/orders` 는 401 을 그대로 씁니다.

## 측정에 쓰이는 성질

| 성질 | 현재 |
|---|---|
| 폼 제출 경로 | 9개 (아래) |
| AJAX 엔드포인트 | 23개 |
| URL 이 안 바뀌는 상태 변화 | 검색 모달 · 계정 드롭다운 · FAQ 아코디언 |
| 인증 축 | 로그인 / 비로그인 두 패스 |
| 근사 중복 | `/info/*` 6개 — 레이아웃 동일, 내용만 다름 |
| 폼 제출 없이는 못 가는 영역 | `/order/:id` |

### 폼 제출 경로

크롤러가 폼을 채워야 도달하는 지점들입니다. AJAX 전환 전에는 `/checkout`
하나뿐이었습니다.

| 위치 | 폼 | 제출 대상 |
|---|---|---|
| `/checkout` | 주문 요청 (8필드) | `POST /api/orders` |
| `/login` | 로그인 | `POST /api/auth/login` |
| `/signup` | 회원가입 | `POST /api/auth/signup` |
| `/forgot-password` | 재설정 요청 | `POST /api/auth/forgot` |
| `/reset-password` | 새 비밀번호 | `POST /api/auth/reset` |
| `/account` | 이름 변경 | `PATCH /api/auth/me` |
| `/account` | 비밀번호 변경 | `POST /api/auth/password` |
| 헤더 검색 모달 (전 화면) | 검색어 | `/products?q=` 로 이동 |
| 푸터 (전 화면) | 뉴스레터 | `POST /api/subscribe` |

마지막 둘은 모든 화면에 있어서, 어느 상태에서든 입력칸이 잡힙니다.

## 결함 현황

현재 **0건**입니다. 이 상태가 측정의 기준선입니다. 레지스트리는
`server/bugs/` 에 분야별로 나뉘어 있고 전부 비어 있습니다.

| 접두사 | 분야 | 파일 |
|---|---|---|
| `F` | 기능적 | `server/bugs/functional.ts` |
| `V` | 입력 검증 | `server/bugs/validation.ts` |
| `N` | 이동·라우팅 | `server/bugs/routing.ts` |
| `U` | UI | `server/bugs/ui.ts` + `src/styles/bugs-ui.css` |

## 아직 없는 것

문의 폼(현재 `mailto:`), 쿠폰, 상품 리뷰, 재고·품절, 주문 취소, 페이지네이션. 안내 페이지 본문은 **없는 기능을 설명하지 않도록** 작성했습니다.
