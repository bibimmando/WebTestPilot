# 출처 인덱스

확인일: 2026-10-15 (Asia/Seoul). 본문 접근을 확인한 55개 출처만 포함한다. 페이지 추출 성공이 모든 조항의 완독 또는 브라우저 적합성 검증을 뜻하지는 않는다. 절 링크의 정확성 및 문서 성숙도는 사용 시 확인한다.

specification은 적용 대상과 규범 절을 확인한다. MDN은 기술 레퍼런스, 도구 가이드는 도구 동작의 일차 자료, WAI/OWASP는 지침이다. javascript.info는 보조 해설이며 규범 주장 근거로 사용하지 않는다.

보완 자료: [HTML activation behavior](https://html.spec.whatwg.org/multipage/interaction.html#activation-behavior), [Playwright Python Page](https://playwright.dev/python/docs/api/class-page).

## F01 — 상호작용·가림

- 원문: [Element Click](https://www.w3.org/TR/webdriver2/#element-click)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/webdriver2/
- 확인 내용/한계: 스크롤과 포인터 상호작용 가능성을 확인한다.
- 재현·증거 도구: locator.click; bounding_box
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## F02 — 마우스 이벤트

- 원문: [Mouse Events](https://www.w3.org/TR/uievents/#events-mouseevents)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/uievents/
- 확인 내용/한계: 이벤트 종류와 입력 장치에 따른 순서를 구분한다.
- 재현·증거 도구: mouse.down/up; locator.click
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## F03 — 포인터 캡처

- 원문: [Pointer capture](https://www.w3.org/TR/pointerevents/)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/pointerevents/
- 확인 내용/한계: 캡처 중에는 실제 좌표와 이벤트 대상이 다를 수 있다.
- 재현·증거 도구: page.mouse; pointer event 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## F04 — 활성화

- 원문: [activation behavior (보완 URL)](https://html.spec.whatwg.org/multipage/webappapis.html#activation)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://html.spec.whatwg.org/multipage/webappapis.html
- 확인 내용/한계: 원래 #activation은 의도한 요소 활성화 절을 특정하지 못한다. interaction 문서의 activation behavior를 추가 확인했다.
- 재현·증거 도구: locator.click; locator.press
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## F05 — 리스너 옵션

- 원문: [options](https://developer.mozilla.org/ko/docs/Web/API/EventTarget/addEventListener)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/ko/docs/Web/API/EventTarget/addEventListener
- 확인 내용/한계: capture/once/passive 옵션이 실행과 취소 동작에 영향을 준다.
- 재현·증거 도구: click/press 비교; DOM 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## F07 — 기본 동작 취소

- 원문: [preventDefault](https://developer.mozilla.org/ko/docs/Web/API/Event/preventDefault)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/ko/docs/Web/API/Event/preventDefault
- 확인 내용/한계: 취소 불가능한 이벤트에는 preventDefault가 효과가 없다.
- 재현·증거 도구: click; 이벤트 cancelable 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## F08 — 전파 중단

- 원문: [stopPropagation](https://developer.mozilla.org/ko/docs/Web/API/Event/stopPropagation)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/ko/docs/Web/API/Event/stopPropagation
- 확인 내용/한계: stopPropagation은 기본 동작이나 같은 대상의 다른 리스너를 모두 취소하지 않는다.
- 재현·증거 도구: 중첩 요소 click
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## F09 — 이벤트 루프

- 원문: [Event loops](https://html.spec.whatwg.org/multipage/webappapis.html#event-loops)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://html.spec.whatwg.org/multipage/webappapis.html
- 확인 내용/한계: 작업과 마이크로태스크 및 렌더링 기회를 구분한다.
- 재현·증거 도구: expect(locator); 조건 기반 대기
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## F10 — 브라우저 이벤트 해설

- 원문: [이벤트 핸들러](https://ko.javascript.info/introduction-browser-events)
- 종류: secondary-tutorial; 접근: retrieved; 연결 주소: https://ko.javascript.info/introduction-browser-events
- 확인 내용/한계: 교육용 해설이며 표준 원문 근거로 승격하지 않는다.
- 재현·증거 도구: locator.click/press
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## F11 — Actionability

- 원문: [Visible / Receives Events](https://playwright.dev/docs/actionability)
- 종류: official-tool-guide; 접근: retrieved; 연결 주소: https://playwright.dev/docs/actionability
- 확인 내용/한계: 가시성·안정성·이벤트 수신 등은 도구 실행 조건이다. opacity 0도 visible일 수 있다.
- 재현·증거 도구: locator.click; expect
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## F12 — 입력 장치 동작

- 원문: [Actions API](https://www.selenium.dev/documentation/webdriver/actions_api/)
- 종류: official-tool-guide; 접근: retrieved; 연결 주소: https://www.selenium.dev/documentation/webdriver/actions_api/
- 확인 내용/한계: 키·포인터·휠 입력의 세부 동작을 설명하는 Selenium 가이드다.
- 재현·증거 도구: page.keyboard/mouse
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## F13 — 키보드 이벤트

- 원문: [Keyboard Event Types](https://www.w3.org/TR/uievents/#events-keyboardevents)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/uievents/
- 확인 내용/한계: 키보드 입력과 마우스 클릭은 동일한 이벤트 시퀀스가 아니다.
- 재현·증거 도구: locator.press
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## F14 — 커스텀 이벤트

- 원문: [CustomEvent.detail](https://developer.mozilla.org/ko/docs/Web/API/CustomEvent)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/ko/docs/Web/API/CustomEvent
- 확인 내용/한계: detail로 사용자 정의 데이터를 전달한다. 합성 이벤트는 실제 사용자 입력 대체 증거가 아니다.
- 재현·증거 도구: 관찰용 evaluate
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## F15 — 이벤트 대상

- 원문: [Event.target](https://developer.mozilla.org/ko/docs/Web/API/Event/target)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/ko/docs/Web/API/Event/target
- 확인 내용/한계: target 기반 위임을 조사한다. target과 리스너 부착 대상은 다를 수 있다.
- 재현·증거 도구: 하위 요소 locator.click
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## I02 — 입력 안내

- 원문: [Validating required input](https://www.w3.org/WAI/tutorials/forms/validation/)
- 종류: official-guidance; 접근: retrieved; 연결 주소: https://www.w3.org/WAI/tutorials/forms/validation/
- 확인 내용/한계: 사용자가 오류를 이해하고 수정할 수 있도록 안내하는 접근성 튜토리얼이다.
- 재현·증거 도구: get_by_label; 오류 연결 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## I03 — 클라이언트 검증

- 원문: [Constraint Validation API](https://developer.mozilla.org/en-US/docs/Learn/Forms/Form_validation)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Form_validation
- 확인 내용/한계: willValidate 및 validationMessage와 선언된 제약을 함께 조사한다.
- 재현·증거 도구: locator.evaluate; fill
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## I04 — ValidityState

- 원문: [Instance properties](https://developer.mozilla.org/en-US/docs/Web/API/ValidityState)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Web/API/ValidityState
- 확인 내용/한계: valid/valueMissing/typeMismatch 등의 원인을 분리한다.
- 재현·증거 도구: validity 속성 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## I05 — reportValidity

- 원문: [reportValidity](https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/reportValidity)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/reportValidity
- 확인 내용/한계: 검증 결과와 브라우저 오류 표시를 요청하는 API다. 관찰 자체가 이벤트를 유발할 수 있다.
- 재현·증거 도구: 필요할 때만 명시적 evaluate
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## I06 — setCustomValidity

- 원문: [setCustomValidity](https://developer.mozilla.org/en-US/docs/Web/API/HTMLSelectElement/setCustomValidity)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Web/API/HTMLSelectElement/setCustomValidity
- 확인 내용/한계: 비어 있지 않은 사용자 정의 메시지는 오류를 유지한다. 해소 시 빈 메시지가 필요하다.
- 재현·증거 도구: validity.customError 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## I07 — :invalid

- 원문: [Syntax / Examples](https://developer.mozilla.org/en-US/docs/Web/CSS/:invalid)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:invalid
- 확인 내용/한계: 유효하지 않은 제약 대상에 대응하는 CSS 선택자다.
- 재현·증거 도구: matches(':invalid')
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## I08 — :required

- 원문: [Syntax](https://developer.mozilla.org/en-US/docs/Web/CSS/:required)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:required
- 확인 내용/한계: required가 적용되는 컨트롤에 대응한다. 제품 필수 조건 전부를 표현하지 않는다.
- 재현·증거 도구: matches(':required')
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## I09 — aria-invalid

- 원문: [aria-invalid](https://www.w3.org/TR/wai-aria-1.2/#aria-invalid)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/wai-aria-1.2/
- 확인 내용/한계: 접근성 상태를 나타내며 입력 차단 로직 자체를 구현하지 않는다.
- 재현·증거 도구: get_attribute('aria-invalid')
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## I10 — aria-required

- 원문: [aria-required](https://www.w3.org/TR/wai-aria-1.2/#aria-required)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/wai-aria-1.2/
- 확인 내용/한계: 필수 입력 의미를 제공하며 네이티브 required 검증을 대체하지 않는다.
- 재현·증거 도구: get_attribute('aria-required')
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## I11 — 검증 전략

- 원문: [Input Validation Strategies](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- 종류: official-guidance; 접근: retrieved; 연결 주소: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- 확인 내용/한계: 구문과 의미 검증을 구분하는 OWASP 가이드다. 공격 페이로드 생성은 범위 밖이다.
- 재현·증거 도구: 정상·경계 입력 fill
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## I12 — 입력 타입

- 원문: [States of the type attribute](https://html.spec.whatwg.org/multipage/input.html)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://html.spec.whatwg.org/multipage/input.html
- 확인 내용/한계: 타입별 적용 속성과 상태가 다르므로 하나의 정규식을 모든 입력에 적용하지 않는다.
- 재현·증거 도구: type/min/max/pattern 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## I13 — FormData

- 원문: [FormData](https://developer.mozilla.org/ko/docs/Web/API/FormData)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/ko/docs/Web/API/FormData
- 확인 내용/한계: 전송할 폼 데이터를 다루는 API다. 값 원문 수집은 개인정보 노출에 주의한다.
- 재현·증거 도구: 네트워크 메타데이터 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## R01 — 현재 URL

- 원문: [Get Current URL](https://www.w3.org/TR/webdriver2/#get-current-url)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/webdriver2/
- 확인 내용/한계: 자동화 프로토콜이 현재 문서 주소를 읽는 절이다. 목적지의 제품 적합성을 보장하지 않는다.
- 재현·증거 도구: page.url
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## R02 — 세션 이력

- 원문: [Session history](https://html.spec.whatwg.org/multipage/browsing-the-web.html#history)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://html.spec.whatwg.org/multipage/browsing-the-web.html
- 확인 내용/한계: 세션 이력과 탐색을 구분해 뒤로/앞으로 이동을 조사한다.
- 재현·증거 도구: go_back/go_forward
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## R03 — URL 파싱

- 원문: [URL parsing / percent-encode sets](https://url.spec.whatwg.org/)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://url.spec.whatwg.org/
- 확인 내용/한계: 쿼리·경로·프래그먼트의 인코딩 의미를 구분한다.
- 재현·증거 도구: page.url; URLSearchParams 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## R04 — History API

- 원문: [pushState / popstate](https://developer.mozilla.org/en-US/docs/Web/API/History_API)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Web/API/History_API
- 확인 내용/한계: 문서 전체 재로드 없이 이력을 다루는 동작을 고려한다.
- 재현·증거 도구: URL 및 화면 상태 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## R05 — Navigation API

- 원문: [Navigation API](https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API
- 확인 내용/한계: 탐색 제어 API이며 브라우저 지원과 실행 환경을 먼저 확인한다.
- 재현·증거 도구: 페이지 내 지원 여부 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## R06 — location

- 원문: [Value / Examples](https://developer.mozilla.org/en-US/docs/Web/API/Window/location)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Web/API/Window/location
- 확인 내용/한계: 현재 주소 및 탐색을 다루는 Location 객체다.
- 재현·증거 도구: page.url; URL 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## R07 — 탐색 타이밍

- 원문: [redirectCount](https://www.w3.org/TR/navigation-timing-2/)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/navigation-timing-2/
- 확인 내용/한계: cross-origin 리다이렉트의 timing 정보가 제한될 수 있다.
- 재현·증거 도구: performance entries 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## R08 — HTTP 리다이렉트

- 원문: [Temporary redirects](https://developer.mozilla.org/en-US/docs/Web/HTTP/Redirections)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Redirections
- 확인 내용/한계: 상태 코드에 따라 메서드 보존 의미가 다르다.
- 재현·증거 도구: response/request 메타데이터
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## R09 — 주소 이동 명령

- 원문: [Navigate To](https://www.w3.org/TR/webdriver2/#navigate-to)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/webdriver2/
- 확인 내용/한계: 드라이버 navigate 완료와 제품 렌더 완료는 별개다.
- 재현·증거 도구: page.goto
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## R10 — 탐색과 hydration

- 원문: [Hydration](https://playwright.dev/docs/navigations)
- 종류: official-tool-guide; 접근: retrieved; 연결 주소: https://playwright.dev/docs/navigations
- 확인 내용/한계: 화면이 보이더라도 hydration이 끝나지 않아 조작이 유실될 수 있다.
- 재현·증거 도구: wait_for_url; UI 조건 대기
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## R11 — 네트워크 가로채기

- 원문: [intercept syntax](https://docs.cypress.io/api/commands/intercept)
- 종류: official-tool-guide; 접근: retrieved; 연결 주소: https://docs.cypress.io/api/commands/intercept
- 확인 내용/한계: Cypress intercept는 관찰과 응답 변경을 모두 지원한다. 변경한 응답은 실제 서버 증거가 아니다.
- 재현·증거 도구: page.on('response'); route는 분리 실험
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## R12 — SPA

- 원문: [SPA definition](https://developer.mozilla.org/en-US/docs/Glossary/SPA)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Glossary/SPA
- 확인 내용/한계: 단일 문서 안에서 JS로 내용을 바꿀 수 있다.
- 재현·증거 도구: URL와 DOM 함께 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## R13 — 쿼리 파라미터

- 원문: [Instance methods](https://developer.mozilla.org/ko/docs/Web/API/URLSearchParams)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/ko/docs/Web/API/URLSearchParams
- 확인 내용/한계: 중복 파라미터와 인코딩을 보존해 비교한다.
- 재현·증거 도구: URLSearchParams.getAll
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## R14 — 문서 간 메시지

- 원문: [postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
- 확인 내용/한계: 다른 창과 메시지를 주고받는 API다. 전달 대상과 수신 origin을 맥락에 맞게 조사한다.
- 재현·증거 도구: popup 및 메시지 관찰 (확장 필요)
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## R15 — 브라우징 컨텍스트

- 원문: [Browsing contexts](https://html.spec.whatwg.org/multipage/browsers.html#browsing-contexts)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://html.spec.whatwg.org/multipage/browsers.html
- 확인 내용/한계: 문서·창·컨텍스트 관계를 다룬다. 원래 fragment의 정확성은 재확인이 필요하다.
- 재현·증거 도구: expect_popup (확장 필요)
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## U01 — 렌더된 텍스트

- 원문: [Get Element Text](https://www.w3.org/TR/webdriver2/#get-element-text)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/webdriver2/
- 확인 내용/한계: 드라이버의 렌더된 텍스트 추출과 DOM textContent는 동일하지 않다.
- 재현·증거 도구: inner_text/text_content 비교
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## U02 — Displayedness

- 원문: [Appendix C Element displayedness](https://www.w3.org/TR/webdriver2/#is-element-displayed)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/webdriver2/
- 확인 내용/한계: 원본 #is-element-displayed는 현 문서 목차의 명령이 아니다. 부록 Element displayedness로 보완한다.
- 재현·증거 도구: is_visible + 스타일 + 스크린샷
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## U03 — CSS 박스 생성

- 원문: [Box generation](https://www.w3.org/TR/css-display-3/)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/css-display-3/
- 확인 내용/한계: DOM 트리와 생성된 박스 트리가 일치하지 않을 수 있다.
- 재현·증거 도구: bounding_box; computed style
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## U04 — 박스 모델

- 원문: [Box model / margins](https://www.w3.org/TR/css-box-3/)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/css-box-3/
- 확인 내용/한계: content/padding/border/margin을 분리해 크기와 겹침을 조사한다.
- 재현·증거 도구: bounding_box; 스타일 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## U05 — display

- 원문: [display values](https://developer.mozilla.org/en-US/docs/Web/CSS/display)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/display
- 확인 내용/한계: display 값은 박스 생성과 레이아웃을 제어한다.
- 재현·증거 도구: getComputedStyle.display
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## U06 — visibility

- 원문: [Values](https://developer.mozilla.org/en-US/docs/Web/CSS/visibility)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/visibility
- 확인 내용/한계: 숨김과 collapse는 레이아웃 종류에 따라 다르게 작용한다.
- 재현·증거 도구: getComputedStyle.visibility
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## U07 — hidden

- 원문: [Value](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/hidden)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/hidden
- 확인 내용/한계: hidden은 false/true/until-found 상태를 다룬다.
- 재현·증거 도구: hidden 속성 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## U08 — 계산 스타일

- 원문: [Description](https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle
- 확인 내용/한계: getComputedStyle은 resolved value를 제공하며 애니메이션 시점에 따라 달라질 수 있다.
- 재현·증거 도구: locator.evaluate
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## U09 — 오류 안내

- 원문: [User Notification](https://www.w3.org/WAI/tutorials/forms/notifications/)
- 종류: official-guidance; 접근: retrieved; 연결 주소: https://www.w3.org/WAI/tutorials/forms/notifications/
- 확인 내용/한계: 오류 설명을 입력 필드와 연결하고 색만으로 전달하지 않는 방식을 검토한다.
- 재현·증거 도구: aria-describedby; 오류 텍스트 관찰
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## U10 — CSS Layout API

- 원문: [Status of this document](https://www.w3.org/TR/css-layout-api-1/)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/css-layout-api-1/
- 확인 내용/한계: First Public Working Draft인 실험적 API다. 보편적으로 요구되는 제품 동작의 근거로 쓰지 않는다.
- 재현·증거 도구: 지원 여부를 확인한 별도 실험
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## U12 — Playwright assertions

- 원문: [Auto-retrying assertions](https://playwright.dev/docs/test-assertions)
- 종류: official-tool-guide; 접근: retrieved; 연결 주소: https://playwright.dev/docs/test-assertions
- 확인 내용/한계: 재시도 단언으로 조건 충족을 기다린다. 단언 실패가 버그 확정은 아니다. 시각 비교 전용 문서는 아니다.
- 재현·증거 도구: expect(locator); screenshot
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## U13 — Intersection Observer

- 원문: [Intersection Observer](https://developer.mozilla.org/ko/docs/Web/API/Intersection_Observer_API)
- 종류: technical-reference; 접근: retrieved; 연결 주소: https://developer.mozilla.org/ko/docs/Web/API/Intersection_Observer_API
- 확인 내용/한계: 교차 상태 관찰과 실제 사용자 지각 가능성·가림 여부를 동일시하지 않는다.
- 재현·증거 도구: bounding_box; 스크린샷
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## U14 — CSS containment

- 원문: [contain property](https://www.w3.org/TR/css-contain-1/)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/css-contain-1/
- 확인 내용/한계: size/layout/paint 격리가 크기와 잘림에 영향을 준다.
- 재현·증거 도구: computed style contain
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.

## U15 — WCAG 대비

- 원문: [SC 1.4.3 Contrast (Minimum)](https://www.w3.org/TR/WCAG22/#contrast-minimum)
- 종류: specification (check maturity); 접근: retrieved; 연결 주소: https://www.w3.org/TR/WCAG22/
- 확인 내용/한계: 1.4.3의 대상·예외 및 큰 글자 조건을 확인한 뒤 대비를 판단한다.
- 재현·증거 도구: 색·글꼴·배경 합성 관찰 (수동 분석)
- 활용: 이 관점을 가설과 관찰 설계에 사용하고, 제품 기대와 실제 관찰을 추가해 AI가 판단한다.
