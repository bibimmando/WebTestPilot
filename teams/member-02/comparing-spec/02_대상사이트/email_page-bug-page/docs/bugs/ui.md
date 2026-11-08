# UI 결함 상세

기준일: 2026-11-02 (Asia/Seoul). 사용자가 요청하여 추가한 결함만 수록한다. 기존 결함 ID를 유지한다.

[유형별 개수 및 요약](overview_buf.md) · [문서 안내](bugs.md)

## U2: 폴더·라벨 활성 표시 누락

| 항목 | 값 |
|---|---|
| Bug ID | U2 |
| 유형 | ui |
| 구현 상태 | 검증 완료 |
| 수정 파일 | src/assets/scripts/2026/email/ui.js |
| 기준일 | 2026-11-01 |

### 1. 버그 개요

폴더와 라벨은 실제로 필터링되지만 현재 선택 상태를 표시하지 않는다.

### 2. 정상 기대 동작 (Expected Behavior)

현재 폴더/라벨 강조, aria-pressed, 폴더 제목, 선택 라벨 배지·드롭다운이 일치한다.

### 3. 결함 동작 (Actual Defective Behavior)

폴더와 라벨 강조는 없고 aria-pressed는 false다. 제목은 Email 및 결과 수만 표시하며 라벨 드롭다운은 All labels로 돌아간다.

### 4. 재현 조건 (Preconditions)

서버 실행 후 test / testtesttest, admin / adminadminadmin 사용. 기본 내부 메일 모드. Chrome PC(1440×900), 모바일(390×900).

### 5. 재현 절차 (Steps to Reproduce)

1. 서로 다른 라벨 메일을 준비한다.
2. important 또는 success를 선택한다.
3. 결과는 필터링되지만 활성 강조와 선택 배지가 없는지 확인한다.
4. Sent로 이동하여 보낸 메일은 보이지만 현재 폴더 표시는 없는지 확인한다.

### 6. 예상 관찰 결과

레이아웃 넘침이 아니라 상태 표시 누락이다. PC·모바일, 밝은/어두운 테마 모두 동일 로직이다.

### 7. 버그 구현 방법

필터 query는 유지하고 is-active 조건, aria-pressed 상태, 폴더명·라벨 배지와 드롭다운 선택 표시를 제거했다.

### 8. 탐지 방법

실제 목록/API query와 화면 강조·제목·드롭다운 값을 비교한다.

### 9. 검증 기준

필터링 자체가 작동하고 선택 표시만 누락되어야 한다.

### 10. 검증 결과

2026-11-01: npm run test:bugs:e2e 통과. Chrome 1440×900 및 390×900에서 결함 재현과 전용 Compose 발송·Add account 정상 동작을 확인했다.

## U3: 계정 메뉴 버튼 겹침

| 항목 | 값 |
|---|---|
| Bug ID | U3 |
| 유형 | ui |
| 구현 상태 | 검증 완료 |
| 수정 파일 | src/assets/styles/2026/_accounts.scss |
| 기준일 | 2026-11-01 |

### 1. 버그 개요

오른쪽 위 계정 메뉴의 Switch Account와 Logout이 겹친다.

### 2. 정상 기대 동작 (Expected Behavior)

두 메뉴 항목은 독립된 행에 배치되고 클릭 영역도 겹치지 않는다.

### 3. 결함 동작 (Actual Defective Behavior)

Switch Account가 Logout 위로 올라와 글자와 클릭 영역이 겹친다. 겹친 영역의 클릭은 위에 놓인 Switch Account가 받는다. 좌측 하단 계정 버튼은 정상 배치를 유지한다.

### 4. 재현 조건 (Preconditions)

로그인한 상태의 email.html. Chrome PC 1440×900, 모바일 390×900. test / testtesttest 사용. 밝은/어두운 테마 모두 같은 CSS를 사용한다.

### 5. 재현 절차 (Steps to Reproduce)

1. 로그인한다.
2. 오른쪽 위 아바타를 클릭한다.
3. Logout과 Switch Account의 겹침을 확인한다.

### 6. 예상 관찰 결과

Switch Account가 Logout 위로 올라와 글자와 클릭 영역이 겹친다. 겹친 영역의 클릭은 위에 놓인 Switch Account가 받는다. 좌측 하단 계정 버튼은 정상 배치를 유지한다.

### 7. 버그 구현 방법

프로필 메뉴의 계정 전환 버튼에 margin-top: -32px와 z-index: 1을 적용한다.

### 8. 탐지 방법

메뉴를 열어 두 버튼의 bounding box가 수평·수직 모두 교차함을 확인하고 스크린샷으로 기록한다.

### 9. 검증 기준

메뉴를 열어 두 버튼의 bounding box가 수평·수직 모두 교차함을 확인하고 스크린샷으로 기록한다. 기존 F2·F3·F4·U2 결함도 계속 재현되어야 한다.

### 10. 검증 결과

2026-11-02: npm run test:bugs:e2e 통과. Chrome PC(1440×900)·모바일(390×900)에서 두 버튼 영역 교차와 opacity=0인 Compose 링크의 실제 클릭 이동을 확인했다. 기존 F2·F3·F4·U2도 함께 재현했다. 증거: screenshots/reduced-site/menu-overlap-1440.png, menu-overlap-390.png.

## U4: 사이드바 Compose 시각적 누락

| 항목 | 값 |
|---|---|
| Bug ID | U4 |
| 유형 | ui |
| 구현 상태 | 검증 완료 |
| 수정 파일 | src/assets/styles/2026/_accounts.scss |
| 기준일 | 2026-11-01 |

### 1. 버그 개요

좌측 사이드바 Compose가 보이지 않지만 클릭할 수 있다.

