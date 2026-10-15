@AGENTS.md

# Claude Code 전용 메모

프로젝트 공통 지침은 위의 `AGENTS.md`가 기준이다. Codex CLI도 같은 파일을 읽으므로 규칙 변경은 `AGENTS.md`에만 한다.

## Codex CLI와의 협업

- 이 저장소는 Codex CLI와 함께 작업한다. Codex의 프로젝트 에이전트·프롬프트는 `.codex/`에 있다.
- 같은 작업 폴더에서 두 에이전트가 동시에 파일을 고치지 않는다. 동시에 작업할 때는 `git worktree`로 폴더를 나누고, 번갈아 작업할 때는 넘기기 전에 커밋한다.
- 인수인계 내용(어디까지 했는지, 다음 할 일, 미검증 사항)은 `docs/HANDOFF.md`에 남긴다.
- Codex에게 리뷰나 두 번째 의견을 받을 때는 `codex` 스킬(`.claude/skills/codex/SKILL.md`)을 따른다. 기본은 read-only 샌드박스이며, Codex가 파일을 쓰게 하려면 사용자 승인을 먼저 받는다.
