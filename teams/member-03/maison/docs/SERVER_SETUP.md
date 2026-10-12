# Windows 설치 및 서버 운영

분석일: 2026-10-08. 명령은 package.json scripts, vite.config.ts, 서버 코드와 기존 README에 근거한다. 아래 설치/실행 절차는 이번 분석에서 실제 실행하지 않았다.

## 런타임과 준비물

필수는 Node.js와 npm, 브라우저다. Python, pip, venv, 별도 Express 서버, DB, Docker는 현재 실행에 필요하지 않다. 저장소에 Node 버전을 고정하는 engines/.nvmrc/.node-version은 없다. `@types/node` 22는 타입 패키지이며 런타임 버전 고정이 아니다.

`package-lock.json` 확인값:

| 패키지 | 잠금 버전 | Node engines |
|---|---|---|
| vite | 5.4.19 | ^18.0.0 또는 >=20.0.0 |
| vitest | 3.2.4 | ^18.0.0 또는 ^20.0.0 또는 >=22.0.0 |
| eslint | 9.32.0 | ^18.18.0 또는 ^20.9.0 또는 >=21.1.0 |
| typescript | 5.8.3 | >=14.17 |

이는 주요 패키지의 명시 조건이며 전체 전이 의존성을 포함한 실행 보장은 아니다. **제안:** 조건을 만족하는 Node 22 또는 24 계열과 npm을 준비하고, 실험에서는 정확한 설치 버전을 기록한다. 특정 설치 프로그램·현재 지원 상태는 조사하지 않았다. Bun 잠금 파일도 있지만 문서와 scripts의 기본 경로는 npm이다.

이번 환경에서는 `node --version`이 `v24.19.0`을 반환했으나 `npm --version`은 명령을 찾지 못했다. `node_modules`도 없었다. 따라서 의존성 설치, 타입 검사, 테스트, 빌드, HTTP 응답, 실제 포트 점유·브라우저 동작은 **미확인**이다. Node가 있다고 npm도 준비되어 있다고 간주하지 않는다.

## 최초 실행: PowerShell

Node/npm 설치 후 새 PowerShell을 열어 다음을 실행한다.

```powershell
Set-Location 'C:\Users\custa\OneDrive\Desktop\Maison-main'
node --version
npm --version
npm install
npm run dev
```

`npm install`은 README의 설치 명령이다. 잠금 파일을 그대로 재현하려면 npm 표준 명령인 `npm ci`로 대체할 수 있다(제안, 실제 실행 미확인). 두 설치 명령을 연달아 수행할 필요는 없다. install은 잠금 파일을 갱신할 수 있으므로 실험 기준선에서 차이를 확인한다.

PowerShell이 npm.ps1 실행 정책 때문에 차단하는 경우에 한해 설치된 `npm.cmd`로 같은 명령을 실행할 수 있다. 현재 분석 환경의 오류는 실행 정책 오류가 아니라 명령 미발견이었다. npm이 설치되지 않았거나 PATH에 없으면 설치/환경 경로를 먼저 해결한다.

기본 개발 주소: `http://localhost:8080/`. `vite.config.ts`의 host는 `::`, port는 8080이다. API도 같은 포트다. strictPort는 설정되지 않아 포트 사용 중에는 실제 선택 포트가 달라질 수 있으므로 터미널 URL을 확인한다. IPv4 localhost 접속 및 LAN/방화벽 동작은 현 환경에서 검증하지 않았다.

두 번째 PowerShell에서 확인:

```powershell
Invoke-RestMethod -Uri 'http://localhost:8080/api/health'
Invoke-RestMethod -Uri 'http://localhost:8080/api/bugs'
Invoke-RestMethod -Uri 'http://localhost:8080/gt.json'
```

소스 기준 기대값: health의 ok=true, products=13, users=2, orders=2. 새 시작 직후 bugs.enabled는 빈 배열, gt의 total/enabled는 0이다. 실행 중 회원가입·주문 후에는 수가 달라진다.

## 환경변수

필수 환경변수와 `.env` 샘플은 없다. 코드에서 서버의 `process.env`를 직접 읽는다. Vite 설정에 사용자 `.env`를 process.env로 복사하는 loadEnv 처리는 없으므로 **PowerShell 환경변수로 전달하는 경로**를 사용한다.

