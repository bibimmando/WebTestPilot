# 탐색·URL·상태

검색 ID: R01–R15. [출처 인덱스](source-index.md)에서 필요한 항목만 읽는다.

기대 목적지와 유지되어야 할 상태는 제품 맥락으로 정한다. URL이 바뀌지 않아도 SPA 화면 전환은 가능하고, URL이 바뀌어도 올바른 화면 렌더를 보장하지 않는다. [SPA 정의](https://developer.mozilla.org/en-US/docs/Glossary/SPA)와 [History API](https://developer.mozilla.org/en-US/docs/Web/API/History_API)를 이 구분의 기술 근거로 활용한다.

- R02/R04: 뒤로/앞으로 이동 시 URL, UI 선택 상태, 스크롤, 전송 완료 상태 중 제품에서 요구하는 것만 비교한다. 이력 개수 자체를 정답으로 삼지 않는다.
- R03/R13: 중복 파라미터, 인코딩, 공백/플러스, fragment를 구조적으로 비교한다. 원문 문자열 차이가 의미 차이인지 구분한다. URLSearchParams의 getAll 등으로 중복값 손실을 관찰한다.
- R07/R08: HTTP status와 redirect chain, 요청 메서드 보존을 관찰한다. [HTTP 리다이렉트 가이드](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Redirections)의 의미를 제품 목적지 적합성과 별도로 적용한다. navigation timing의 redirectCount=0은 cross-origin 이동이 없었다는 증명이 아니다.
- R09/R10: goto/load 완료가 상호작용 준비 완료를 보장하지 않는다. [Playwright hydration 설명](https://playwright.dev/docs/navigations#hydration)을 참고해 URL 조건과 사용자 효과를 함께 기다린다.
- R05/R14/R15: 지원 브라우저, 새 창/iframe, 메시지 컨텍스트를 먼저 확인한다. 제공 runner는 단일 page용이므로 popup이 원인인 경우 기존 Agent의 허가된 브라우저 도구로 추가 수집한다.

R11의 intercept나 mock은 통제 실험에 유용하나 응답을 바꾼 실험과 실제 서버 관찰은 별도 evidence로 표시한다. 민감한 query/fragment를 공유 로그에 노출하지 않고 재현 입력은 접근 제어된 곳에 보관한다.
