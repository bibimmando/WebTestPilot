# 팀원 3 작업 공간

- 이름 / GitHub 아이디: Majunseo
- 담당 모듈: 테스트 사이트 · 벤치마크 (정답지, 결함 주입, 독립 재현·성능평가)
- 작업 브랜치: `development` (기능 브랜치 `feature/member-03/<작업명>`는 선택)
- 개발 변경은 `development`에 승인 없이 직접 push할 수 있다.
- `main` 반영은 `development` → `main` PR의 승인·CI 통과 후 총괄 담당자가 병합한다.

## maison/ — 테스트 대상 사이트

조명·도자기·가구·텍스타일을 다루는 홈 인테리어 편집숍 형태의 쇼핑몰이다.
크롤러와 AI 검사기의 성능을 재려고 만들었다. 결함을 환경변수로 켜고 끌 수
있어, 정상 사이트와 결함 사이트가 **같은 코드에서** 나온다.

### 이 폴더는 사본이다

| | |
|---|---|
| 원본 | https://github.com/Majunseo/Maison (브랜치 `develop`) |
| 사본 기준 커밋 | `9424d2e` |

여기를 고쳐도 원본에 반영되지 않는다. 고칠 일이 있으면 원본 저장소에
올리고, 그 뒤 이 폴더를 다시 내보낸다. 내보낼 때 쓰는 절차는 아래와 같다.

```sh
DST=teams/member-03/maison
rm -rf "$DST" && mkdir -p "$DST"
git -C <Maison 경로> archive develop | tar -x -C "$DST"
cd "$DST"
rm -f vite.config.ts.timestamp-*.mjs      # Vite 임시 파일
rm -rf .lovable                           # 생성 도구 기록
mv doc/* docs/ 2>/dev/null && rmdir doc   # 문서 폴더 통합
```

`git archive`는 git이 추적하는 파일만 내보낸다. `node_modules`(300MB)와
`dist`는 애초에 들어가지 않는다.

## 실행

```sh
cd teams/member-03/maison
npm install
npm run dev                  # http://localhost:8080  정상
BUGS_ON=all npm run dev      # 결함 17건 전부
BUG_F1=1 BUG_U3=1 npm run dev  # 지정한 것만
```

화면과 API가 같은 포트에서 돈다. 별도 서버를 띄우지 않는다.

```sh
npm run build && npm run preview   # 빌드 결과로 실행 (포트 4173)
npm test                           # vitest
```

### 데모 계정

```
demo@maison.com / demo1234     주문 2건이 미리 들어 있음
test@maison.com / test1234     주문 없음 — 계정별 분리 확인용
```

### 상태 초기화

```sh
curl -X POST http://localhost:8080/_reset
```

계정·주문은 메모리에만 있다. 영속 저장을 쓰면 실행을 반복할수록 주문이
쌓여 `/orders` 화면이 매번 달라지고 재현성이 깨진다. **측정을 시작하기
전에 한 번 호출한다.**

## 떠 있는 곳

```
http://13.124.7.113:8080   정상
http://13.124.7.113:8081   결함 17건 전부
```

두 주소가 같은 빌드에서 나온다. 차이는 환경변수 하나뿐이라, 두 사이트의
차이가 주입한 결함뿐이라고 말할 수 있다.

```
GET /api/bugs    지금 켜진 결함 ID 목록
GET /gt.json     정답지. 레지스트리에서 생성되므로 코드와 어긋나지 않음
GET /api/health
```

## 결함 현황

| 분야 | 접두사 | 건수 | 레지스트리 |
|---|---|---|---|
| 기능 | `F` | 4 | `server/bugs/functional.ts` |
| 입력 검증 | `V` | 5 | `server/bugs/validation.ts` |
| 이동·라우팅 | `N` | 3 | `server/bugs/routing.ts` |
| UI | `U` | 5 | `server/bugs/ui.ts` |

증상 분포는 `false_result` 6 · `visual` 5 · `wrong_target` 3 ·
`no_response` 2 · `partial` 1 이다. `duplicate`는 아직 비어 있다.

`N2`는 비어 있다. 없는 상품 주소에서 빈 화면을 보여주는 결함이었는데,
사이트 어디에도 그 주소로 가는 링크가 없어 링크를 따라가는 도구는 도달할
수 없었다. 번호는 당기지 않았다 — 앞선 커밋에서 N2가 그 결함을 가리켰기
때문이다.

### 규칙으로 잡히는 것과 아닌 것

`detectable: true`는 2건(`U1` 가로 스크롤, `N3` 스크롤 위치)이다. 나머지
15건은 기대 동작을 알아야 판정된다. 이 값은 "이렇게 될 것이다"라는 선언이고
실제 결과와 대조하는 것이 측정의 목적이므로, 틀려도 된다.

`N3`는 규칙 한 줄(`scrollY !== 0`)로 판정되지만 DOM에는 흔적이 없다.
스크린샷이나 `scrollY`를 수집하지 않는 파이프라인은 못 잡는다. "탐지
실패"와 "수집 누락"을 가르는 자리로 넣었다.

### 도달이 필요한 곳

`V1`~`V5`와 `N4`는 로그인·체크아웃 폼 뒤에 있다. 링크만 따라가는 크롤러는
`/login` `/signup` `/checkout` `/account` `/orders`에 도달하지 못한다.
탐지 0이 나왔을 때 **탐지 실패인지 도달 실패인지** 구분해 보고해야 한다.

## 개발용 사이트다 — 정답지가 공개돼 있다

`server/bugs/*.ts`에 17건의 제목·위치·재현 절차가 모두 적혀 있고
`/gt.json`이 그 파일들에서 생성된다. Maison은 **개발용**이므로 공개가 맞다.

**최종 평가용 사이트는 이렇게 올리지 않는다.** 정상 비교본·라벨·주입 위치·
정답을 검사 모델에 노출하면 평가가 무효가 된다. 평가용은 별도 저장소에
두고 평가자만 정답을 가진다.

## 자세한 문서

| 문서 | 내용 |
|---|---|
| `maison/README.md` | 구조 · 화면 17개 · API 23개 · 측정에 쓰이는 성질 |
| `maison/docs/bugs.md` | 결함 추가 절차 · ID 규칙 · 증상 분류 |
| `maison/docs/bugs-ui.md` | UI 결함 5건의 전후 사진과 확인 절차 |
| `maison/docs/ARCHITECTURE.md` | 구조 |
| `maison/docs/BUG_INJECTION_GUIDE.md` | 주입 지침 |
