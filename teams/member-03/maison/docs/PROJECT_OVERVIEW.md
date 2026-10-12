# Maison 프로젝트 개요

분석일: 2026-10-08. 현재 폴더의 소스와 설정을 기준으로 작성했다. **확인**은 정적 코드에서 확인한 사실, **제안**은 향후 작업, **미확인**은 실행으로 검증하지 못한 사항이다. 기존 소스와 `docs/bugs.md`는 변경하지 않았다.

## 목적과 분석 범위

Maison은 홈 인테리어 편집숍 형태의 SW 테스트 에이전트 평가용 웹 애플리케이션이다. 상품 탐색, 검색, 장바구니, 계정, 주문 요청, 고객센터를 제공한다. 실제 결제나 배송을 수행하는 서비스는 아니다. Python 백엔드는 없으며 React와 Node.js/TypeScript로 구현되어 있다.

루트와 하위 소스, 설정, 의존성 선언, npm 잠금 파일의 런타임 조건, 기존 문서를 조사했다. 이미지 바이너리와 `bun.lockb` 내부는 코드 분석 대상에서 제외했다. 자동 생성 디렉터리는 분석하지 않았다. 현재 `node_modules`, `.git` 디렉터리가 없고 npm 명령을 찾지 못해 설치·빌드·서버·브라우저 테스트는 수행하지 못했다. 따라서 README의 “결함 없음”은 개발 의도이며 정상 동작을 실증한 결론은 아니다.

## 디렉터리 구조

```text
Maison-main/
├─ index.html                  HTML 진입점
├─ package.json                의존성 및 npm scripts
├─ package-lock.json           npm 해석 버전·무결성·engines
├─ bun.lockb                   별도 Bun 잠금 파일
├─ vite.config.ts              Vite와 API 플러그인 설정
├─ vitest.config.ts            jsdom 테스트 설정
├─ tsconfig{,.app,.node}.json   공통/브라우저/서버 타입 검사
├─ tailwind.config.ts          디자인 토큰·반응형·애니메이션
├─ postcss.config.js            Tailwind와 Autoprefixer
├─ eslint.config.js             정적 검사
├─ components.json             shadcn 컴포넌트 생성 설정
├─ .gitignore                  생성물·로컬 설정 제외
├─ .lovable/plan.md             과거 디자인/기능 계획
├─ public/                     favicon, 아이콘, placeholder.svg, robots.txt
├─ server/
│  ├─ vite-plugin-api.ts        dev/preview 미들웨어 연결
│  ├─ api.ts                    HTTP 라우팅·검증·응답
│  ├─ store.ts                  계정·세션·주문·재설정 토큰
│  ├─ data.ts                   상품 13개, 컬렉션 8개
│  ├─ pages.ts                  고객센터 본문 6종
│  └─ bugs/                    토글·정답지·버그 레지스트리
│     ├─ index.ts               allBugs, isOn, enabledIds, groundTruth
│     ├─ types.ts               Bug, BugArea, BugSymptom
│     ├─ functional.ts          F: 기능
│     ├─ validation.ts          V: 입력 검증
│     ├─ routing.ts             N: 이동
│     └─ ui.ts                  U: 화면
├─ src/
│  ├─ main.tsx                 React 마운트
│  ├─ App.tsx                  Provider·라우트·버그 body 속성
│  ├─ index.css                기본 스타일·외부 폰트
│  ├─ vite-env.d.ts            Vite 타입 선언
│  ├─ pages/                   화면 컴포넌트 17개(404 포함)
│  ├─ components/              사이트 공통 구성요소
│  │  └─ ui/                   범용 UI 컴포넌트 라이브러리
│  ├─ hooks/                   데이터 조회·mutation·브라우저 상태
│  ├─ data/products.ts         Product/Collection 타입·컬렉션 메타데이터
│  ├─ lib/api.ts               fetch 및 ApiError
│  ├─ lib/utils.ts             cn: clsx + tailwind-merge
│  ├─ styles/bugs-ui.css       토글 기반 UI 결함용 자리(현재 주석뿐)
│  └─ test/                    setup.ts, example.test.ts
└─ docs/                       기존 bugs.md와 이번 기술 문서 5개
```

