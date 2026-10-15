# Input Validation

빈 값·경계값·형식 오류·정상 대조군을 제품 요구사항에 맞춰 선택한다. required/type/min/max 등의 DOM 조건과 실제 제출/오류 안내를 비교한다. 브라우저 validity와 사용자 정의 검증은 별개다. HTML required가 없다는 관찰만으로 버그를 확정하지 않는다. 잘못된 입력을 넣었다는 사실과 서버가 이를 저장했다는 사실을 혼동하지 않는다.

선택 요소의 validity, visible, valueLength와 전후 상태를 수집한다. 실제 비밀번호나 개인정보 대신 비민감 테스트 값을 사용한다. 원본 근거: `skill-data/core/templates/form-automation.sh`, `skill-data/dogfood/references/issue-taxonomy.md`의 Forms. 외부 검증 문서와 조항은 미제공이다.
