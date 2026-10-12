import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, AlertCircle, Mail } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useForgotPassword } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";
import { useTitle } from "@/hooks/useTitle";

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "invalid_email") return "이메일 형식을 확인해 주세요.";
    if (error.status === 0) return "서버에 연결할 수 없습니다.";
    return `요청하지 못했습니다 (${error.status}).`;
  }
  return "요청하지 못했습니다.";
}

const ForgotPassword = () => {
  useTitle("비밀번호 찾기");
  const [email, setEmail] = useState("");
  const forgot = useForgotPassword();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (forgot.isPending) return; // 중복 제출 방어
    forgot.mutate({ email });
  };

  const sent = forgot.isSuccess;

  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="container-full py-6 border-b border-border">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link to="/login" className="hover:text-foreground transition-colors">
            Sign In
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground">Reset Password</span>
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
                Reset Password
              </h1>
              <p className="text-muted-foreground leading-[1.8]">
                가입하신 이메일 주소를 알려 주시면 재설정 링크를 보내 드립니다.
              </p>
            </motion.div>

            {sent ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <div className="flex items-start gap-4 p-6 bg-linen">
                  <Mail className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-serif text-lg mb-2">확인해 주세요</p>
                    <p className="text-sm text-muted-foreground leading-[1.8]">
                      등록된 주소라면 재설정 링크를 보내 드렸습니다. 메일이 오지
                      않으면 주소를 다시 확인해 주세요.
                    </p>
                  </div>
                </div>

                {/* 이 데모에는 메일 발송이 없다. 링크를 받을 다른 길이
                    없으므로 화면에 바로 보여 준다. 실제 서비스라면
                    메일로만 보내야 한다. */}
                {forgot.data?.resetUrl && (
                  <div className="mt-6 p-6 border border-dashed border-border">
                    <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground/60 mb-3">
                      Demo Site
                    </p>
                    <p className="text-sm text-muted-foreground mb-4 leading-[1.8]">
                      이 사이트는 메일을 보내지 않습니다. 아래 링크로 바로
                      이동해 주세요. 30분 뒤 만료됩니다.
                    </p>
                    <Button
                      asChild
                      variant="outline"
                      className="w-full rounded-none py-5 text-sm tracking-[0.1em] uppercase"
                    >
                      <Link to={forgot.data.resetUrl}>
                        Set New Password
                        <ArrowRight className="ml-3 w-4 h-4" />
                      </Link>
                    </Button>
                  </div>
                )}

                <div className="mt-10 pt-8 border-t border-border text-center">
                  <Link
                    to="/login"
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
                  >
                    Back to Sign In
                  </Link>
                </div>
              </motion.div>
            ) : (
              <motion.form
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
                onSubmit={handleSubmit}
                className="space-y-6"
              >
                {forgot.isError && (
                  <div
                    role="alert"
                    className="flex items-start gap-3 p-4 border border-destructive/30 bg-destructive/5"
                  >
                    <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-px" />
                    <p className="text-sm text-foreground">
                      {describe(forgot.error)}
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
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="rounded-none h-12"
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  disabled={forgot.isPending}
                  className="w-full rounded-none py-6 text-sm tracking-[0.15em] uppercase btn-premium"
                >
                  {forgot.isPending ? (
                    "Sending..."
                  ) : (
                    <>
                      Send Reset Link
                      <ArrowRight className="ml-3 w-4 h-4" />
                    </>
                  )}
                </Button>

                <div className="pt-6 border-t border-border text-center">
                  <Link
                    to="/login"
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
                  >
                    Back to Sign In
                  </Link>
                </div>
              </motion.form>
            )}
          </div>
        </div>
      </section>
    </Layout>
  );
};

export default ForgotPassword;
