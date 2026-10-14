# 팀 공유 AI 스킬

[Evidence-Guided Bug Verification](evidence-guided-bug-verification/)은 AI의 가설·재현·판단을 돕는 독립 스킬이다. Playwright 도구는 실행과 증거만 반환한다. 본문 접근을 확인한 55개 출처를 포함한다.

## 설치

저장소의 `development` 브랜치를 받은 뒤 스킬 **폴더 전체**를 Codex 사용자 skills 폴더로 복사한다. `SKILL.md`만 따로 복사하지 않는다. ZIP은 필요하지 않다.

저장소 루트에서 Windows PowerShell:

```powershell
$skillBase = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'skills' } else { Join-Path $env:USERPROFILE '.codex/skills' }
$skillDestination = Join-Path $skillBase 'evidence-guided-bug-verification'
if (Test-Path -LiteralPath $skillDestination) { throw '기존 스킬을 확인한 뒤 업데이트하세요.' }
New-Item -ItemType Directory -Path $skillBase -Force | Out-Null
Copy-Item -LiteralPath 'teams/member-06/skills/evidence-guided-bug-verification' -Destination $skillDestination -Recurse
```

macOS/Linux:

```sh
skill_base="${CODEX_HOME:-$HOME/.codex}/skills"
skill_destination="$skill_base/evidence-guided-bug-verification"
if [ -e "$skill_destination" ]; then
  echo '기존 스킬을 확인한 뒤 업데이트하세요.'
else
  mkdir -p "$skill_base"
  cp -R teams/member-06/skills/evidence-guided-bug-verification "$skill_destination"
fi
```

설치 후 새 대화에서 `$evidence-guided-bug-verification`을 호출한다. 목록이 갱신되지 않으면 앱/세션을 다시 연다. 다른 AI Agent에서는 SKILL.md와 관련 reference를 지침으로 로드하고 실행 도구를 연결한다. 모델 학습 또는 제품 파이프라인 자동 등록을 수행하는 패키지는 아니다.

## 실행 준비와 검증

Python 3.10+와 브라우저 실행 가능한 환경에서:

```sh
cd teams/member-06/skills/evidence-guided-bug-verification
python -m pip install -r requirements.txt
python -m playwright install chromium
python scripts/validate.py --schema schemas/bug_candidate.schema.json --data examples/bug_candidate.json
python scripts/validate.py --schema schemas/verification_result.schema.json --data examples/verification_example.json
python scripts/demo.py --out runs/demo-001
```

`--out`은 새 경로를 사용한다. demo는 임시 localhost 서버와 실제 Chromium으로 결함/정상/locator 오류/초기 URL 범위 거절을 확인하며 유료 AI API는 호출하지 않는다. 최종 의미 판정은 AI가 별도 수행한다.

공유 JSON 예시는 **simulation / NOT_RUN / INCONCLUSIVE** 형식 예시다. 실행 로그와 화면 원본은 패키지에서 제외했다. `runs/`에 새 결과를 로컬 생성하고 커밋하지 않는다. 실제 사이트는 사용자에게 허가받은 URL과 행동만 테스트한다.

runner는 단일 Chromium page와 새 비인증 컨텍스트를 지원한다. 인증/iframe/popup/대비 계산은 별도 연결이 필요하다. 제품 staged/3 계약과는 별도 schema이며 통합 adapter가 필요하다. [구조 및 통합 한계](evidence-guided-bug-verification/references/architecture.md)를 참고한다.
