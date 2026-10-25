import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AuthPanel } from "@/components/AuthPanel";
import { Modal } from "@/components/Modal";
import { useSession } from "./session";

/**
 * 로그인·가입 모달. 어디서든 open("login") 을 부르면 지금 화면 위에 뜨고,
 * 로그인하면 닫히면서 보던 화면에 그대로 남는다.
 */

type AuthView = "login" | "signup";

interface AuthModalValue {
  open: (view?: AuthView) => void;
  close: () => void;
}

const AuthModalContext = createContext<AuthModalValue | null>(null);

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const { setUser } = useSession();
  const [view, setView] = useState<AuthView | null>(null);

  const close = useCallback(() => setView(null), []);
  const open = useCallback((next: AuthView = "login") => setView(next), []);
  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <AuthModalContext.Provider value={value}>
      {children}
      <Modal open={view !== null} onClose={close} labelledBy="auth-title">
        {view && (
          <AuthPanel
            key={view}
            initialView={view}
            onSuccess={(user) => {
              setUser(user);
              close();
            }}
          />
        )}
      </Modal>
    </AuthModalContext.Provider>
  );
}

export function useAuthModal(): AuthModalValue {
  const value = useContext(AuthModalContext);
  if (!value) throw new Error("AuthModalProvider 안에서만 쓸 수 있어요.");
  return value;
}
