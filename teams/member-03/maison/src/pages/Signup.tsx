import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, AlertCircle } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMe, useSignup } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";
import { useTitle } from "@/hooks/useTitle";

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "email_taken":
        return "이미 가입된 이메일입니다.";
      case "invalid_email":
        return "이메일 형식이 올바르지 않습니다.";
      case "weak_password":
        return "비밀번호는 8자 이상이어야 합니다.";
      case "missing_fields":
        return "필수 항목을 모두 입력해 주세요.";
    }
    if (error.status === 0) return "서버에 연결할 수 없습니다.";
    return `가입하지 못했습니다 (${error.status}).`;
  }
  return "가입하지 못했습니다.";
}

const Signup = () => {
  useTitle("회원가입");
  const navigate = useNavigate();
  const { isLoggedIn } = useMe();
  const signup = useSignup();

  const [form, setForm] = useState({ name: "", email: "", password: "" });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (signup.isPending) return; // 중복 제출 방어
    signup.mutate(form, {
      onSuccess: () => navigate("/orders", { replace: true }),
    });
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
          <span className="text-foreground">Create Account</span>
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
                Join Maison
              </p>
              <h1 className="font-serif text-4xl md:text-5xl mb-4">
                Create Account
              </h1>
              <p className="text-muted-foreground">
                주문 내역을 한곳에서 관리하실 수 있습니다.
              </p>
            </motion.div>

            <motion.form
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              onSubmit={handleSubmit}
              className="space-y-6"
            >
              {signup.isError && (
                <div
                  role="alert"
                  className="flex items-start gap-3 p-4 border border-destructive/30 bg-destructive/5"
                >
                  <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-px" />
                  <p className="text-sm text-foreground">
                    {describe(signup.error)}
                  </p>
                </div>
              )}

              <div>
                <label
                  htmlFor="name"
                  className="block text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-2"
                >
                  Name *
                </label>
                <Input
                  id="name"
                  name="name"
                  autoComplete="name"
                  value={form.name}
                  onChange={handleChange}
                  required
                  className="rounded-none h-12"
                />
              </div>

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
                  autoComplete="new-password"
                  value={form.password}
                  onChange={handleChange}
                  required
                  minLength={8}
                  className="rounded-none h-12"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  8자 이상 입력해 주세요.
                </p>
              </div>

              <Button
                type="submit"
                size="lg"
                disabled={signup.isPending}
                className="w-full rounded-none py-6 text-sm tracking-[0.15em] uppercase btn-premium"
              >
                {signup.isPending ? (
                  "Creating Account..."
                ) : (
                  <>
                    Create Account
                    <ArrowRight className="ml-3 w-4 h-4" />
                  </>
                )}
              </Button>
            </motion.form>

            <div className="mt-10 pt-8 border-t border-border text-center">
              <p className="text-sm text-muted-foreground">
                이미 계정이 있으신가요?{" "}
                <Link
                  to="/login"
                  className="text-foreground hover:text-primary transition-colors underline underline-offset-4"
                >
                  Sign In
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
};

export default Signup;
