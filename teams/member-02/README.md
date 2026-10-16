# 팀원 2 작업 공간

2026-10-16: AI 판정 모듈과 통합 실행 사본을 member-02 안에서 독립 실행할 수 있도록 정리했습니다. member-01 파일 변경 없이 실행합니다. 외부 계약은 judge_input/2를 유지합니다.

- 이름 / GitHub 아이디: logoo82
- 담당 모듈: AI 검사기 및 리포트 구현
- 작업 브랜치: `development` (기능 브랜치 `feature/member-02/<작업명>`는 선택)
- 개발 변경은 `development`에 승인 없이 직접 push할 수 있다.
- `main` 반영은 `development` → `main` PR의 승인·CI 통과 후 총괄 담당자가 병합한다.

현재 단계: 계획 → 실제 Playwright MCP 실행 → 증거 → 독립 AI 판정 → 추가 재현 → JSON 보고서까지 연결했습니다. Maison 17종 중 6종을 재현 확인했습니다. 사용자용 최종 리포트·로그인/암호 입력·UI 전용 확장·비용 최적화는 후속 작업입니다.

- [프로젝트 설명](ai-inspector/README.md)
- [설치·동일 조건 실행·오프라인 검증](ai-inspector/REPRODUCE.md)
- [6종 대표 증거와 실험 비용·한계](ai-inspector/reports/maison_2026-10-16/README.md)
- [AI 검사기 사용법](ai-inspector/docs/ai_inspection/AI_README.md)
