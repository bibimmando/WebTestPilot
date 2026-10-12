import type { Bug } from "./types";

/**
 * 기능적 버그. ID 접두사는 F 다.
 *
 * 이 파일은 기능적 버그 담당자만 건드린다. 다른 분야의 레지스트리를
 * 열지 않으면 브랜치를 합칠 때 충돌이 나지 않는다.
 *
 * 형식은 types.ts 의 Bug 를 따른다. 빠진 항목이 있으면 빌드가 멈춘다.
 */
export const functionalBugs: Bug[] = [
  {
    id: "F1",
    area: "functional",
    symptom: "partial",
    title: "위시리스트 목록에서 마지막 항목이 빠짐",
    description:
      "하트는 채워지고 헤더 배지 수도 늘어나는데, 위시리스트 화면의 " +
      "카드 목록에서만 가장 최근에 담은 항목이 보이지 않는다. " +
      "'1 piece saved' 라고 쓰여 있는데 카드가 0개인 상태가 된다.",
    location: "src/pages/Wishlist.tsx",
    reproduce:
      "상품 목록이나 상세에서 하트를 눌러 담은 뒤 /wishlist 로 간다. " +
      "상단 카운트와 실제 카드 수를 비교한다.",
    detectable: false,
    needs: ["ai"],
  },
  {
    id: "F2",
    area: "functional",
    symptom: "false_result",
    title: "장바구니 담기 거짓 성공",
    description:
      "'Added to bag' 토스트가 뜨지만 실제로는 담기지 않는다. " +
      "헤더의 장바구니 배지가 늘지 않고 /cart 도 비어 있다. " +
      "오류도 없고 화면도 바뀌어 정상과 구분되지 않는다.",
    location: "src/pages/ProductDetail.tsx",
    reproduce:
      "/product/arc-pendant-light 에서 Add to Bag 을 누른다. " +
      "성공 토스트가 뜨는데 헤더 장바구니 배지는 그대로다.",
    detectable: false,
    needs: ["ai"],
  },
  {
    id: "F3",
    area: "functional",
    symptom: "no_response",
    title: "수량 조절 버튼 무반응",
    description:
      "상품 상세와 장바구니의 + / - 버튼을 눌러도 수량이 바뀌지 않는다. " +
      "버튼은 눌리는데 숫자가 그대로다.",
    location: "src/components/QuantitySelector.tsx",
    reproduce: "/product/arc-pendant-light 의 Quantity 에서 + 를 누른다.",
    detectable: false,
    needs: ["ai", "no_state_change"],
  },
  {
    id: "F4",
    area: "functional",
    symptom: "no_response",
    title: "컬렉션 필터 해제 무반응",
    description:
      "컬렉션을 고른 상태에서 ALL 을 눌러도 필터가 풀리지 않는다. " +
      "전체 목록으로 돌아갈 방법이 없어진다. " +
      "이미 ALL 인 상태에서 ALL 을 누르는 정상 동작과 겉보기가 같다.",
    location: "src/pages/Products.tsx",
    reproduce:
      "/products?collection=lighting 에서 ALL 을 누른다. " +
      "상품이 2개에서 13개로 늘어나야 하는데 그대로다.",
    detectable: false,
    needs: ["ai", "no_state_change"],
  },
];
