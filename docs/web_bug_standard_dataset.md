# 🌐 웹 버그 탐지 AI 스킬 구축용 글로벌 표준 데이터셋 (총 60개)

본 문서는 웹 프론트엔드 테스트 및 자동화 디버깅 AI 스킬(Agent) 구축을 위한 RAG 인덱싱 및 데이터 수집용 마크다운 명세서입니다. 각 버그 유형별로 15개씩, 총 60개의 실제 작동하는 공식 유효 주소(Raw URL)를 정리했습니다.

---

## 🕹️ 1. 기능적 버그 (Functional Bugs) 관련 명세 (15개)
> 주요 대상: 버튼 미작동, 이벤트 핸들러 누락, 인터랙션 실패, 이벤트 전파 오류 등

1. W3C WebDriver - Element Click Specification
   https://www.w3.org/TR/webdriver2/#element-click
2. W3C UI Events - Mouse Event Order Specification
   https://www.w3.org/TR/uievents/#events-mouseevents
3. W3C Pointer Events Specification
   https://www.w3.org/TR/pointerevents/
4. WHATWG HTML - Activation Behavior of Elements
   https://html.spec.whatwg.org/multipage/webappapis.html#activation
5. MDN Web Docs - EventTarget.addEventListener()
   https://developer.mozilla.org/ko/docs/Web/API/EventTarget/addEventListener
6. MDN Web Docs - Introduction to Web Events
   https://developer.mozilla.org/ko/docs/Learn/JavaScript/Building_blocks/Events
7. MDN Web Docs - Event.preventDefault()
   https://developer.mozilla.org/ko/docs/Web/API/Event/preventDefault
8. MDN Web Docs - Event.stopPropagation()
   https://developer.mozilla.org/ko/docs/Web/API/Event/stopPropagation
9. WHATWG HTML - Event Loops and Interaction
   https://html.spec.whatwg.org/multipage/webappapis.html#event-loops
10. JavaScript Info - Introduction to Browser Events
    https://ko.javascript.info/introduction-browser-events
11. Playwright - Actionability & Clickability Checks
    https://playwright.dev/docs/actionability
12. Selenium - Advanced User Interactions & Actions
    https://www.selenium.dev/documentation/webdriver/actions_api/
13. W3C UI Events - KeyboardEvent Specification
    https://www.w3.org/TR/uievents/#events-keyboardevents
14. MDN Web Docs - CustomEvent API Reference
    https://developer.mozilla.org/ko/docs/Web/API/CustomEvent
15. MDN Web Docs - Event.target Property
    https://developer.mozilla.org/ko/docs/Web/API/Event/target

---

## 📝 2. 입력 검증 버그 (Input Validation Bugs) 관련 명세 (15개)
> 주요 대상: 유효성 로직 누락, 잘못된 데이터 허용, 에러 안내 레이블 표시 오류 등

1. WHATWG HTML - Form Constraint Validation
   https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constraint-validation
2. W3C WAI Forms Tutorial - Validating Input
   https://www.w3.org/WAI/tutorials/forms/validation/
3. MDN Web Docs - Client-side Form Validation Guide
   https://developer.mozilla.org/en-US/docs/Learn/Forms/Form_validation
4. MDN Web Docs - ValidityState API Specification
   https://developer.mozilla.org/en-US/docs/Web/API/ValidityState
5. MDN Web Docs - HTMLFormElement.reportValidity()
   https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/reportValidity
6. MDN Web Docs - HTMLSelectElement.setCustomValidity()
   https://developer.mozilla.org/en-US/docs/Web/API/HTMLSelectElement/setCustomValidity
7. MDN Web Docs - CSS :invalid Pseudo-class
   https://developer.mozilla.org/en-US/docs/Web/CSS/:invalid
8. MDN Web Docs - CSS :required Pseudo-class
   https://developer.mozilla.org/en-US/docs/Web/CSS/:required
9. W3C WAI-ARIA - aria-invalid Attribute Spec
   https://www.w3.org/TR/wai-aria-1.2/#aria-invalid
10. W3C WAI-ARIA - aria-required Attribute Spec
    https://www.w3.org/TR/wai-aria-1.2/#aria-required
11. OWASP - Input Validation Cheat Sheet
    https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
12. WHATWG HTML - Forms input element Spec
    https://html.spec.whatwg.org/multipage/input.html
