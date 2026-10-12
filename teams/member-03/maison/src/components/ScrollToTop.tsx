import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useScrollRestoreBug } from "@/bugs/routing/useRoutingBugs";

export const ScrollToTop = () => {
  const { pathname } = useLocation();
  const keepScroll = useScrollRestoreBug(); // N3

  useEffect(() => {
    if (keepScroll) return; // N3: 이동해도 스크롤을 되돌리지 않는다
    window.scrollTo(0, 0);
  }, [pathname, keepScroll]);

  return null;
};
