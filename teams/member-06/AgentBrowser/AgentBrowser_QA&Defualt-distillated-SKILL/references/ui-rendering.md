# UI / Rendering

viewport, 요소 bounds, display/visibility/opacity, 가림·겹침과 실제 화면을 함께 확인한다. DOM 존재 또는 Playwright visible은 사용자가 읽거나 클릭할 수 있다는 충분한 근거가 아니다. 의도된 숨김·반응형 레이아웃·로딩 상태와 구분한다. 화면 증거가 필요한 후보에서는 마스킹된 screenshot을 opt-in으로 수집한다.

원본 근거: `skill-data/core/SKILL.md`의 Screenshot, `skill-data/dogfood/SKILL.md`의 Static / visible-on-load issues. 정적 문제에 영상을 의무화하지 않는다. pixel 비교·contrast 계산·axe 검사는 현재 runner에 구현되어 있지 않다.
