// report.json 최소 계약 (초안 report/0). 실행 결과를 페이지 × 문제 단위로 묶은 사실 원본이며, PDF·웹 화면은 이 파일만 읽는다.
// 설계: docs/design/V2_ARCHITECTURE.md 5장 8단계·7장, 방향성 문서 9장. M3까지 필드를 고정하고, 결과를 모으는 코드는 M6에서 만든다.
// 바꿀 때는 version을 올리고 PDF·웹 화면 담당과 맞춘다.

export type Report = {
  version: 'report/0';
  run: {
    startUrl: string;
    origins: string[];
    allowWrites: boolean;
    startedAt: string;
    endedAt: string;
    /** 완료 · 한도 도달(종류) · 사용자 중지 */
    endReason: 'completed' | 'limit' | 'stopped';
    limitKind?: 'cost' | 'time' | 'calls' | 'actions';
    models: { plan: string; triage: string };
    /** 토큰 사용량 기준 추정이며 청구서가 아니다 */
    spentUsd: number;
    durationMs: number;
  };
  /** 실행 범위: 방문한 것과 못 한 것을 함께 남긴다. "사이트 전체"라고 쓰지 않는다 */
  coverage: {
    pages: { url: string; template?: string; aiReviewed: boolean; skipReason?: string }[];
    unvisitedLinks: string[];
    requirements: { id: string; text: string; plan: 'planned' | 'unplanned' | 'missing'; reason?: string }[];
    /** 검사 하나하나가 어느 페이지·화면 조건·요구사항에서 어떻게 끝났는지. PDF가 실제 검사·미완료 범위를 설명하는 근거 */
    checks: { id: string; page: string; viewport?: Viewport; requirements: string[]; status: string; class: string }[];
  };
  /** 페이지 × 문제 단위 항목. 같은 페이지·조건의 반복 발견과 재현은 한 항목의 관측 회차로 합친다 */
  items: ReportItem[];
  /** 실제로 완료한 검사 수. 사이트 정상 보장이 아니다. 관찰값·추정 근거의 통과는 따로 센다 */
  passed: { checks: number; inferredChecks: number; observedChecks: number };
  /** 행동 실행 결과 집계 */
  actions: { planned: number; attempted: number; completed: number; uncertain: number; notExecutedByReason: Record<string, number> };
};

export type Viewport = 'desktop' | 'mobile';

export type ReportItem = {
  id: string;
  page: string;
  section: 'confirmed_evidence' | 'needs_review' | 'automation_or_incomplete' | 'error_signal';
  title: string;
  /** 사실 원본. 보고서 AI는 이 값을 바꾸지 않는다 */
  expected?: string;
  expectationBasis?: { kind: 'requirement' | 'constraint' | 'observed' | 'inferred'; requirementId?: string; quote?: string };
  steps: string[];
  startCondition: string;
  /** 관측 회차: 최초 발견과 추가 재현, 화면 조건별 발생을 구분한다 (방향성 9장·Q62) */
  observations: {
    round: 'first' | 'reproduction';
    viewport: Viewport;
    /** 원래 비교·실행 결과 (분류로 덮지 않는다) */
    result: string;
    actual?: string;
    runDir: string;
    /** 실행 폴더 기준 상대 경로 */
    evidence: { kind: 'screenshot' | 'aria' | 'trace' | 'log'; path: string; capturedAt?: string }[];
  }[];
  classification?: { class: string; reason?: string; error?: string; log?: string };
  reproduction?: { result: string; reason?: string };
  /** 근거가 된 plan·verdict 항목 ID */
  sources: string[];
};
