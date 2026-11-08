# 멘토링 사전 자료: QA v2 엔진 (member-01)

> 2026-11-08 · 브랜치 `feature/member-01/qa-v2` · 코드 `qa/`

## 1. 프로젝트 목표

**URL 하나만 주면 AI가 사이트를 직접 써 보며 기능을 찾고, 검사 계획을 세워 실행한 뒤, 결함인지 판정해 보고서를 만드는 범용 QA 시스템**을 만드는 것이 목표입니다.

- 특정 사이트에 맞추지 않고, 처음 보는 웹앱에도 쓸 수 있어야 합니다.
- 결과는 세 가지로 구분합니다.
  - **기대와 다름:** 버그
  - **자동화 실패:** 미완료
  - **근거 부족:** 판단 보류
- 테스트 사이트의 통과율은 검증 수단일 뿐이고, 목표 자체로 삼지 않습니다.

제가 맡은 부분은 이 엔진(`qa/`) 전체의 설계와 구현입니다.

```
사이트 지도(코드) → 탐색·계획(AI) → 실행(코드, Playwright) → 대조·분류(코드 + 애매한 것만 AI) → 재현·판정(코드) → 보고서
```

- AI는 탐색·계획과 애매한 실패의 분류에만 씁니다. 실행·판정은 코드가 해서, 같은 계획이면 같은 결과가 나옵니다.
- 검사마다 기대값의 근거(요구사항·화면 문구·일반 웹 규칙)를 적게 하고, 탐색 때 본 값을 그대로 정답으로 쓰지 못하게 막습니다.
- 쓰기 요청과 다른 사이트로 가는 요청은 기본으로 막습니다.

## 2. 개발 상황

- **구현:** 사이트 지도부터 보고서(HTML·PDF·JSON)까지 처음부터 끝까지 동작합니다. 회귀 테스트 163개가 통과합니다.
- **최근 개선**
  - 비용: 계획을 시나리오 단위로 받고, 비슷한 페이지는 한 번만 탐색합니다.
  - 화면 결함: AI 없이 코드로 잡는 점검을 늘렸습니다. 가려진 버튼, 읽을 수 없는 글자 대비, 투명한데 눌리는 요소, 모바일 잘림, 깨진 링크가 대상입니다.
- **비교 실험:** 예제 메일 앱에서 공개 QA 에이전트(agent-browser `dogfood`)와 비교하고 있습니다.
  - 우리 엔진: 1회 약 $1.1
  - dogfood: $2.5
  - 이동·화면 결함은 비슷하게 찾습니다.
  - 저장이 필요한 기능 결함은, 결함을 잡고도 재현 확인 단계에서 막히는 문제를 고치는 중입니다.
- **남은 과제**
  - 실행마다 계획이 달라지는 문제
  - 개발에 쓰지 않은 독립 앱으로 평가하기

## 3. 테스트해 보는 방법

### 준비

- Node.js 24 이상, Git
- Python 3.10 이상(예제 앱용)
- Anthropic API 키(유료 실행에만 필요)

```powershell
git clone https://github.com/bibimmando/WebTestPilot.git
cd WebTestPilot
git checkout feature/member-01/qa-v2
npm install
npx playwright install chromium
cd qa
npm install
```

### 무료로 확인하기 (API 키 불필요, 3~4분)

```powershell
cd qa
npm test
```

작은 테스트 페이지에서 탐색·실행·판정 전체를 가짜 모델로 돌립니다.

### 예제 앱으로 실제 실행하기 (유료, 1회 약 $1~1.5, 10~30분)

1. 예제 메일 앱을 띄웁니다. 의도적으로 결함을 넣은 버전입니다.

   ```powershell
   git clone -b bug-page https://github.com/shlee705/email_page.git
   cd email_page
   .\init_server.bat
   .\start_server.bat    # http://127.0.0.1:8000
   ```

2. 저장소 루트에 `.env`를 만들고 `ANTHROPIC_API_KEY=...`를 적습니다.

3. 로그인 절차를 적은 앱 설정 `qa/runs/apps/email_page.json`을 만듭니다. 비밀번호는 파일에 쓰지 않고 환경 변수 이름만 적습니다.

   ```json
   {
     "login": {
       "url": "http://127.0.0.1:8000/signin.html",
       "username": { "role": "textbox", "name": "^Username or internal email$" },
       "password": { "role": "textbox", "name": "^Password$" },
       "submit": { "role": "button", "name": "^Sign in$" },
       "success": { "urlIncludes": "email.html" },
       "env": { "username": "EMAILPAGE_USER", "password": "EMAILPAGE_PASS" }
     },
     "deny": ["logout", "signout", "sign-out", "log-out"]
   }
   ```

4. 실행합니다. 시험 계정은 메일 앱 README의 "고정 시험 계정" 표에 있습니다.

   ```powershell
   cd qa
   $env:EMAILPAGE_USER = "<시험 계정 아이디>"
   $env:EMAILPAGE_PASS = "<시험 계정 비밀번호>"
   node src/cli.ts --url http://127.0.0.1:8000/email.html --app runs/apps/email_page.json --budget 6 --name email
   ```

5. 끝나면 출력된 `qa/runs/email-<시각>/`의 `report.pdf`를 엽니다.

전체 옵션과 결과 파일 설명은 [qa/README.md](../../qa/README.md)에 있습니다.
