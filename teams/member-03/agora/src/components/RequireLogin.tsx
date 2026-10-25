import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation, useNavigationType } from "react-router-dom";
import { useT } from "@/i18n";
import { setStaleOnUnauthorized } from "@/lib/api";
import { useBug } from "@/lib/bugs";
import { useSession } from "@/lib/session";

/** 이 페이지를 띄운 뒤 로그인한 적이 있는지 (결함 N2 가 새로고침과 뒤로 가기를 가른다) */
let signedInThisPage = false;

/** 로그인해야 볼 수 있는 화면. 로그인하지 않았으면 로그인 화면으로 보냈다가 돌아온다. */
export function RequireLogin({ children }: { children: ReactNode }) {
  const t = useT();
  const { user, loading } = useSession();
  const location = useLocation();
  const navigationType = useNavigationType();
  // 결함 N2: 뒤로 · 앞으로 가기(POP)로 돌아온 화면은 로그인 확인을 건너뛰고,
  // 화면은 '로그인이 필요해요' 를 받으면 마지막으로 받은 응답을 대신 쓴다.
  const bugN2 = useBug("N2");
  useEffect(() => setStaleOnUnauthorized(bugN2), [bugN2]);
  if (user) signedInThisPage = true;

  if (loading) return <p className="py-10 text-center text-sm text-muted">{t("불러오는 중…")}</p>;
  const skipCheck = bugN2 && navigationType === "POP" && signedInThisPage;
  if (!user && !skipCheck) return <Navigate replace to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} />;
  return <>{children}</>;
}