## 기술 스택

| 영역 | 확인된 기술 / 역할 |
|---|---|
| 프론트엔드 | React `^18.3.1`, TypeScript `^5.8.3`, React Router `^6.30.1` SPA |
| 서버 상태 | TanStack React Query `^5.83.0`: 상품·계정·주문·안내 데이터 |
| 브라우저 상태 | Zustand `^5.0.11` + persist/localStorage: 장바구니·위시리스트 |
| UI | Tailwind `^3.4.17`, shadcn 스타일 컴포넌트, Radix UI, Lucide, Framer Motion |
| 백엔드 | Node 내장 `http` 타입·`crypto`, Vite Connect 미들웨어, TypeScript |
| 빌드 | Vite `^5.4.19`, React SWC, PostCSS, 개발 모드 lovable-tagger |
| 검사 | ESLint 9, Vitest 3, jsdom, Testing Library |
| 저장소 | 서버 메모리 배열·Map. DB, ORM, 마이그레이션 없음 |

위 버전은 package.json 선언 범위다. 잠금 파일의 주요 확정 버전과 Node 조건은 [SERVER_SETUP.md](SERVER_SETUP.md)에 정리했다. React Hook Form, Zod, Recharts 등의 패키지가 선언되어 있지만, 선언만으로 현재 페이지의 모든 폼이 그 기술을 사용한다고 판단하면 안 된다. 주요 업무 폼은 useState와 HTML 검증·서버 검증을 사용한다.

## 화면별 기능

아래 파일은 모두 `src/pages/` 아래에 있다. 실제 라우트 정의는 `src/App.tsx`다.

| URL | 파일 / 주요 상호작용 | 데이터 |
|---|---|---|
| `/` | Index.tsx: 히어로, 컬렉션, 상품 카드, 소개 이동 | useProducts({limit:4}); 기본 정렬은 featured |
| `/products` | Products.tsx: 컬렉션·검색·5종 정렬, 검색 해제, 빈 결과·재시도 | q/collection/sort URL → useProducts |
| `/product/:slug` | ProductDetail.tsx: 이미지 순환·썸네일, 수량 1~10, Add to Bag, 하트, 연관 상품 | useProduct/useRelatedProducts, 로컬 상태 |
| `/about` | About.tsx: 브랜드 소개·이미지·쇼핑 링크 | 정적 JSX |
| `/cart` | Cart.tsx: 수량 변경·삭제·합계·Checkout | useCart; API 없음 |
| `/wishlist` | Wishlist.tsx: 저장 상품, 전체 장바구니 추가, 전체 삭제 | useWishlist/useCart; 전체 추가 후 위시리스트는 유지 |
| `/checkout` | Checkout.tsx: 연락처·배송지·메모, 주문 요청, 중복 제출 방어 | POST /api/orders; 성공 후 cart 비우기·주문 화면 이동 |
| `/order/:orderId` | OrderComplete.tsx: 주문 금액·상품·고객 정보, 오류/없는 주문 | useOrder |
| `/orders` | Orders.tsx: 로그인 안내, 내 주문 목록·빈 목록, 상세 이동 | useMe/useOrders(isLoggedIn) |
| `/login` | Login.tsx: 로그인, 오류, 원래 화면 복귀(기본 /orders) | useLogin |
| `/signup` | Signup.tsx: 이름·이메일·8자 이상 비밀번호, 자동 로그인 | useSignup → /orders |
| `/forgot-password` | ForgotPassword.tsx: 이메일 제출·데모 재설정 링크 표시 | useForgotPassword; 메일 발송 없음 |
| `/reset-password` | ResetPassword.tsx: 토큰 사전 검사, 비밀번호 확인 일치, 변경 | useResetToken/useResetPassword → /account |
| `/account` | Account.tsx: 로그인 안내, 이름 저장, 현재 비밀번호 확인 후 변경 | useUpdateName/useChangePassword |
| `/info` | InfoIndex.tsx: eyebrow별 안내 목록 그룹·상세 링크 | useInfoPages, groupByEyebrow |
| `/info/:slug` | InfoPage.tsx: Section의 본문·표·불릿·FAQ 아코디언 | useInfoPage |
| `*` | NotFound.tsx: 404 화면·홈/상품 이동 | 클라이언트 fallback; HTTP 404 보장 아님 |

