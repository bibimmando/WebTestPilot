<!--
기능 유형별 점검 안내. 탐색 모델이 read_guide 도구로 필요한 유형만 읽는다(사이트별 내용 없음).
출처(Apache-2.0, 내용을 옮겨 우리 계약에 맞게 다시 씀): agent-browser dogfood 스킬의 Issue Taxonomy·Exploration Checklist
(github.com/vercel-labs/agent-browser, skill-data/dogfood/references/issue-taxonomy.md),
Playwright Test Agents planner(github.com/microsoft/playwright, packages/playwright/src/agents/playwright-test-planner.agent.md).
규칙 ID와 형식은 rules.ts가 기준이다. 성능·색 대비·다크 모드처럼 이 도구가 판정하지 않는 것은 observations에만 적는다.
-->
## form
입력 폼(가입·로그인·검색창·설정·글쓰기)
- 정상 흐름 하나와 경계·오류 흐름을 함께 계획합니다: 빈 필수값, 형식이 틀린 값(이메일·숫자·날짜), 너무 긴 값, 앞뒤 공백.
- 잘못된 입력은 받아들여지지 않고 안내가 나와야 합니다(required-input, invalid-input-feedback). 안내 문구가 화면에 있으면 constraint로 인용합니다.
- 브라우저가 띄우는 검증 말풍선은 화면 글자가 아닙니다. 제출 뒤 주소·목록·입력값이 그대로인지로 확인합니다.
- 쓰기가 막혀 있으면 제출 결과는 확인할 수 없습니다. 제출 전에 보이는 검증(버튼 비활성, 즉시 안내)과 입력값 처리는 검사할 수 있습니다.
- 초기화·취소처럼 처음 상태로 되돌리는 컨트롤이 있으면 누른 뒤 입력칸이 처음 값으로 돌아오는지(reset-restores). 제출 뒤 입력칸을 비울지 남길지는 앱마다 다르므로 안내 문구가 없으면 기대하지 않습니다. 같은 값을 다시 제출하면 기록이 하나 더 생기는 것이 정상일 수 있어, same-action-same-result는 상태를 처음과 같게 되돌린 뒤 조회·계산처럼 상태를 바꾸지 않는 동작에만 씁니다.

## list
목록(검색 결과·상품·게시글·알림·표)
- 개수 문구가 있으면 실제 항목 수와 비교합니다(count-matches-list, expected_from + same_number).
- 필터·카테고리를 고른 뒤 모든 항목이 조건에 맞는지(filter-matches, read items), 필터를 풀면 처음 개수로 돌아오는지(reset-restores).
- 정렬을 바꾸면 그 기준 순서인지(sort-order, items + sorted_asc·sorted_desc, expected는 number 또는 text).
- 페이지 넘김 뒤 항목이 바뀌는지(page-changes), 마지막 페이지와 빈 결과 화면도 봅니다.
- 검색어가 결과에 들어 있는지(filter-matches all_contain), 결과가 없을 때 안내가 나오는지.

## navigation
이동(메뉴·사이드바·카드·브레드크럼·뒤로 가기)
- 링크·카드의 이름과 눌렀을 때 열린 페이지의 제목이 같은지(link-target: 누르기 전 이름을 읽고 expected_from + equals). 메뉴 항목을 하나씩 확인합니다.
- 없는 페이지(404)나 서버 오류로 가지 않는지(no-error-page).
- 뒤로 가기·새로고침 뒤 고른 필터·탭·입력한 상태가 유지되는지(state-persists).
- 같은 목적지를 가리키는 여러 경로(메뉴와 카드)가 같은 곳으로 가는지.

## dialog
메뉴·모달·탭·드롭다운·토글
- 여는 버튼을 누르면 열리는지(action-has-effect, 누르기 전 값과 expected_from), 닫기 버튼·취소·Escape로 닫히는지(close-dismisses: read visible, expected "false"). 닫기 전에 열려 있음을 visible true로 확인해 둡니다.
- 탭·토글을 바꾸면 내용이 바뀌는지, 이미 고른 탭은 바뀌지 않아도 정상입니다.
- 비활성 컨트롤은 눌러도 동작하지 않아야 합니다(disabled-inert).
- 펼친 메뉴·모달이 다른 요소에 가리거나 잘리지 않는지(content-readable, read visual). 모바일 크기에서 특히 봅니다.

## flow
여러 화면에 걸친 결과(담기·찜·저장·등록·읽음 표시·설정 변경)
- 앱이 결과를 알리면(완료 안내·배지 숫자) 그 결과를 모아 보여 주는 화면으로 이동해 반영됐는지 봅니다(effect-shown-elsewhere: 행동 전에 고유한 이름을 읽어 두고 결과 화면 items와 any_equal·any_contain).
- 배지·개수가 행동 수만큼 바뀌는지(step-by-one, offset).
- 상태가 필요하면 그 상태를 만드는 행동을 시나리오 steps에 넣습니다(시나리오는 빈 브라우저 상태에서 시작).
- 쓰기가 막혀 서버 저장이 필요한 흐름은 확인할 수 없으니 unplanned에 이유를 적습니다.

## screen
화면 상태(모바일·겹침·잘림·빈 상태·오류 상태)
- viewport 도구로 mobile로 바꿔 메뉴·모달·표·긴 제목이 화면 안에 보이고 손이 닿는지 봅니다. 데스크톱 검사를 그대로 반복하지는 않습니다.
- 겹침·잘림은 접근성 트리로 보이지 않습니다. 의심되는 화면만 screenshot으로 보고 read visual 조건으로 적습니다(content-readable).
- 빈 목록, 결과 없음, 오류 상태에서 안내가 나오는지 봅니다.
- 이름 없는 아이콘 버튼·가려진 버튼·가로 넘침은 하네스가 따로 계산하므로 시각 검사로 다시 쓰지 않습니다.
