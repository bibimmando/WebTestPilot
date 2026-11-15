# 팀 개발 규칙

## 작업 흐름

1. `development`의 최신 코드를 받는다.
2. [qa README](qa/README.md)와 [HANDOFF](docs/HANDOFF.md)를 읽고 `qa/`에서 개발한다. 영향을 받는 동작을 확인한다.
3. `development`에 직접 push한다. 분리할 작업은 기능 브랜치와 development 대상 PR을 사용한다.
4. 데모·배포 가능한 변경은 `development` → `main` PR로 올린다.
5. `main`의 최종 병합은 `bibimmando`가 검증 후 수행한다.

```powershell
git switch development
git pull --ff-only origin development
# 개발 후
git add <변경한-파일>
git commit -m "feat: 작업 설명"
git push origin development
```

이 문서는 이전 대화에서 합의한 방식이다. 이번 폴더 정리에서 실제 GitHub 보호 규칙을 변경한 것은 아니다.

## 코드 기준

- 제품 소스 기준: `qa/` 하나(TypeScript, Node 24가 바로 실행).
- 실행 진입점: `qa/src/cli.ts`. 단계별 모듈은 `qa/src/`(사이트 지도 `sitemap.ts`, 구조 `structure.ts`·`structure-ai.ts`, 탐색 `explore.ts`, 실행 `run.ts`, 판정 `triage.ts`, 보고서 `report.ts`).
- 프롬프트: `qa/prompts/`. 테스트: `qa/test/`(무료, 로컬 fixture 서버와 가짜 모델).
- 설계와 계약: [v2 설계](docs/design/V2_ARCHITECTURE.md). 최근 변경과 남은 일: [HANDOFF](docs/HANDOFF.md).
- `teams/`는 담당 안내이고, `archives/`는 이전 프로토타입 보관용이다. 새 개발을 그쪽 사본에 이어붙이지 않는다.

## 검증과 결과

공통 동작을 바꾸면 `qa/`에서 `npx tsc --noEmit -p .`와 `npm test`를 돌린다(CI도 같은 검사를 한다). 유료 API 실행은 비용을 먼저 확인하고, 결과 폴더(`qa/runs/`)는 커밋하지 않는다. 버그 후보·실행·재현·확정은 분리해 기록한다.

API 키·비밀번호·인증 상태·원본 페이지·브라우저 기록·실행 결과는 커밋하지 않는다. `qa/runs/`와 `.tools/`는 로컬 전용이다. PDF 공유본은 `docs/exports/`, 논문 자료는 `docs/research/`에 둔다.
