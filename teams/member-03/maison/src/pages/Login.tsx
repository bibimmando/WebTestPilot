import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, AlertCircle } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLogin, useMe } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";
import { useTitle } from "@/hooks/useTitle";
import { useLoginReturnBug } from "@/bugs/routing/useRoutingBugs";

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "이메일 또는 비밀번호가 올바르지 않습니다.";
    if (error.code === "missing_fields") return "이메일과 비밀번호를 모두 입력해 주세요.";
    if (error.status === 0) return "서버에 연결할 수 없습니다.";
    return `로그인하지 못했습니다 (${error.status}).`;
  }
  return "로그인하지 못했습니다.";
}

const Login = () => {
  useTitle("로그인");
  const navigate = useNavigate();
  const location = useLocation();
  const { isLoggedIn } = useMe();
  const login = useLogin();

  const [form, setForm] = useState({ email: "", password: "" });

  const sendHomeAfterLogin = useLoginReturnBug(); // N4
  const requested = (location.state as { from?: string } | null)?.from ?? "/orders";
  // N4: 돌아갈 곳을 무시하고 홈으로 보낸다.
  const from = sendHomeAfterLogin ? "/" : requested;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (login.isPending) return; // 중복 제출 방어
    login.mutate(form, { onSuccess: () => navigate(from, { replace: true }) });
  };

  if (isLoggedIn) {
    return (
      <Layout>
        <div className="container-narrow py-28 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="font-serif text-4xl mb-4">Already Signed In</h1>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              이미 로그인되어 있습니다.
            </p>
            <Button
              asChild
              size="lg"
              className="rounded-none px-10 py-6 text-sm tracking-[0.15em] uppercase btn-premium"
            >
              <Link to="/orders">
                View Orders
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
          <Link to="/products" className="hover:text-foreground transition-colors">
            Shop
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground">Sign In</span>
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
                Welcome Back
              </p>
              <h1 className="font-serif text-4xl md:text-5xl mb-4">Sign In</h1>
              <p className="text-muted-foreground">
                주문 내역을 확인하려면 로그인해 주세요.
              </p>
            </motion.div>

            <motion.form
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              onSubmit={handleSubmit}
              className="space-y-6"
            >
              {login.isError && (
                <div
                  role="alert"
                  className="flex items-start gap-3 p-4 border border-destructive/30 bg-destructive/5"
                >
                  <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-px" />
                  <p className="text-sm text-foreground">
                    {describe(login.error)}
                  </p>
                </div>
              )}

              <div>
                <label
                  htmlFor="email"
                  className="block text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-2"
                >
                  Email *
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={handleChange}
                  required
                  className="rounded-none h-12"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-2"
                >
                  Password *
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={form.password}
                  onChange={handleChange}
                  required
                  className="rounded-none h-12"
                />
                <div className="mt-2 text-right">
                  <Link
                    to="/forgot-password"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
                  >
                    비밀번호를 잊으셨나요?
                  </Link>
                </div>
              </div>

              <Button
                type="submit"
                size="lg"
                disabled={login.isPending}
                className="w-full rounded-none py-6 text-sm tracking-[0.15em] uppercase btn-premium"
              >
                {login.isPending ? (
                  "Signing In..."
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="ml-3 w-4 h-4" />
                  </>
                )}
              </Button>
            </motion.form>

            <div className="mt-10 pt-8 border-t border-border text-center">
              <p className="text-sm text-muted-foreground">
                계정이 없으신가요?{" "}
                <Link
                  to="/signup"
                  className="text-foreground hover:text-primary transition-colors underline underline-offset-4"
                >
                  Create Account
                </Link>
              </p>
            </div>

            {/* 데모 사이트의 공개 계정. 팀원과 크롤러가 쓰는 고정 자격증명이다. */}
            <div className="mt-8 p-6 bg-linen">
              <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground/60 mb-3">
                Demo Account
              </p>
              <dl className="text-sm space-y-1">
                <div className="flex gap-3">
                  <dt className="text-muted-foreground w-20">Email</dt>
                  <dd className="text-foreground">demo@maison.com</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="text-muted-foreground w-20">Password</dt>
                  <dd className="text-foreground">demo1234</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
};

export default Login;
