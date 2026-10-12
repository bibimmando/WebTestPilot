import { useEffect } from "react";

const SITE = "Maison";

/**
 * 페이지마다 문서 제목을 설정한다.
 *
 * SPA 는 HTML 을 한 번만 받기 때문에 index.html 의 <title> 이 모든 화면에
 * 그대로 남는다. 그러면 크롤링 리포트에서 어느 화면인지 구분할 수 없다.
 */
export function useTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} — ${SITE}` : SITE;
  }, [title]);
}
