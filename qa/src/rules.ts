// 일반 웹 규칙 목록 (설계 3.3, 5장 6단계). 요구사항이 없을 때 `inferred` 근거는 이 목록의 규칙 ID를 인용한다.
import type { Op } from './plan.ts';
// 공통 엔진의 데이터이며 사이트별 규칙을 넣지 않는다. 앱 고유 규칙은 업무 규칙 질문의 답으로 앱 설정에 둔다.
// group 1 = 거의 예외 없음, 2 = 대부분 맞지만 앱마다 다름. 3(품질·사용성)은 아직 없다.
// shortcut: 3묶음(품질·사용성)과 적용 조건의 자동 확인은 없다. 비교 형태(form)만 검증하고, 결정적 관계 규칙만 확신 높음, 나머지는 최대 확신 중간(Q22 제한 승인).
// shortcut: form 'any' 규칙(no-error-page, invalid-input-feedback, required-input)은 고정 기대값을 허용해 관찰값 고정 우회가 남는다(판정은 최대 확신 중간).
// shortcut: page-changes의 not_equals는 같은 항목의 순서만 바뀌어도 통과한다. 항목 집합 비교 연산이 필요해지면 추가한다.
// 권한 기대는 일반 규칙으로 추정하지 않는다. 화면 안내(constraint)·요구사항·업무 규칙 질문으로만 표현한다.

/**
 * form: 하네스가 검증하는 비교 형태. relation = 관측 참조(expected_from) 필수, bound = less·greater만, items = 목록 조건만, any = 제한 없음.
 * 관찰한 결함 값을 규칙 ID만 붙여 정답으로 고정하는 것을 막는다. offset = 관측 참조에 증감 단위(+1 등)가 필요함.
 */
/** deterministic: 화면에서 읽은 두 값을 하네스가 직접 비교해 판정이 정해지는 규칙. 위반이면 확신 높음까지 허용한다(Q22 제한 승인 2026-10-16). */
/** ops: 이 규칙에 쓸 수 있는 비교 연산(없으면 형태 검사만). */
export type Rule = { id: string; group: 1 | 2; rule: string; applies: string; exceptions?: string; form: 'relation' | 'bound' | 'items' | 'any'; offset?: true; deterministic?: true;
  ops?: Op[] };

