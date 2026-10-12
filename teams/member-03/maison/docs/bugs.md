# 버그 주입 안내

이 사이트는 크롤러와 AI 검사기의 성능을 재는 대상입니다. 결함은 **코드에 박아두지 않고 환경변수로 켜고 끕니다.** 정상 사이트와 버그 사이트가 같은 코드에서 나와야, 두 버전의 차이가 주입한 결함뿐이라고 말할 수 있습니다.

## 분류와 ID

| 접두사 | 분야 | 레지스트리 |
|---|---|---|
| `F` | 기능적 버그 | `server/bugs/functional.ts` |
| `V` | 입력 검증 버그 | `server/bugs/validation.ts` |
| `N` | 이동·라우팅 버그 | `server/bugs/routing.ts` |
| `U` | UI 버그 | `server/bugs/ui.ts` + `src/styles/bugs-ui.css` |

**자기 접두사만 씁니다.** 같은 ID 가 둘이면 서버가 시작할 때 멈춥니다.

**남의 레지스트리 파일은 열지 않습니다.** 이 규칙만 지키면 브랜치를 합칠 때 충돌이 나지 않습니다.

## 브랜치

```
main
└─ develop
   ├─ feature/bugs-functional
   ├─ feature/bugs-validation
   ├─ feature/bugs-routing
   └─ feature/bugs-ui
```

`main` 에 직접 커밋하지 않습니다. `develop` 을 거칩니다.

| 머지 | 언제 |
|---|---|
| `feature/*` → `develop` | 버그 3~4개가 모이면. PR 로 올립니다 |
| `develop` → `main` | 배포·시연·발표 직전에만 |

`main` 은 **언제 열어봐도 동작하는 버전**으로 둡니다. 반쯤 만든 버그는
`develop` 에만 쌓이므로, 멘토가 갑자기 들어와 봐도 시연이 깨지지 않습니다.

`develop` 에 올릴 때마다 `main` 에 합치면 브랜치가 둘인 의미가 없어집니다.

## 버그 한 건 추가하기

### 1. 레지스트리에 적습니다

형식은 `server/bugs/types.ts` 의 `Bug` 입니다. 항목이 빠지면 빌드가 멈춥니다.

```ts
export const functionalBugs: Bug[] = [
  {
    id: "F1",
    area: "functional",
    symptom: "duplicate",
    title: "주문 중복 제출",
    description: "제출 버튼을 빠르게 두 번 누르면 주문이 두 건 생긴다.",
    location: "src/pages/Checkout.tsx",
    reproduce: "장바구니에 담고 /checkout 에서 폼을 채운 뒤 제출을 연타",
    detectable: true,
    needs: ["duplicate_post"],
  },
];
```

`detectable` 과 `needs` 는 **"이렇게 될 것이다"라는 선언**입니다. 벤치마크가 실제 결과와 대조합니다. 틀려도 됩니다. 틀린 게 드러나는 것이 측정의 목적입니다.

### 2. 코드에 토글을 넣습니다

**서버 쪽** — `isOn()` 을 씁니다.

```ts
import { isOn } from "./bugs";

// V2: 비밀번호 길이 검증
if (!isOn("V2") && password.length < 8) {
  json(res, 400, { error: "weak_password", minLength: 8 });
  return true;
}
```

**화면 쪽** — `useBug()` 를 씁니다. 브라우저에는 환경변수가 없어서 서버에 물어본 값을 씁니다.

```tsx
import { useBug } from "@/hooks/useBugs";

const bugF1 = useBug("F1");

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!bugF1 && isSubmitting) return;   // F1: 중복 제출 방어
  ...
};
```

**UI** — CSS 만 씁니다. 컴포넌트를 건드리지 않습니다.

```css
/* src/styles/bugs-ui.css */
[data-bugs~="U1"] .product-card h3 {
  white-space: nowrap;
  overflow: visible;
}
```

켜진 ID 가 `<body data-bugs="U1 U2">` 로 찍힙니다. `~=` 를 쓰세요. `*=` 를 쓰면 `U1` 규칙이 `U12` 에도 걸립니다.

### 3. 양쪽 다 확인합니다

```bash
npm run dev                  # 꺼진 상태 — 정상 동작해야 함
BUG_F1=1 npm run dev         # 켠 상태  — 재현돼야 함
```

**꺼진 상태가 깨지면 기준선이 무너집니다.** 버그를 심는 것보다 이쪽이 중요합니다. 원래 어설픈 기능에 결함을 심으면 "원래 이상한 건지 심은 건지" 구분이 안 되고, 측정 수치가 의미를 잃습니다.

```bash
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
npm test
npm run build
```

### 4. 확인용 주소

```
GET /api/bugs    지금 켜진 ID 목록
GET /gt.json     정답지 — 분야별·증상별 집계 포함
```

정답지는 레지스트리에서 생성됩니다. **손으로 쓰지 않습니다.** 자기 파일에 한 건을 추가하면 자동으로 나타납니다.

## 토글 사용법

실행 명령은 루트 [README.md](../README.md#버그-토글) 에 있습니다.

## 커밋

```
F1: 주문 중복 제출

제출 버튼을 빠르게 두 번 누르면 주문이 두 건 생긴다.
Checkout.tsx 의 isSubmitting 가드를 토글로 감쌌다.
탐지: POST /api/orders 가 2회 → 규칙으로 가능
```

ID 를 앞에 두면 나중에 `git log --oneline | grep F1` 으로 찾습니다.

## 매일 하는 것

```bash
git checkout develop && git pull origin develop
git checkout feature/bugs-functional && git merge develop
```

`develop` 이 앞서간 채로 오래 두면 나중에 합칠 때 어려워집니다.

## 증상 분류

`symptom` 에 쓰는 값입니다. **어디서 생겼나(`area`)와 어떻게 드러나나(`symptom`)는 다른 축**입니다. 주문 버튼이 반응하지 않으면 `area: "functional"`, `symptom: "no_response"` 입니다.

| 값 | 뜻 |
|---|---|
| `no_response` | 눌러도 아무 일이 없다 |
| `partial` | 데이터는 바뀌었는데 화면 일부가 안 따라간다 |
| `false_result` | 결과와 메시지가 어긋난다 (거짓 성공·거짓 실패) |
| `duplicate` | 같은 동작이 여러 번 실행된다 |
| `wrong_target` | 엉뚱한 곳으로 이동한다 |
| `visual` | 보이는 모양이 잘못됐다 |
