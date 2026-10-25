import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { AuthPanel } from "@/components/AuthPanel";
import { safeNext } from "@/lib/format";
import { useSession } from "@/lib/session";

/**
 * /login · /signup 주소로 직접 들어왔을 때 보이는 페이지.
 * 평소에는 헤더 버튼이 모달을 띄우고, 로그인이 필요한 화면으로 바로 들어온 경우
 * (/login?next=/submit 같은)에만 이 페이지를 쓴다. 내용은 모달과 같다.
 */
export function AuthPage({ view }: { view: "login" | "signup" }) {
  const { user, setUser } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  // 여기서 막 가입했으면 로그인 상태여도 가입 뒤 단계(성별 · 관심 항목)를 마칠 때까지 머문다.
  const [signedUpHere, setSignedUpHere] = useState(false);

  if (user && !signedUpHere) return <Navigate replace to={next} />;

  return (
    <div className="mx-auto mt-4 max-w-[28rem]">
      <div className="card relative rounded-3xl px-6 pb-8 pt-12 sm:px-10">
        <AuthPanel
          key={view}
          initialView={view}
          onSignedUp={() => setSignedUpHere(true)}
          onSuccess={(u) => {
            setUser(u);
            navigate(next, { replace: true });
          }}
        />
      </div>
    </div>
  );
}
