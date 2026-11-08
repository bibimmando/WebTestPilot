# AI Tester Email Site

AI tester 시험용 사이트입니다. 로그인, 회원가입, 이메일(메일 작성 포함)만 제공합니다.
로그인 후 이메일로 이동하며, 기존 Dashboard, Chat, Calendar 등의 페이지/API는 제거했습니다.
별표 표시와 카테고리 탭 없이 각 폴더의 메일을 한 목록에 표시합니다.
이메일 라벨은 `important`, `success` 두 개만 지원합니다. 폴더는 Inbox와 Sent만 지원합니다. 기존의 다른 폴더 메일은 서버 시작 시 받은 메일은 Inbox, 보낸 메일은 Sent로 옮깁니다. 기존 임시저장 데이터는 DB에 보존하되 화면에 표시하지 않으며 새 임시저장은 지원하지 않습니다.

## Windows 실행

1. Python 3.10 이상을 설치하고 PATH에 추가합니다.
2. `init_server.bat`를 실행합니다. 가상 환경과 Python 의존성을 설치합니다(최초 설치 시 인터넷 필요).
3. `start_server.bat`를 실행합니다.
4. [로그인 페이지](http://127.0.0.1:8000/signin.html)에 접속합니다.

`dist/` 빌드 결과가 저장소에 포함되므로, Git에서 새로 받은 뒤 실행할 때 Node.js/npm 설치는 필요하지 않습니다.

## 고정 시험 계정

| 아이디 | 비밀번호 | 내부 이메일 |
| --- | --- | --- |
| test | testtesttest | test@adminator.test |
| admin | adminadminadmin | admin@adminator.test |

서버 시작 시 두 계정을 자동 생성합니다. 재시작해도 계정 ID와 기존 메일은 유지되며, 지정 비밀번호와 활성 상태가 복구됩니다.
데이터베이스를 Git에 올리지 않아도 새 환경에서 같은 계정으로 로그인할 수 있습니다.
두 계정은 일반 시험 계정이며, 별도의 관리자 권한 페이지는 없습니다. 회원가입으로 다른 계정도 추가할 수 있습니다.
비밀번호는 데이터베이스에 Argon2 해시로 저장됩니다.

기본 이메일은 가입된 `@adminator.test` 계정 간 내부 송수신입니다. 외부 SMTP/IMAP은 사용하지 않습니다.
메일 화면의 Mock mailbox 전환 기능은 별도 샘플 메일함을 제공하며 실제 수신자에게 전달하지 않습니다.

## 개발 및 검증

프런트엔드를 수정할 때만 Node.js 22.22.2 이상을 설치한 뒤 실행합니다.

`npm ci` → `npm run lint` → `npm run test:run` → `npm run build`

백엔드: `.venv\Scripts\python.exe -m pytest backend/tests -q`

브라우저 검사(Chrome 필요): `npm run test:reduced:e2e`

소스와 함께 갱신된 `dist/`, `package-lock.json`을 커밋하세요. 로컬 DB(`backend/data/`)와 `.venv/`는 커밋하지 않습니다.
기존 설치의 스키마 호환성을 위해 과거 DB 마이그레이션은 유지합니다.

서버는 backend Python 파일 변경을 자동으로 다시 불러오도록 실행됩니다. 이전 버전으로 이미 실행 중인 서버는 한 번 종료한 뒤 start_server.bat로 다시 시작하세요.