| 변수 | 코드 / 의미 |
|---|---|
| API_DELAY_MS | server/api.ts: 기본 250ms. 일반 /api 요청 지연; /_reset와 /gt.json 제외 |
| BUGS_ON | server/bugs/index.ts: 정확히 all이면 등록 버그 전체 활성화 |
| BUG_버그ID | 동일 파일: 값이 문자열 1이면 해당 등록 버그 활성화 |

```powershell
$env:API_DELAY_MS = '600'
npm run dev
# 종료 후 기본값 복원
Remove-Item Env:API_DELAY_MS -ErrorAction SilentlyContinue
```

지연은 유한한 0 이상의 숫자로 정하는 것을 제안한다. 현재 코드는 Number 변환 후 별도 유효성 검증을 하지 않는다.

토글 예시(후보 구현·등록 이후에만 실제 결함 발생):

```powershell
$env:BUG_F1 = '1'
npm run dev
# Ctrl+C 이후
Remove-Item Env:BUG_F1 -ErrorAction SilentlyContinue
```

전체 토글은 `$env:BUGS_ON = 'all'`이다. 현재 레지스트리는 비어 있어 켜도 결함이 생기지 않는다. `BUGS_ON=all npm run dev` 같은 README의 POSIX 문법은 PowerShell 문법이 아니다. BUGS_ON=all이 설정되어 있으면 개별 변수를 지워도 전체 활성화가 우선한다.

## 초기 데이터와 상태 초기화

`server/api.ts` 모듈 초기화가 `reset(priceOf)`를 호출한다. 상품/컬렉션/안내 본문은 TS 상수, 계정·세션·주문·재설정 토큰은 `server/store.ts` 메모리다. 별도 시드 명령과 DB 준비는 필요 없다. 시드 계정 2개 중 한 계정은 과거 주문 2개, 다른 계정은 주문 0개다. 비밀번호·세션·재설정 토큰은 이 문서에 기록하지 않는다. 로그인 실험은 임시 테스트 계정을 `/signup`에서 생성하는 방법을 권장한다.

```powershell
Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/_reset'
```

reset은 계정/주문을 시드로 복원하고 기존 세션·재설정 토큰을 무효화한다. 브라우저 쿠키, `maison-cart`, `wishlist-storage`, React Query 캐시는 지우지 않는다. 브라우저의 사이트 데이터를 정리하고 새 컨텍스트로 시작하거나 저장소 삭제 후 완전히 새로고침한다. 재설정 요청에 토큰/비밀번호를 첨부할 필요는 없다. 토글 값은 reset으로 바뀌지 않는다.

## 종료·재시작·빌드

서버 터미널에서 Ctrl+C로 종료한다. 같은 폴더에서 `npm run dev`를 다시 실행한다. 프로세스 재시작 시 서버 메모리가 초기화되고 토글·지연 환경변수를 다시 읽는다. 변수 변경 후에는 재시작하며, 브라우저도 새로고침해 무한 staleTime의 bugs 캐시를 버린다.

```powershell
npm run build
npm run preview
```

빌드는 dist/를 생성한다. README 기준 preview 기본 URL은 `http://localhost:4173/`이며 vite.config.ts에는 별도 preview 포트가 없다. 실제 URL은 시작 로그로 확인한다. `apiPlugin`이 configurePreviewServer에도 연결되므로 preview에서 API도 제공한다. UI 수정은 재빌드가 필요하고 서버 수정·환경변수는 서버 재시작으로 확인하는 것이 안전하다. `dist/`만 정적 호스팅하면 `/api/*`를 제공하지 못한다. 운영 배포, 서비스 등록, HTTPS, 리버스 프록시 설정은 현재 프로젝트에서 확인되지 않는다.

## 제공된 검사 명령

```powershell
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
npm test
npm run lint
npm run build
```

타입 검사 명령은 기존 docs/bugs.md에도 있다. build script는 `vite build`만 수행하며 `tsc`를 실행하지 않는다. 따라서 “타입 필드가 없으면 빌드가 반드시 멈춘다”는 기존 설명은 정확하지 않고 별도 tsc가 필요하다. Vitest의 현재 테스트는 `expect(true).toBe(true)` 1건으로 업무 기능을 검증하지 않는다. Playwright 패키지·설정·실행 script는 없다.

기준선과 결함 서버를 비교하는 실행 방법, 브라우저 격리 주의점은 [BUG_INJECTION_GUIDE.md](BUG_INJECTION_GUIDE.md)를 따른다.
