import type { Bug } from "./types";

/**
 * UI 버그. ID 접두사는 U 다.
 *
 * 이 파일은 UI 버그 담당자만 건드린다. 다른 분야의 레지스트리를
 * 열지 않으면 브랜치를 합칠 때 충돌이 나지 않는다.
 *
 * 형식은 types.ts 의 Bug 를 따른다. 빠진 항목이 있으면 빌드가 멈춘다.
 *
 * 여기 적힌 다섯 건은 전부 src/styles/bugs-ui.css 한 파일에서 만든다.
 * 컴포넌트를 고치지 않으므로 다른 담당자의 작업과 겹치지 않는다.
 *
 * "보기 싫다"는 버그가 아니다. 읽어야 할 정보가 안 읽히거나,
 * 눌러야 할 것을 못 누르는 것만 넣는다.
 */
export const uiBugs: Bug[] = [
  {
    id: "U1",
    area: "ui",
    symptom: "visual",
    title: "가로 스크롤이 생겨 오른쪽 내용이 잘림",
    description:
      "모든 화면의 본문 영역이 창보다 넓어져 가로 스크롤바가 생긴다. 좁은 창이나 모바일 폭에서는 오른쪽 끝의 가격·버튼이 화면 밖으로 밀려 보이지 않는다.",
    location: "src/styles/bugs-ui.css ([data-bugs~=\"U1\"] .container-full)",
    reproduce:
      "아무 화면이나 열고 창을 1200px 이하로 줄인다. 가로 스크롤바가 생기고 document.scrollWidth 가 window.innerWidth 보다 커진다.",
    // 규칙으로 잡히는 대조군. 전부 안 잡히면 탐지기 자체를 의심해야 하는데,
    // 이 한 건이 그 의심을 걷어준다.
    detectable: true,
    needs: ["horizontal_scroll"],
  },
  {
    id: "U2",
    area: "ui",
    symptom: "visual",
    title: "상품 이름이 줄임표 없이 잘림",
    description:
      "상품 카드의 이름이 한 줄로 고정되고 넘치는 부분이 그냥 사라진다. 줄임표가 없어서 잘렸다는 사실 자체를 알 수 없다. 짧은 이름은 멀쩡하고 긴 이름만 중간에 끊겨, 이름이 긴 상품을 서로 구분할 수 없다.",
    location: "src/styles/bugs-ui.css ([data-bugs~=\"U2\"] article h3)",
    reproduce:
      "/products 를 열고 'Hand-Felted Wool Cushion' 처럼 이름이 긴 카드를 본다. 이름이 중간에 끊기고 '...' 이 없다. 카드의 h3 에서 scrollWidth 가 clientWidth 보다 크다.",
    detectable: false,
    needs: ["ai"],
  },
  {
    id: "U3",
    area: "ui",
    symptom: "visual",
    title: "키보드 포커스 표시가 보이지 않음",
    description:
      "Tab 으로 이동해도 지금 어느 요소에 있는지 화면에 표시되지 않는다. 포커스는 실제로 옮겨가지만 테두리가 그려지지 않아 키보드만으로는 조작할 수 없다.",
    location: "src/styles/bugs-ui.css ([data-bugs~=\"U3\"] :focus-visible)",
    reproduce:
      "아무 화면에서 Tab 을 여러 번 누른다. document.activeElement 는 바뀌는데 화면에는 아무 표시가 없다.",
    // 스크린샷으로는 안 보이고 접근성·DOM 쪽으로 봐야 잡힌다.
    // 탐지 방식에 따라 갈리는지 보려고 넣었다.
    detectable: false,
    needs: ["ai", "accessibility"],
  },
  {
    id: "U4",
    area: "ui",
    symptom: "visual",
    title: "누를 수 없는 버튼이 누를 수 있어 보임",
    description:
      "disabled 상태의 버튼이 흐려지지 않고 손가락 커서까지 떠서 평소 버튼과 구분되지 않는다. 눌러도 아무 일이 없는데 왜 안 되는지 알 수 없다.",
    location: "src/styles/bugs-ui.css ([data-bugs~=\"U4\"] button:disabled)",
    reproduce:
      "/product/arc-pendant-light 의 Quantity 에서 수량이 1 일 때 - 버튼을 본다. 멀쩡한 버튼처럼 보이지만 눌러도 수량이 0 이 되지 않는다.",
    // F3(수량 무반응)과 겉보기 증상이 같다. 원인이 기능인지 표시인지
    // 가려낼 수 있는지 보는 자리다.
    detectable: false,
    needs: ["ai"],
  },
  {
    id: "U5",
    area: "ui",
    symptom: "visual",
    title: "상단 헤더가 본문 첫 부분을 덮음",
    description:
      "헤더가 문서 흐름에서 빠져 본문 위에 떠 있다. 모든 화면에서 제목이나 첫 줄이 헤더 뒤에 가려 보이지 않는다. 가려진 영역의 버튼은 눌러도 헤더가 클릭을 가져간다.",
    location: "src/styles/bugs-ui.css ([data-bugs~=\"U5\"] header)",
    reproduce:
      "/products 를 맨 위로 올린 상태에서 본다. 'Collection' 제목이 헤더에 가려 보이지 않는다. 가려진 자리를 클릭해도 반응하지 않는다.",
    detectable: false,
    needs: ["ai"],
  },
];
