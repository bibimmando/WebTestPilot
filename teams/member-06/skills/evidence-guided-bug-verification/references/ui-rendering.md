# UI·렌더링·가시성

검색 ID: U01–U10, U12–U15. [원문 인덱스](source-index.md)를 선택적으로 참조한다.

DOM 존재, 박스 생성, viewport 교차, 포인터 수신, 지각 가능성, 접근성 노출은 서로 다른 관찰이다. [Playwright visible](https://playwright.dev/docs/actionability#visible)에는 opacity 0 요소도 포함될 수 있다. visible=true 하나로 사람이 볼 수 있다고 결론 내리지 않는다.

U03–U08: bounding box, display/visibility/opacity/overflow/z-index/contain과 화면 증거를 함께 본다. CSS 박스 트리가 DOM과 다를 수 있고 margin 음수는 허용되므로 단지 겹친다는 이유만으로 CSS 표준 위반은 아니다. [getComputedStyle](https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle)은 resolved value이며 애니메이션 시점과 스타일 변경에 따라 달라질 수 있다. `hidden=until-found`는 영구 비표시와 구분한다.

U01/U02: WebDriver 텍스트·displayedness와 Playwright의 API를 동일한 규범으로 취급하지 않는다. U02 원래 fragment 대신 현 문서의 Element displayedness 부록을 확인해야 한다.

U09/U15: 오류 안내 및 대비 문제는 적용 조건을 명시한다. [WCAG 2.2 SC 1.4.3](https://www.w3.org/TR/WCAG22/#contrast-minimum)은 일반 텍스트 4.5:1, 큰 텍스트 3:1 및 예외를 포함한다. 실제 글자 크기·굵기, 배경 합성, 비활성/장식/로고 예외를 확인한다. 단순 CSS foreground/background 두 값으로 사진·투명도·그라데이션 대비를 확정하지 않는다. runner는 대비 계산기를 구현하지 않는다.

U10 CSS Layout API는 초안이며 일반 웹사이트에 구현을 요구할 근거가 아니다. U12는 재시도 단언 가이드이며 screenshot 회귀 전용 문서가 아니다. U13 교차 상태는 가림이나 판독 가능성을 단독으로 증명하지 않는다. U14 containment의 격리/잘림을 제품 기대와 연결한다.

화면 비교 시 viewport, DPR, 브라우저 버전, 폰트, 로딩 상태를 맞추고 차이가 기능/읽기/조작에 미치는 영향을 설명한다. 기준 이미지와 실제 요구 없이 픽셀 차이를 결함으로 확정하지 않는다.