13. MDN Web Docs - FormData API Reference
    https://developer.mozilla.org/ko/docs/Web/API/FormData
14. WHATWG HTML - Form Submission Algorithms
    https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#form-submission-algorithm
15. W3C Web Accessibility Tutorials - Custom Validation Rules
    https://www.w3.org/WAI/tutorials/forms/custom-validation/

---

## 🗺️ 3. 페이지 이동 / 라우팅 (Routing & Redirection) 관련 명세 (15개)
> 주요 대상: 잘못된 리다이렉트, 주소 파싱 오류, 파라미터 유실, 컨텍스트 유실 등

1. W3C WebDriver - Get Current URL Standard
   https://www.w3.org/TR/webdriver2/#get-current-url
2. WHATWG HTML - Session History and Navigation
   https://html.spec.whatwg.org/multipage/browsing-the-web.html#history
3. WHATWG - URL Living Standard Specification
   https://url.spec.whatwg.org/
4. MDN Web Docs - History API Specification
   https://developer.mozilla.org/en-US/docs/Web/API/History_API
5. MDN Web Docs - Navigation API Specification
   https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API
6. MDN Web Docs - Window.location Object Reference
   https://developer.mozilla.org/en-US/docs/Web/API/Window/location
7. W3C Navigation Timing Level 2 Specification
   https://www.w3.org/TR/navigation-timing-2/
8. MDN Web Docs - HTTP Redirects Guide
   https://developer.mozilla.org/en-US/docs/Web/HTTP/Redirections
9. W3C WebDriver - Navigate To Command Spec
   https://www.w3.org/TR/webdriver2/#navigate-to
10. Playwright - Page Navigation & Waiting Guide
    https://playwright.dev/docs/navigations
11. Cypress - Intercepting and Routing Network Requests
    https://docs.cypress.io/api/commands/intercept
12. MDN Web Docs - Single Page Application Glossary
    https://developer.mozilla.org/en-US/docs/Glossary/SPA
13. MDN Web Docs - URLSearchParams API Reference
    https://developer.mozilla.org/ko/docs/Web/API/URLSearchParams
14. MDN Web Docs - Window.postMessage() API
    https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
15. WHATWG HTML - Browsing Contexts and Target Names
    https://html.spec.whatwg.org/multipage/browsers.html#browsing-contexts

---

## 🖼️ 4. UI 버그 (UI / Rendering Bugs) 관련 명세 (15개)
> 주요 대상: 레이아웃 깨짐, 요소 은폐 오류, 미표시 버그, 시각적 가시성 위반 등

1. W3C WebDriver - Get Element Text Standard
   https://www.w3.org/TR/webdriver2/#get-element-text
2. W3C WebDriver - Is Element Displayed Standard
   https://www.w3.org/TR/webdriver2/#is-element-displayed
3. W3C CSS Display Module Level 3 Specification
   https://www.w3.org/TR/css-display-3/
4. W3C CSS Box Model Module Level 3 Specification
   https://www.w3.org/TR/css-box-3/
5. MDN Web Docs - CSS display Property Reference
   https://developer.mozilla.org/en-US/docs/Web/CSS/display
6. MDN Web Docs - CSS visibility Property Reference
   https://developer.mozilla.org/en-US/docs/Web/CSS/visibility
7. MDN Web Docs - HTMLElement.hidden Property
   https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/hidden
8. MDN Web Docs - Window.getComputedStyle() API
   https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle
9. W3C WAI Forms Tutorial - Error Notifications User Experience
   https://www.w3.org/WAI/tutorials/forms/notifications/
10. W3C CSS Layout API Level 1 Specification
    https://www.w3.org/TR/css-layout-api-1/
11. Web Platform Tests (WPT) - Main Dashboard
    https://wpt.fyi/
12. Playwright - Visual Comparisons and Assertion Checks
    https://playwright.dev/docs/test-assertions
13. MDN Web Docs - Intersection Observer API
    https://developer.mozilla.org/ko/docs/Web/API/Intersection_Observer_API
14. W3C CSS Containment Module Level 1 Specification
    https://www.w3.org/TR/css-contain-1/
15. W3C Web Content Accessibility Guidelines (WCAG) - Visual Contrast
    https://www.w3.org/TR/WCAG22/#contrast-minimum