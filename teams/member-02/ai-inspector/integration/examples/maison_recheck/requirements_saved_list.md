# Maison 정상 기능과 이번 점검 범위

출처: 팀의 Maison README 및 PROJECT_OVERVIEW.md의 정상 기능 설명. 결함 정답표·주입 ID·재현 정답은 포함하지 않습니다.
별도 업무 규칙을 추측하지 말고 아래 정상 기능 또는 실제 화면 관찰을 기대 근거로 명시하세요.

## 정상 기능
- 상품 목록은 컬렉션 필터·검색·정렬을 제공한다. 검색 결과·정렬 방향은 실제 이름/가격과 비교한다.
- 상품 상세는 이미지·수량 1~10·장바구니 추가·위시리스트 토글·연관 상품을 제공한다.
- 장바구니는 수량 변경·삭제·상품별 금액과 합계·체크아웃 이동을 제공한다.
- 위시리스트는 저장·삭제·전체 장바구니 추가를 제공하며 전체 추가 후에도 위시리스트를 유지한다.
- 체크아웃은 연락처·배송지 필수값 검증, 주문 요청, 성공 후 장바구니 비우기·주문 화면 이동을 제공한다.
- 로그인·회원가입·비밀번호 찾기·계정·내 주문 화면이 있다. 인증이 필요한 기능의 비로그인 상태는 오류라고 단정하지 않는다.
- 배송·관리·FAQ·개인정보·약관·쿠키 안내 화면이 있으며 FAQ 아코디언을 사용할 수 있다.
- 뉴스레터는 접수 응답만 제공한다. 실제 메일 발송·결제·배송을 기대하지 않는다.

## 검사 제한과 증거 해석
- 페이지마다 핵심 시나리오 2~3개를 고르며 전체 계획 행동 수는 최대 8개로 한다. 같은 정적 문구 검사를 과도하게 반복하지 않는다.
- 가능한 범위에서 기능·입력 검증·라우팅·실제 이미지 기반 UI를 균형 있게 검사한다.
- 임의로 기존 계정의 비밀번호/프로필을 변경하거나 가입·비밀번호 초기화를 성공시키지 않는다. 인증 정보는 입력하지 않는다.
- /_reset, /gt.json, /api/bugs 및 진단/정답 경로는 방문하거나 호출하지 않는다. 다른 origin으로 이동하지 않는다.
- 테스트 목적의 장바구니·위시리스트 상태 변경과 비밀값 없는 폼 검증은 허용한다.
- 비밀번호/파일 입력은 실행기의 지원 대상이 아니다. 로그인 뒤 기능을 수행했다고 주장하지 않는다.
- 비어 있는 장바구니·로그인 필요·초기 조건 부족·관찰 누락은 미실행/판단 불가로 구분한다.
- actual은 전후 관찰에서 직접 확인한 사실만 작성한다. 변화가 있으면 무엇이 추가/삭제/변경됐는지 명시한다.
- validation.message만으로 툴팁 표시를 주장하지 않는다. novalidate·DOM 오류 문구·폼 이벤트·네트워크를 함께 본다.
- submit 이벤트나 요청 부재만으로 제출 성공·차단을 확정하지 않는다. 모르는 기대 결과는 inconclusive로 남긴다.
- 스크린샷에 실제 보이는 범위만 시각적으로 판단한다. 잘린 본문·프레임 밖 영역을 검사했다고 주장하지 않는다.


Narrow follow-up: propose exactly ONE self-contained functional scenario for the ordinary behavior below. Do not add newsletter or unrelated UI checks. If the preconditions are missing, mark it unplanned.
Save the currently observed product, then open the observed saved-list link. Compare the rendered item identity and price with the product you saved and compare the item contents with any saved count. A notification alone is insufficient.