export const RULES: Rule[] = [
  { id: 'link-target', group: 1, rule: '링크·카드에 적힌 대상과 눌렀을 때 열린 대상이 같다',
    applies: '링크·카드의 텍스트가 대상의 이름을 나타낼 때 (클릭 전 이름을 읽어 expected_from으로 비교)', form: 'relation', ops: ['equals'], deterministic: true },
  { id: 'no-error-page', group: 1, rule: '이동·행동의 결과가 서버 오류(5xx)나 같은 origin의 없는 페이지(404)가 아니다',
    applies: '허용 범위 안의 링크·버튼', exceptions: '401·403 권한 거절, 422 검증 응답', form: 'any' },
  { id: 'action-has-effect', group: 1, rule: '활성 상태의 행동 버튼을 누르면 화면·URL·요청 중 하나가 바뀐다',
    applies: '눌러서 무언가를 하라는 이름·아이콘의 활성 버튼 (누르기 전 값과 not_equals로 비교)', exceptions: '이미 선택된 탭, 같은 값 다시 저장', form: 'relation', ops: ['not_equals'] },
  { id: 'disabled-inert', group: 1, rule: '비활성 컨트롤은 눌러도 동작하지 않는다', applies: 'disabled 상태로 표시된 컨트롤 (누르기 전 값과 equals로 비교)', form: 'relation', ops: ['equals'] },
  { id: 'count-matches-list', group: 1, rule: '화면의 개수 문구와 실제로 보이는 항목 수가 같다',
    applies: '문구가 지금 보이는 목록의 개수를 나타낼 때 (op same_number로 숫자끼리 비교)', exceptions: '문구가 전체 개수이고 목록은 일부 페이지만 보일 때', form: 'relation', ops: ['same_number', 'equals'], deterministic: true },
  { id: 'filter-matches', group: 2, rule: '필터·카테고리를 고르면 그 조건에 맞는 항목만 보인다', applies: '목록 필터·카테고리 선택',
    exceptions: '추천 항목을 섞어 보여 주는 화면', form: 'items', ops: ['all_equal', 'all_contain'] },
  { id: 'reset-restores', group: 2, rule: '초기화·전체 보기를 누르면 처음 상태로 돌아간다', applies: '필터·입력 초기화 컨트롤',
    exceptions: '정렬 등 일부 설정을 유지하도록 설계된 경우', form: 'relation', ops: ['equals', 'same_number'] },
  { id: 'quantity-bounds', group: 2, rule: '상품 수량처럼 0이 의미 없는 개수는 1보다 작아질 수 없다', applies: '최소값 1이 화면에 보이거나(감소 버튼 비활성 등) 0개가 의미 없는 개수 선택 (greater 0 또는 less로 비교). 0을 허용할 수 있는 인원·수치는 묻기', exceptions: '0을 삭제로 쓰는 장바구니', form: 'bound' },
  { id: 'step-by-one', group: 2, rule: '증가·감소 컨트롤은 값을 한 단위 바꾼다', applies: '수량·숫자 증감 버튼 (누르기 전 값을 expected_from으로, 누른 횟수만큼 offset)', form: 'relation', ops: ['equals', 'same_number'], offset: true },
  { id: 'invalid-input-feedback', group: 2, rule: '잘못된 입력은 받아들여지지 않고 안내가 나오며, 결과 값이 바뀌지 않는다',
    applies: '형식·값 검사가 있는 입력', exceptions: '서버에서만 검사하는 앱', form: 'any' },
  { id: 'same-action-same-result', group: 2, rule: '같은 상태에서 같은 동작을 하면 같은 결과가 나온다', applies: '결정적인 기능',
    exceptions: '추천·무작위 기능', form: 'relation', ops: ['equals'] },
  { id: 'sort-order', group: 2, rule: '정렬 기준을 고르면 목록이 그 기준의 순서로 놓인다', applies: '정렬 선택 후 정렬 기준 값이 든 항목들(group)을 items로 읽어 sorted_asc·sorted_desc로 비교 (expected는 정렬 기준: 숫자 기준이면 number, 글자 기준이면 text)',
    exceptions: '고정 공지처럼 정렬과 상관없이 위에 두는 항목', form: 'items', ops: ['sorted_asc', 'sorted_desc'] },
  { id: 'page-changes', group: 2, rule: '다음·이전 페이지로 넘기면 보이는 항목이 바뀐다', applies: '페이지 넘김 컨트롤 (넘기기 전 목록 항목들(group)을 items로 읽어 두고, 넘긴 뒤 items를 expected_from으로 not_equals 비교)',
    exceptions: '마지막 페이지에서 다음 누름', form: 'relation', ops: ['not_equals'] },
  { id: 'required-input', group: 2, rule: '필수 입력을 비우거나 형식에 맞지 않게 제출하면 제출되지 않고 안내가 나온다', applies: '필수 표시나 형식 안내가 있는 입력 폼',
    exceptions: '서버에서만 검사하는 앱', form: 'any', ops: ['contains', 'not_equals', 'equals'] },
  { id: 'state-persists', group: 2, rule: '새로고침하거나 뒤로 갔다 와도 사용자가 바꾼 상태가 유지된다', applies: '장바구니·선택 상태',
    exceptions: '의도적으로 세션 단위로 두는 상태', form: 'relation', ops: ['equals', 'same_number'] },
];

export const RULE_IDS = new Set(RULES.map(r => r.id));
export const ruleOf = (id?: string) => RULES.find(r => r.id === id);

/** 탐색 프롬프트에 넣을 규칙 목록. */
export const rulesText = (): string => RULES.map(r =>
  `- ${r.id} (${r.group === 1 ? '거의 예외 없음' : '앱마다 다를 수 있음'}): ${r.rule}. 적용: ${r.applies}${r.exceptions ? `. 예외: ${r.exceptions}` : ''}`).join('\n');