안내 slug: `shipping-returns`, `care-guide`, `faq`, `privacy`, `terms`, `cookies` (`server/pages.ts`).

## 공통 구성요소 및 수정 지점

| 파일 또는 묶음 | 역할 |
|---|---|
| components/Layout.tsx | Header → motion.main → Footer 공통 레이아웃 |
| Header.tsx | 컬렉션 메뉴, 모바일 메뉴, 스크롤 스타일, 검색·계정·하트·장바구니 |
| SearchDialog.tsx | submit/handleSubmit: 검색 모달, URL 인코딩 후 상품 목록 이동 |
| AccountMenu.tsx | 로그인별 메뉴, handleLogout, 성공 후 홈 이동 |
| CartIcon.tsx | 총수량 배지, 10 이상 `9+`, /cart 링크 |
| ProductCard.tsx | 상세 링크·이미지 hover·가격·배지, handleWishlistToggle의 링크 이동 차단 |
| CollectionCard.tsx | 컬렉션 이미지·설명·필터 링크 |
| QuantitySelector.tsx | decrease/increase 및 최소·최대 버튼 비활성화 |
| Footer.tsx | 고정 안내 링크·컬렉션 링크·handleSubscribe; 성공/실패 메시지 |
| ErrorState.tsx | 오류별 설명·role=alert·onRetry |
| ProductGridSkeleton.tsx | 상품 로딩·role=status·aria-busy |
| ScrollToTop.tsx / NavLink.tsx | pathname 변경 시 스크롤 복원 / Router NavLink 스타일 래퍼 |
| hooks/useTitle.ts | document.title을 화면별로 갱신 |
| hooks/use-toast.ts | 토스트 상태·reducer·dispatch; ui/use-toast.ts는 재노출 |
| hooks/use-mobile.tsx | 768px 기준 matchMedia 반응형 보조 |

`components/ui/`는 button/input/textarea/label/form, dialog/sheet/drawer/alert-dialog, dropdown-menu/navigation-menu/context-menu/menubar, select/checkbox/radio-group/switch/slider/toggle, accordion/tabs, toast/toaster/sonner/tooltip, card/table/badge/avatar/skeleton, carousel/chart/calendar/pagination/sidebar 등 범용 UI를 제공한다. 모든 UI 파일이 현재 화면에서 사용되는 것은 아니다. 업무 동작은 pages/hooks에서 추적하고 UI 파일 존재를 제품 기능 구현의 근거로 삼지 않는다.

## 현재 한계와 문서 간 불일치

- 등록된 버그는 0개지만 기존 검증 공백은 있다. [ARCHITECTURE.md](ARCHITECTURE.md)의 기준선 관찰 항목을 먼저 확인한다.
- 홈의 “Latest” 영역은 `limit:4`만 요청하므로 실제 결과는 featured 우선이다.
- `.lovable/plan.md`는 과거 계획이다. 위시리스트 제거, 모든 카드가 동일 상세로 이동 등의 내용은 현재 구현과 다르다.
- README/주석의 컬렉션 “5개”와 달리 실제 데이터는 8개다. Footer는 첫 6개를 표시한다.
- `useInfoPages`와 서버 주석은 푸터 사용을 언급하지만 현재 Footer의 안내 링크는 정적이다. 해당 조회는 InfoIndex에서 사용한다.
- `server/pages.ts` 상단의 “비밀번호 재설정 미구현” 주석과 달리 관련 API·페이지가 구현되어 있다.
- 실제 결제, 메일 전송, 재고, 쿠폰, 리뷰, 주문 취소, 송장 추적, 서버 페이지네이션은 확인되지 않는다.

운영: [SERVER_SETUP.md](SERVER_SETUP.md) · 요청/데이터 흐름: [ARCHITECTURE.md](ARCHITECTURE.md) · 실험 절차: [BUG_INJECTION_GUIDE.md](BUG_INJECTION_GUIDE.md) · 후보: [BUG_CATALOG.md](BUG_CATALOG.md).
