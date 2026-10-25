import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * 다른 화면으로 옮기면 맨 위에서 시작한다.
 *   뒤로 · 앞으로 가기(POP)는 브라우저가 기억한 위치를 따르고,
 *   #comments 처럼 위치를 정해 들어오는 주소는 그 화면이 알아서 내린다.
 *   같은 화면에서 정렬·말머리(?sort= ?flair=)만 바꿀 때는 그대로 둔다.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType === "POP" || hash) return;
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  return null;
}
