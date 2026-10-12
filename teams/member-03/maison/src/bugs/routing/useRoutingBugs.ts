import { useBug } from "@/hooks/useBugs";

/**
 * 이동·라우팅 버그를 화면에서 읽는 어댑터.
 *
 * 각 화면이 useBug("N1") 을 직접 부르지 않고 여기를 거친다. 그래야
 * 토글 ID 가 한곳에 모이고, 공용 컴포넌트에 분야별 import 가 늘어나지
 * 않는다. 입력 검증 쪽(src/bugs/validation/)과 같은 방식이다.
 */

/** N1: 연관 상품 카드가 옆 상품으로 이동한다. */
export function useRelatedLinkBug(): boolean {
  return useBug("N1");
}

/** N3: 화면을 옮겨도 스크롤 위치를 맨 위로 되돌리지 않는다. */
export function useScrollRestoreBug(): boolean {
  return useBug("N3");
}

/** N4: 로그인 뒤 원래 가려던 곳 대신 홈으로 보낸다. */
export function useLoginReturnBug(): boolean {
  return useBug("N4");
}
