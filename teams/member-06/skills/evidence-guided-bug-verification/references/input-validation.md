# 입력·검증·오류 안내

검색 ID: I02–I13. [출처 인덱스](source-index.md)에서 원문/접근 상태를 확인한다.

[ValidityState](https://developer.mozilla.org/en-US/docs/Web/API/ValidityState)를 이용해 값의 유효성과 오류 종류를 관찰하고, 실제 사용자 제출 결과를 별도로 관찰한다. `aria-required`나 `aria-invalid`가 존재한다는 것만으로 제출 차단을 기대하지 않는다. 해당 [ARIA 의미](https://www.w3.org/TR/wai-aria-1.2/#aria-required)와 제품 요구를 분리한다.

AI는 타입별 정상 값, 빈 값, 경계 값과 제품 도메인 조건 중 필요한 것만 선택한다. 입력값이 숫자 필드에서 브라우저에 의해 정규화/거절됐는지 확인한다. `required`, `disabled`, `willValidate`, `novalidate`, 사용자 정의 오류 상태와 실제 제출 경로가 기대의 적용 전제에 영향을 준다. 네이티브 submit 버튼과 JS 제출 경로를 구별하되 허가 없이 별도 요청을 보내지 않는다.

I05의 reportValidity/checkValidity 호출은 invalid 이벤트 등을 유발할 수 있으므로 먼저 validity 속성을 수동 관찰하고, 호출 실험은 상태 변경 가능성을 기록한다. I06은 select용 문서이므로 모든 컨트롤을 동일하게 구현한다고 단정하지 않는다. I07/I08은 CSS 선택자이지 서버나 제품의 전체 검증 정책이 아니다.

오류 안내는 [WAI validation](https://www.w3.org/WAI/tutorials/forms/validation/)과 [notifications](https://www.w3.org/WAI/tutorials/forms/notifications/)를 참고해 입력-메시지 연결, 수정 안내, 시점, 색 이외 단서를 검토한다. 사용자 요구가 없는 특정 문구/언어를 강제하지 않는다. 클라이언트 검증 성공만으로 서버 저장 결과를 추론하지 않는다. OWASP(I11)는 구문/의미 검증 관점만 활용하고 침투 테스트로 확장하지 않는다.
