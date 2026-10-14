# 기능·이벤트 검증

검색 ID: F01–F05, F07–F15. [원문 인덱스](source-index.md)의 해당 항목을 선택한다.

기대 효과(예: 장바구니 수량 변화)는 제품 요구로 정한다. 클릭 이벤트가 발생했다는 사실만으로 그 효과를 보장하지 않는다. DOM의 inline onclick 부재만으로 리스너 누락을 확정할 수 없다. 위임 리스너, 프레임워크, shadow DOM을 고려한다.

검증 가설 후보:

- F05/F07/F08/F15: 취소와 전파를 구분한다. [preventDefault](https://developer.mozilla.org/ko/docs/Web/API/Event/preventDefault)는 취소 가능한 기본 동작, [stopPropagation](https://developer.mozilla.org/ko/docs/Web/API/Event/stopPropagation)은 전파에 관한 API다. target 기반 위임에서 자식 클릭 경로를 비교한다.
- F01/F11: 가림/disabled/이동 중 요소로 click이 실패했는지 확인한다. [Playwright actionability](https://playwright.dev/docs/actionability)는 자동화 전제이며 제품 명세가 아니다. force click 성공을 정상 사용자 조작 성공으로 보고하지 않는다.
- F02/F03/F12/F13: mouse/touch/keyboard 입력 경로를 구분한다. pointer capture가 이벤트 대상을 바꾸는지 검토한다. 키보드 지원 요구는 네이티브 의미/접근성 요구와 연결한다.
- F04/F09/F14: 사용자 활성화, 이벤트 루프, 합성 이벤트를 구분한다. 비동기 UI는 명시적 완료 상태까지 기다린다. CustomEvent dispatch 결과는 실제 사용자 동작의 동등 재현으로 간주하지 않는다.

수집할 최소 증거는 조작 대상의 유일성·상태, 실행 결과, 제품 효과의 전후 상태다. 실패하면 동일 locator가 올바른 요소인지, hydration/초기화 전 조작인지, 네트워크 장애인지 반증 실험을 선택한다. 반복 횟수는 판단 조건이 아니다.
