# 브랜치 병합 호환성

작성: 2026-10-09 (Asia/Seoul). 브랜치는 main에서 변경하지 않았고 커밋/병합은 수행하지 않았다. 실제 다른 브랜치 병합은 미검증이다.

## 소유 파일과 공통 접점

| 파일 | 소유 / 위험 |
|---|---|
| server/bugs/validation.ts | 입력 검증 전용. 다른 분야는 functional/routing/ui.ts 사용. validation 담당끼리는 항목 중복 가능 |
| server/bugs/validation-behavior.ts | 신규 입력 검증 서버 모듈. 다른 유형과 텍스트 충돌 낮음 |
| src/bugs/validation/useValidationBugs.ts | 신규 입력 검증 UI 모듈. 다른 유형은 자기 디렉터리 사용 |
| src/test/restored-validation-*.test.* | 신규 유형 전용 테스트. 공유 설정 변경 없음 |
| server/api.ts | 공통 수정 불가피: import + signup 길이 검사 + PATCH name. Functional/auth 변경이나 API 리팩터링과 충돌 가능 |
| src/pages/Checkout.tsx | 공통: import/최상위 hook/email type/city required. Functional 주문 제출·Routing 성공 이동과 다른 위치지만 import/인접 JSX 충돌 가능 |
| src/pages/ResetPassword.tsx | 공통: import/최상위 hook/불일치 조건. Functional·Routing이 같은 handleSubmit을 수정하면 텍스트/의미 충돌 가능 |
| doc의 이번 4개 파일 | 모든 유형이 같은 산출물 이름을 만들면 add/add 충돌. 이번 파일을 공통 복원 기록으로 먼저 공유하거나 타입별 별도 문서에서 참조 |

공통 설정 server/bugs/index.ts·types.ts, hooks/useBugs.ts, App.tsx, package.json, 잠금 파일, Vite/Vitest 설정을 수정하지 않았다. 기존 네 분야 합산·중복 ID 검사·환경변수 읽기를 그대로 사용한다. 한 번 이 연결 지점을 공통 기반에 반영한 후 다른 브랜치에서는 유형 전용 모듈을 사용하면 동일 연결 코드를 반복 수정할 필요가 줄어든다. 병합 충돌을 없앤다는 보장은 아니다.

## ID/토글 독립성

- F / V / N / U 접두사 분할 유지. 이번 V1~V5는 사용자 재번호화로 예약했다. 과거 설계 V1~V5를 나중에 추가할 때 같은 ID를 쓰지 않는다.
- 과거 V3→새 V1, V6→V2, V7→V3, V9→V4, V11→V5. BUG-001~005는 문서 별칭이며 환경변수 키로 쓰지 않는다.
- `BUG_${id}`로 자동 파생하므로 ID 고유성은 토글 키 고유성도 보장한다. 기존 index는 중복 ID이면 시작 시 오류를 내며 자동 테스트도 중복/순서를 검사한다.
- 기본 OFF, 개별 변수는 정확히 '1'일 때 ON. BUGS_ON='all'은 전체 활성화다. 토글 간 값을 쓰거나 바꾸지 않는다. 이전 스크립트 BUG_V3는 이제 다른 증상이며, 과거 BUG_V1/V2/V4/V5도 의미가 바뀌었다. 구형 토글 별칭을 혼용하지 않는다.
- 서버 시작 시 고정, 프론트는 /api/bugs를 읽는다. 토글 미수신 동안 OFF. 서버 재시작 후 브라우저 캐시를 새로 시작한다.

## 런타임 상호작용

V1/V3는 서로 다른 Checkout 속성만 바꾼다. 하나의 주문에서 둘 다 비정상 입력이면 두 결함이 관찰되므로 각 결함의 증거는 해당 필드만 비정상으로 둔다. V2/V5는 서로 다른 API 분기/조건이며 V4는 ResetPassword만 바꾼다. V4 실험 준비 가입 암호는 9자 이상을 사용하면 V5의 8자 거부에 막히지 않는다. V2는 기존 store trim에 의존한다. V4는 계정 암호·세션·토큰을 바꾸므로 같은 계정을 공유하면 다른 테스트에 영향을 준다. 전용 계정/컨텍스트로 격리한다.

향후 Functional이 주문 POST/clearCart를 변경하거나 Routing이 성공 이동을 변경하면 V1/V3의 사후 결과 관찰을 방해할 수 있다. 주문 API에 새 형식/도시 검증을 넣으면 V1/V3 재현이 서버에서 차단된다. UI CSS가 입력/버튼을 숨기거나 클릭 차단하면 UI 재현이 불가능할 수 있다. 과거 V1 가입 길이 완화는 새 V5와 같은 조건 충돌, 과거 V14 오류 표시 제거는 새 V4가 return을 우회하면서 은폐한다. 이번에는 해당 후보를 구현하지 않는다.

## 병합 전후 확인

1. git diff --name-only로 소유 파일과 위 공통 파일을 확인하고 docs 원문·잠금 파일 변경이 없는지 확인한다. 문서 일부는 작업 전부터 untracked였으므로 git status의 ??를 이번 생성물로 오인하지 않는다.
2. ID 및 의미/토글 대응을 맞춘다. 다른 유형 prefix와 validation.ts의 새 V1~V5 예약을 공유한다.
3. import를 모두 보존하고 각 정상 경로를 기준선과 대조한다. 같은 handleSubmit을 한쪽 버전으로 통째로 선택하지 않는다. 기존 pending/필수/토큰/인증 분기를 유지한다.
4. tsc 앱/서버, npm test, lint, build 실행. 현재 전체 lint 기존 3개 오류와 신규 오류를 구분한다. 테스트는 OFF/각 단독 ON/전체 ON/OFF 및 정상 통제를 검사한다.
5. 새 V1~V5만 지정한 UI 테스트 외에 병합한 F/N/U의 단독·동시 ON을 실제 브라우저로 검사한다. /api/bugs/gt.json은 평가 제어기만 확인한다. 버그 없는 OFF 기준선 및 제출 횟수/URL/저장 상태/필드 validity를 비교한다.

이번 검증: ID 중복 없음, 새 키 중복 없음, 5개 단독 및 전체 ON/OFF 자동 검사 PASS. 실제 4유형 병합·모든 조합·브라우저 E2E는 미검증이다. 이후 다른 유형이 추가되면 자동 테스트의 all 모드는 등록된 모든 ID 활성화를 검사하지만 해당 유형의 동작 검증까지 제공하지 않는다.