### 2. 정상 기대 동작 (Expected Behavior)

Compose 링크의 아이콘과 문구가 보이고 클릭하면 compose.html로 이동한다.

### 3. 결함 동작 (Actual Defective Behavior)

Compose 아이콘·문구가 사라져 빈 영역으로 보이지만 같은 위치를 클릭하면 전용 작성 페이지로 이동한다. 상단 New mail과 이메일 내부 Compose 버튼은 표시된다.

### 4. 재현 조건 (Preconditions)

로그인한 상태의 email.html. Chrome PC 1440×900, 모바일 390×900. test / testtesttest 사용. 밝은/어두운 테마 모두 같은 CSS를 사용한다.

### 5. 재현 절차 (Steps to Reproduce)

1. 로그인한다. 모바일에서는 Open navigation으로 사이드바를 연다.
2. Email 아래 Compose가 있던 빈 공간을 클릭한다.
3. compose.html로 이동하는지 확인한다.

### 6. 예상 관찰 결과

Compose 아이콘·문구가 사라져 빈 영역으로 보이지만 같은 위치를 클릭하면 전용 작성 페이지로 이동한다. 상단 New mail과 이메일 내부 Compose 버튼은 표시된다.

### 7. 버그 구현 방법

좌측 사이드바의 compose.html 링크에 opacity: 0을 적용한다. 크기, href, 포인터 이벤트와 키보드 포커스는 유지한다.

### 8. 탐지 방법

해당 링크의 계산된 opacity가 0이고, 강제 클릭 없이 링크 중앙을 클릭하면 compose.html로 이동함을 확인한다.

### 9. 검증 기준

해당 링크의 계산된 opacity가 0이고, 강제 클릭 없이 링크 중앙을 클릭하면 compose.html로 이동함을 확인한다. 기존 F2·F3·F4·U2 결함도 계속 재현되어야 한다.

### 10. 검증 결과

2026-11-02: npm run test:bugs:e2e 통과. Chrome PC(1440×900)·모바일(390×900)에서 두 버튼 영역 교차와 opacity=0인 Compose 링크의 실제 클릭 이동을 확인했다. 기존 F2·F3·F4·U2도 함께 재현했다. 증거: screenshots/reduced-site/menu-overlap-1440.png, menu-overlap-390.png.

## U5: 다크 모드의 검정 글씨 유지

| 항목 | 값 |
|---|---|
| Bug ID | U5 |
| 유형 | ui |
| 구현 상태 | 검증 완료 |
| 수정 파일 | src/assets/styles/2026/_tokens.scss |
| 기준일 | 2026-11-02 |

### 1. 버그 개요

다크 모드로 전환하면 배경은 어두워지지만 기본 텍스트는 라이트 모드의 검정 계열 색상에 머물러 가독성이 떨어진다.

### 2. 정상 기대 동작 (Expected Behavior)

라이트 모드 기본 글자색 #1E293B가 다크 모드에서 #F1F5F9로 밝아져 어두운 배경에서 읽기 쉬워야 한다.

### 3. 결함 동작 (Actual Defective Behavior)

다크 모드에서도 기본 글자색이 #1E293B(rgb(30,41,59))로 유지된다. 배경·테두리·테마 아이콘은 다크 모드로 전환된다. 다시 라이트 모드로 돌아갈 수 있다.

### 4. 재현 조건 (Preconditions)

test / testtesttest로 로그인하여 email.html에서 라이트 모드로 시작한다. Chrome PC 1440×900 및 모바일 390×900. 상단 Toggle theme 버튼 사용.

### 5. 재현 절차 (Steps to Reproduce)

1. 라이트 모드에서 제목과 기본 텍스트 색을 확인한다.
2. 상단 테마 버튼을 눌러 다크 모드로 전환한다.
3. 배경은 어두워졌으나 제목·메일 본문·기본 입력 글씨 등이 검정 계열로 유지되는지 확인한다.
4. 새로고침하여 저장된 다크 모드에서도 같은 증상이 유지되는지 확인한다.
5. 테마 버튼을 다시 눌러 라이트 모드 복귀를 확인한다.

### 6. 예상 관찰 결과

html의 data-theme는 dark이고 배경 색상은 변경되지만 기본 텍스트의 계산된 color는 rgb(30, 41, 59)다. 전용 의미 색상을 사용하는 링크·라벨·회색 보조 문구까지 모두 검정으로 강제하지는 않는다.

### 7. 버그 구현 방법

다크 테마의 --t-base 토큰을 라이트 테마와 같은 #1E293B로 설정한다. 배경 색상과 테마 전환·저장 로직은 유지한다. 이 토큰을 사용하는 Email, 전용 Compose, 계정 메뉴 및 인증 화면의 기본 텍스트에 공통 적용된다.

### 8. 탐지 방법

전환 전후 제목의 계산된 글자색, body 배경색, html의 data-theme를 대조한다. 다크 모드 스크린샷을 확인하고 새로고침 후 재검사한다.

### 9. 검증 기준

다크 배경 전환·테마 저장·라이트 모드 복귀는 작동하면서 기본 글자색이 밝아지지 않아야 한다. 기존 8개 결함도 유지되어야 한다.

### 10. 검증 결과

2026-11-02: npm run test:bugs:e2e 통과. Chrome PC(1440×900)·모바일(390×900)에서 다크 배경 전환 후 제목 색 rgb(30, 41, 59) 유지, 새로고침 후 다크 설정·글자색 유지, 라이트 복귀를 확인했다. 기존 8개 결함도 재현했다. 빌드 및 JS/SCSS 린트 통과. 증거: screenshots/reduced-site/dark-text-1440.png 및 dark-text-390.png.
