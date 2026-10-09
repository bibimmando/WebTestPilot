# 로컬 실행 및 Claude API 키 보안
**개발 간 API 키 보안 사항에 대해 먼저 확인한다.**

WebTestPilot은 외부 서버에 배포하지 않고 **개발자 로컬 환경에서 실행**한다.

Claude API는 실제 API 키를 사용하며, Playwright MCP 역시 로컬에서 실제 브라우저를 조작하도록 구현한다.

### 1. 환경변수 관리

- 프로젝트 루트의 `.env` 파일에 Claude API 키를 저장한다.
- 환경변수 이름은 `ANTHROPIC_API_KEY`로 통일한다.
- Python에서는 `python-dotenv` 또는 기존 환경변수 로딩 모듈을 사용한다.
- API 키를 소스 코드, 설정 파일, 테스트 코드에 하드코딩하지 않는다.
- API 키가 없으면 명확한 오류 메시지를 출력하고 실행을 중단한다.
- 기존 `env_config.py`가 있다면 이를 우선 재사용한다.

### 2. GitHub 업로드 방지

프로젝트 루트의 `.gitignore`에 다음 규칙이 포함되어 있는지 확인하고, 없다면 추가한다.

```gitignore
# Environment variables and secrets
.env
.env.*
!.env.example

# Python
__pycache__/
*.py[cod]
.venv/
venv/
```

- 실제 `.env` 파일은 Git 추적 대상에서 제외한다.
- `.env.example`에는 환경변수 이름만 기록하고 실제 API 키는 포함하지 않는다.
- 기존 `.gitignore` 규칙은 삭제하지 않는다.
- `.env`가 이미 Git에서 추적 중이라면 `git rm --cached .env`로 추적을 해제한다. 로컬 파일은 삭제하지 않는다.
- API 키가 과거 커밋에 포함된 적이 있다면 키를 폐기하고 재발급하도록 안내한다.

### 3. API 키 노출 방지

- API 키를 콘솔, 로그, JSON 결과, 예외 메시지에 출력하지 않는다.
- Claude API 요청 헤더에 포함된 인증정보를 로그로 기록하지 않는다.
- 디버그 모드에서도 API 키를 마스킹한다.
- AI에게 API 키 값을 출력하거나 확인하도록 요청하지 않는다.
- `.env` 파일의 내용을 읽어 응답에 표시하지 않는다.

### 4. 로컬 실행

다음 실행 흐름이 가능하도록 구현한다.

1. 개발자가 `.env`에 `ANTHROPIC_API_KEY`를 설정한다.
2. 로컬에서 Playwright MCP 서버를 실행하거나 애플리케이션이 실행한다.
3. Python 애플리케이션이 Claude API에 검사 계획을 요청한다.
4. Claude가 생성한 계획을 Playwright MCP가 실제 실행한다.
5. 실행 결과를 Claude에 전달해 후속 검사를 수행한다.
6. 최종 검사 결과를 JSON 파일로 저장한다.

### 5. 개발 완료 전 보안 검증

다음 사항을 반드시 확인한다.

- `.env`가 Git 추적 대상이 아닌지 확인
- `git status`에서 `.env`가 커밋 대상으로 표시되지 않는지 확인
- `git check-ignore -v .env`로 제외 규칙 확인
- 실제 API 키가 소스 코드와 테스트 결과에 포함되지 않았는지 확인
- `.env.example`만 GitHub에 업로드 가능한 상태인지 확인

**완료 조건:** 로컬에서 실제 Claude API와 Playwright MCP가 정상 작동하며, API 키가 GitHub 저장소나 실행 결과에 노출되지 않아야 한다.