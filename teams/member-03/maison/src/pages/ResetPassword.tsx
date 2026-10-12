import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, AlertCircle } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useResetPassword, useResetToken } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";
import { useTitle } from "@/hooks/useTitle";
import { useResetValidationBug } from "@/bugs/validation/useValidationBugs";

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "invalid_token":
        return "링크가 만료되었거나 이미 사용되었습니다.";
      case "weak_password":
        return "비밀번호는 8자 이상이어야 합니다.";
      case "missing_fields":
        return "필수 항목을 입력해 주세요.";
    }
    if (error.status === 0) return "서버에 연결할 수 없습니다.";
    return `변경하지 못했습니다 (${error.status}).`;
  }
  return "변경하지 못했습니다.";
}

const ResetPassword = () => {
  useTitle("새 비밀번호 설정");
  const acceptMismatch = useResetValidationBug();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const check = useResetToken(token);
  const reset = useResetPassword();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reset.isPending) return; // 중복 제출 방어
    if (!acceptMismatch && password !== confirm) {
      setLocalError("두 비밀번호가 서로 다릅니다.");
      return;
    }
    setLocalError("");
    reset.mutate(
      { token: token!, password },
      { onSuccess: () => navigate("/account", { replace: true }) },
    );
  };

  // 토큰이 아예 없거나, 서버가 무효라고 한 경우
  if (!token || check.isError) {
    return (
      <Layout>
        <div className="container-narrow py-28 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="font-serif text-4xl mb-4">Link Expired</h1>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto leading-[1.8]">
              링크가 만료되었거나 이미 사용되었습니다. 재설정을 다시 요청해
              주세요.
            </p>
            <Button
              asChild
              size="lg"
              className="rounded-none px-10 py-6 text-sm tracking-[0.15em] uppercase btn-premium"
            >
              <Link to="/forgot-password">
                Request New Link
                <ArrowRight className="ml-3 w-4 h-4" />
              </Link>
            </Button>
          </motion.div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="container-full py-6 border-b border-border">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link to="/login" className="hover:text-foreground transition-colors">
            Sign In
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground">New Password</span>
        </div>
      </div>

      <section className="py-14 md:py-20">
        <div className="container-narrow">
          <div className="max-w-md mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-center mb-12"
            >
              <p className="text-[11px] font-semibold tracking-[0.3em] uppercase text-primary mb-4">
                Account
              </p>
              <h1 className="font-serif text-4xl md:text-5xl mb-4">
                New Password
              </h1>
              {check.isPending ? (
                <Skeleton className="h-5 w-56 mx-auto rounded-none" />
              ) : (
                <p className="text-muted-foreground">
                  {check.data?.email} 의 새 비밀번호를 정해 주세요.
                </p>
              )}
            </motion.div>

            <motion.form
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              onSubmit={handleSubmit}
              className="space-y-6"
            >
              {(reset.isError || localError) && (
                <div
                  role="alert"
                  className="flex items-start gap-3 p-4 border border-destructive/30 bg-destructive/5"
                >
                  <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-px" />
                  <p className="text-sm text-foreground">
                    {localError || describe(reset.error)}
                  </p>
                </div>
              )}

              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-2"
                >
                  New Password *
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="rounded-none h-12"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  8자 이상 입력해 주세요.
                </p>
              </div>

              <div>
                <label
                  htmlFor="confirm"
                  className="block text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-2"
                >
                  Confirm Password *
                </label>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className="rounded-none h-12"
                />
              </div>

              <Button
                type="submit"
                size="lg"
                disabled={reset.isPending || check.isPending}
                className="w-full rounded-none py-6 text-sm tracking-[0.15em] uppercase btn-premium"
              >
                {reset.isPending ? (
                  "Saving..."
                ) : (
                  <>
                    Set Password
                    <ArrowRight className="ml-3 w-4 h-4" />
                  </>
                )}
              </Button>

              <p className="text-xs text-muted-foreground leading-[1.8] pt-2">
                비밀번호를 바꾸면 다른 기기의 로그인은 모두 해제됩니다.
              </p>
            </motion.form>
          </div>
        </div>
      </section>
    </Layout>
  );
};

export default ResetPassword;
