---
name: codex
description: Codex CLI에게 코드 리뷰, 설계 두 번째 의견, 조사 작업을 맡기고 결과를 받아온다. 사용자가 "Codex한테 물어봐/리뷰시켜/확인시켜" 같이 Codex를 언급하거나, 공통 엔진 변경을 마무리하기 전에 다른 모델의 검토가 필요할 때 사용한다.
---

# Codex CLI 호출

Codex CLI(`codex`)는 이 PC에 설치되어 있고 이 저장소를 신뢰 프로젝트로 등록해 두었다. Codex도 `AGENTS.md`를 읽으므로 프로젝트 규칙을 프롬프트에 다시 쓸 필요는 없다.

## 1. 변경 사항 리뷰

커밋하지 않은 변경 전체를 리뷰:

```bash
codex review --uncommitted "AGENTS.md의 일반화 원칙(사이트별 분기 금지, 판정·증거 분리)을 기준으로 리뷰해줘"
```

브랜치 단위 리뷰:

```bash
codex review --base development
```

## 2. 질문·조사 (읽기 전용)

```bash
codex exec -s read-only -C "<저장소 경로>" -o "<scratchpad>/codex-answer.md" "질문 내용"
```

- `-s read-only`: Codex는 파일을 읽기만 한다. 기본값으로 항상 붙인다.
- `-o`: Codex의 최종 답변만 파일로 받는다. 출력이 길 수 있으므로 이 파일을 읽어 요약한다.
- 프롬프트에는 대상 파일 경로, 확인할 질문, 원하는 답변 형식을 구체적으로 적는다.

## 3. Codex에게 수정을 맡길 때

`-s workspace-write`는 Codex가 저장소 파일을 직접 고친다. **사용자가 명시적으로 승인했을 때만** 사용하고, 그 전에 Claude 쪽 변경을 커밋하거나 `git worktree`로 별도 폴더를 만들어 충돌을 막는다. `--dangerously-bypass-approvals-and-sandbox`는 사용하지 않는다.

## 결과 처리

- Codex 답변은 제안일 뿐이다. 지적 사항은 실제 코드로 확인한 뒤 사용자에게 "Codex 의견"과 "Claude 확인 결과"를 구분해 전달한다.
- 실행이 2분 이상 걸릴 수 있으므로 백그라운드로 실행한다.
- 작업을 넘기거나 받은 경우 `docs/HANDOFF.md`에 기록한다.
