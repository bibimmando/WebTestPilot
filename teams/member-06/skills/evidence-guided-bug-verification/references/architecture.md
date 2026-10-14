# 구조와 통합

이 폴더는 AI가 선택적으로 로드하는 지식과 Python 실행 모듈의 묶음이다.

```text
evidence-guided-bug-verification/
  SKILL.md
  requirements.txt
  references/{functional,input-validation,routing,ui-rendering,source-index,architecture}.md
  references/sources.json
  scripts/{reproduce,collect_evidence,playwright_helpers,validate,demo}.py
  schemas/{bug_candidate,verification_result}.schema.json
  examples/{bug_candidate,verification_example}.json
```

Agent는 제품 기대와 가설/계획을 구성한다. runner는 승인된 계획을 수행해 execution.json, 단계별 DOM 관찰, opt-in 화면 및 events.json을 남긴다. artifact의 SHA-256은 이후 변경 탐지용이며 관찰의 진실성을 보증하는 서명은 아니다. AI가 증거 ID와 출처 ID를 인용해 최종 결과를 별도 생성한다. validate.py는 형식과 판단 참조 ID를 검증하며 의미 판단을 하지 않는다.

## 현재 제품 통합 지점 (공유 시점 확인)

현재 제품 기준은 `teams/member-01/integration/`의 staged/3이다. `DEVELOPMENT.md`, `docs/EXECUTION_AGENT.md`, `docs/JUDGMENT_CONTRACT.md`를 따른다. 실행 AI가 MCP를 호출하고 후처리된 judge_input/2를 별도 판단 AI에 전달한다. 제품의 passed/candidate/inconclusive와 이 스킬의 CONFIRMED/NOT_A_BUG/INCONCLUSIVE는 일대일 대응하지 않는다. 이 스킬은 독립 자료/도구로 배포하며 제품 runtime이나 시스템 지시에 자동 등록하지 않았다. 연결하려면 동결된 expected/expected_source, 시나리오별 실제 snapshot/action ID 범위와 별도 재현 절차를 보존하는 adapter가 필요하다.

## 레거시 구현 참고 (현재 제품 기준 아님)

`WebTestPilot/webtestpilot-crawler/webtestpilot_crawler/engine_verify.py`에는 Candidate, Reproducer.replay, SemanticOracle.judge, VerificationPipeline이 있다. 기존 REQUIRED_ATTEMPTS=3 및 CONFIDENCE_CAP은 세 번 재현과 oracle 종류에 따라 report confidence를 부여한다. 이 스킬의 최종 판정과 의미가 다르다. 기존 코드를 수정하거나 자동으로 연결하지 않았다.

권장 adapter(미구현 제안): 기존 Candidate의 id/url/action_path/actual/expected/evidence_ids를 신규 candidate로 변환하되 action_path 문자열을 코드로 실행하지 않고 Agent가 명시 행동으로 재작성한다. 기존 expected의 근거는 제공되지 않으므로 기본 unknown으로 남긴다. 기존 Reproducer는 관찰 실행만 재사용할 수 있다. 신규 judgment를 별도 result sidecar로 보존하고 기존 pipeline의 3/3 gate를 거쳐 verdict가 바뀌지 않게 한다. 정책 변경을 적용하려면 담당자가 호출 지점과 보고서 소비자를 함께 수정해야 한다.

Crawler의 탐색/중복 제거/후보 발견은 이 스킬 범위 밖이다. 인증/비밀값 관리, Agent/LLM provider, 큐/동시성/예산과 최종 통합 리포트는 호스트 책임이다. 입력 계획은 민감한 테스트 값을 포함할 수 있어 일반 로그로 복제하지 않는다. 환경 고정에는 runner가 기록한 OS·Python·Playwright·browser·viewport·locale 외에 테스트 데이터 버전, 제품 버전, 외부 시스템 상태가 추가로 필요할 수 있다.

새 유형은 references와 source-index/sources.json에 추가하고 기존 네 범주 밖 bug_types도 허용한다. 새 행동은 스키마와 perform 함수를 함께 확장하고 정상·실패·권한 경계를 실제 fixture로 검증한다.
