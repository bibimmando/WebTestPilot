# member-02 독립 실행·검증 안내

2026-10-16. 이 디렉토리의 integration은 member-01 통합 코드에서 가져온 독립 실행 사본입니다. member-01 파일을 변경하거나 import하지 않습니다. 판정 원본은 src/ai_inspection/judgment, 실행에 쓰는 사본은 integration/judgment입니다.

## 1. 설치

저장소를 받은 뒤 `teams/member-02/ai-inspector`에서 실행합니다.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r integration/examples/maison_recheck/requirements-lock.txt
python -m playwright install chromium
npm.cmd install --prefix .tools/playwright-mcp @playwright/mcp@0.0.83 --no-audit --no-fund
```

기준 실행 환경은 Python 3.13.13, Node 24.18.0, Playwright 1.63.0, MCP Python 1.30.0, Playwright MCP 0.0.83, Chromium 153.0.8010.12입니다. 설치 명령은 키를 필요로 하지 않습니다.

## 2. 저장된 6종 결과 확인 — API 없음

```powershell
python scripts/verify_shared_baseline.py
```

이는 [공유 결과](reports/maison_2026-10-16/README.md)의 증거 파일·원본/재현 상태·참조를 검증합니다. 사이트를 다시 테스트하거나 AI를 호출하지 않습니다.

## 3. 로컬 코드 검증 — 유료 API 없음

```powershell
python -m unittest discover -s src/ai_inspection -t . -v
python -m unittest discover -s integration/test -t . -v
python -m integration.test_staged
python -m integration.test.generate_quality_demo --output output/local-demo-new
```

마지막 명령은 localhost 예제와 실제 Playwright MCP, 고정 모델 응답을 사용합니다. 정상·고장·잘못된 대상·이름 없는 버튼·이미지 재현을 검증하며 AI 탐지율 측정이 아닙니다. 기존 upstream 테스트의 위치는 유지했고 새 테스트는 별도 test 디렉토리에 있습니다.

## 4. 전체 검사 입력 준비 — 기본값은 API 없음

```powershell
python -m integration.examples.maison_recheck.run_campaign --output output/maison-preview-new
```

패키지 안의 설정·29개 URL·정상 요구사항·후속 검사 2건만 읽습니다. 예전 결과 폴더·개인 PC 경로·member-01 설치본을 필요로 하지 않습니다. 출력의 campaign.json과 inputs를 확인합니다. 매번 새 출력 폴더를 사용합니다.

## 5. 실제 Sonnet 검사 — 유료

현재 PowerShell 세션의 `ANTHROPIC_API_KEY` 또는 이 디렉토리의 로컬 `.env`에 본인의 키를 설정합니다. `.env.example`은 빈 공유 양식이며 실제 키를 커밋하지 않습니다.

먼저 한 페이지로 시작할 수 있습니다.

```powershell
python -m integration.examples.maison_recheck.run_campaign --limit 1 --skip-followups --output output/maison-one-new --execute
```

전체 실행:

```powershell
python -m integration.examples.maison_recheck.run_campaign --output output/maison-full-new --execute
```

`--execute`를 넣어야 API·브라우저 동작을 실행합니다. 기록된 전체/후속 실험의 추정 비용은 약 $21.26이며 사용량 미기록 1회가 있습니다. 현재 증거 중복 압축·프롬프트 캐싱·달러 비용 상한은 아직 구현하지 않았습니다. 설정된 시간·행동·호출·출력 토큰 한도는 전체 금액 상한이 아닙니다.

이번 공개 runner는 전체 검사 후 후속 검사 2건을 순차 실행합니다. 원래 실험은 후속 검사를 본 검사 후반에 함께 실행했습니다. 각 seed는 새 브라우저를 사용하고, 공통 폼 ledger는 본 검사끼리만 공유합니다. 새 실험에는 새 ledger를 사용합니다.

## 결과 해석

기록된 기준은 29개 URL·31개 flow·89개 시나리오, 고유 재현 확인 F1/F2/F3/F4/N1/U5의 6/17종입니다. AI는 매 실행 새 계획을 생성하므로 같은 발견 수·판정 문구를 보장하지 않습니다. 위 명령은 고정 계획 재실행 도구가 아닙니다. 고정된 6종 기록은 공유 증거와 offline verifier로 확인합니다.

현재 읽기 전용 요청, 1280×800, 비밀번호 입력 차단 조건입니다. 로그인·가입·계정 변경·주문 생성·모바일/포커스 전용 검사 확장은 후속 작업입니다. 브라우저 상태 복원은 서버 상태 복원을 보장하지 않습니다. 사이트 배포 버전·버그 활성화·네트워크·모델 동작에 따라서도 결과가 달라집니다.

버그 ID/정답은 reports 아래의 평가 자료에만 있고 실행 설정에는 넣지 않습니다. API 키·인증 상태·브라우저 프로필·대형 전체 원본 기록은 공유 범위에서 제외했습니다.

## 판정 코드 수정 후 내부 동기화

```powershell
python scripts/sync_judgment_integration.py
python scripts/sync_judgment_integration.py --apply
```

이 도구는 member-02의 src → integration만 반영합니다. 다른 팀 디렉토리는 변경하지 않습니다. docs의 초기 기록에는 과거 개발 폴더 경로가 포함될 수 있으므로 현재 설치·실행 명령은 이 문서를 기준으로 합니다.
