# member-01 — 통합 코드 작업 공간

담당자: **bibimmando**. 각 팀의 전처리·AI·MCP 코드를 받아 하나의 프로그램으로 통합합니다.

## 팀원이 먼저 읽을 파일

- [통합 소스·완료 범위·담당 모듈](integration/DEVELOPMENT.md).
- [설치·실행·출력 안내](integration/README.md).
- **AI팀: [판단용 JSON 형식](integration/docs/JUDGMENT_CONTRACT.md)**.
- [입력 예시](integration/examples/judge_input.v2.example.json) · [응답 예시](integration/examples/scenario_judgments.example.json).
- [입력 Schema](integration/schemas/judge_input.v2.schema.json) · [응답 Schema](integration/schemas/scenario_judgments.schema.json).
- [실제 검사 결과·알려진 문제](../../docs/reviews/QA_SKILL_MAISON_TEST_2026-10-12.md).

## 구조와 실행 위치

```text
teams/member-01/
  integration/         # 전처리·계획·실행 AI·MCP·후처리·판단·재현
    preprocessor/
    docs/              # 전처리·실행·판단 계약
    schemas/
    examples/
  skills/              # QA 계획 스킬과 references
  .env.example         # 빈 키 설정 예시
  .env                 # 로컬 키, Git 제외
  .tools/              # MCP 설치 등, Git 제외
  output/              # 실행 결과, Git 제외
```

저장소 루트에서 `cd teams/member-01` 후 통합 README의 설치 명령을 실행합니다.

```powershell
python -m integration --url http://localhost:8080/ --provider mock --max-pages 3
```

`mock`은 실제 API 판정을 하지 않습니다. 기존 `page-preprocessor/`는 이전 프로토타입 참고용입니다. 최신 제품 변경은 이 폴더의 `integration/`에 반영하고 `development`에 push합니다.
