# Routing & Redirection

링크·직접 진입·뒤로/앞으로·새로고침·query 상태를 요구사항과 비교한다. HTTP 이동과 SPA 상태 변화를 구별한다. URL 변화만으로 화면 완료를 판단하지 않는다. 의미 있는 URL/요소 상태를 기다린다. 새 컨텍스트와 기존 세션의 차이를 기록한다. 마스킹된 query 값은 원래 재현 입력을 대신하지 못한다.

원본 근거: `skill-data/core/SKILL.md`의 Waiting/Tabs/Persist session, `skill-data/core/references/session-management.md`. 현재 runner는 새 컨텍스트만 제공하며 상태 저장/복원·팝업은 기존 실행기로 연결해야 한다.
