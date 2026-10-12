import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, AlertCircle, Check, UserCog } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useChangePassword, useMe, useUpdateName } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useTitle } from "@/hooks/useTitle";

function describePassword(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "wrong_password":
        return "현재 비밀번호가 올바르지 않습니다.";
      case "weak_password":
        return "새 비밀번호는 8자 이상이어야 합니다.";
      case "same_password":
        return "현재 비밀번호와 다른 값을 입력해 주세요.";
      case "missing_fields":
        return "두 항목을 모두 입력해 주세요.";
    }
    if (error.status === 0) return "서버에 연결할 수 없습니다.";
    return `변경하지 못했습니다 (${error.status}).`;
  }
  return "변경하지 못했습니다.";
}

const Account = () => {
  useTitle("계정 설정");
  const { user, isLoggedIn, isPending: authPending } = useMe();
  const { toast } = useToast();

  const updateName = useUpdateName();
  const changePassword = useChangePassword();

  const [name, setName] = useState("");
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwLocalError, setPwLocalError] = useState("");

  // 서버에서 받은 이름이 도착하면 입력칸의 초기값으로 넣는다.
  useEffect(() => {
    if (user?.name) setName(user.name);
  }, [user?.name]);

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (updateName.isPending) return; // 중복 제출 방어
    updateName.mutate(
      { name },
      {
        onSuccess: () =>
          toast({ title: "Saved", description: "이름이 변경되었습니다." }),
        onError: () =>
          toast({
            title: "저장 실패",
            description: "이름을 변경하지 못했습니다.",
            variant: "destructive",
          }),
      },
    );
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (changePassword.isPending) return; // 중복 제출 방어
    if (pw.next !== pw.confirm) {
      setPwLocalError("새 비밀번호가 서로 다릅니다.");
      return;
    }
    setPwLocalError("");
    changePassword.mutate(
      { currentPassword: pw.current, newPassword: pw.next },
      {
        onSuccess: () => {
          setPw({ current: "", next: "", confirm: "" });
          toast({
            title: "Password changed",
            description: "비밀번호가 변경되었습니다. 다른 기기의 로그인은 해제됩니다.",
          });
        },
      },
    );
  };

  if (authPending) {
    return (
      <Layout>
        <div
          className="container-narrow py-14 md:py-20"
          role="status"
          aria-busy="true"
          aria-label="불러오는 중"
        >
          <span className="sr-only">계정 정보를 불러오는 중입니다</span>
          <div className="max-w-md mx-auto space-y-6">
            <Skeleton className="h-12 w-48 rounded-none" />
            <Skeleton className="h-40 w-full rounded-none" />
            <Skeleton className="h-56 w-full rounded-none" />
          </div>
        </div>
      </Layout>
    );
  }

  if (!isLoggedIn) {
    return (
      <Layout>
        <div className="container-narrow py-28 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <UserCog className="w-16 h-16 mx-auto mb-6 text-muted-foreground/30" />
            <h1 className="font-serif text-4xl mb-4">Sign In to Continue</h1>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              계정 설정은 로그인한 뒤에 변경하실 수 있습니다.
            </p>
            <Button
              asChild
              size="lg"
              className="rounded-none px-10 py-6 text-sm tracking-[0.15em] uppercase btn-premium"
            >
              <Link to="/login" state={{ from: "/account" }}>
                Sign In
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
          <Link to="/orders" className="hover:text-foreground transition-colors">
            Orders
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground">Account</span>
        </div>
      </div>

      <section className="py-10 md:py-16">
        <div className="container-narrow">
          <div className="max-w-md mx-auto">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="font-serif text-4xl md:text-5xl mb-12"
            >
              Account
            </motion.h1>

            {/* 이메일 — 바꿀 수 없음 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.05 }}
              className="pb-10 mb-10 border-b border-border"
            >
              <h2 className="font-serif text-xl mb-6">Email</h2>
              <p className="text-sm text-foreground mb-2">{user?.email}</p>
              <p className="text-xs text-muted-foreground leading-[1.8]">
                이메일은 주문 확인에 쓰이므로 바꿀 수 없습니다. 변경이 필요하면
                hello@maison.com 으로 문의해 주세요.
              </p>
            </motion.div>

            {/* 이름 */}
            <motion.form
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              onSubmit={handleNameSubmit}
              className="pb-10 mb-10 border-b border-border"
            >
              <h2 className="font-serif text-xl mb-6">Name</h2>

              {updateName.isError && (
                <div
                  role="alert"
                  className="flex items-start gap-3 p-4 mb-5 border border-destructive/30 bg-destructive/5"
                >
                  <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-px" />
                  <p className="text-sm text-foreground">
                    이름을 변경하지 못했습니다.
                  </p>
                </div>
              )}

              <label
                htmlFor="name"
                className="block text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-2"
              >
                Display Name *
              </label>
              <Input
                id="name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="rounded-none h-12 mb-5"
              />

              <Button
                type="submit"
                variant="outline"
                disabled={updateName.isPending || name.trim() === user?.name}
                className="rounded-none px-8 py-5 text-sm tracking-[0.1em] uppercase"
              >
                {updateName.isPending ? (
                  "Saving..."
                ) : updateName.isSuccess && name.trim() === user?.name ? (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Saved
                  </>
                ) : (
                  "Save Name"
                )}
              </Button>
            </motion.form>

            {/* 비밀번호 */}
            <motion.form
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
              onSubmit={handlePasswordSubmit}
            >
              <h2 className="font-serif text-xl mb-6">Password</h2>

              {(changePassword.isError || pwLocalError) && (
                <div
                  role="alert"
                  className="flex items-start gap-3 p-4 mb-5 border border-destructive/30 bg-destructive/5"
                >
                  <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-px" />
                  <p className="text-sm text-foreground">
                    {pwLocalError || describePassword(changePassword.error)}
                  </p>
                </div>
              )}

              <div className="space-y-5">
                <div>
                  <label
                    htmlFor="current-password"
                    className="block text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-2"
                  >
                    Current Password *
                  </label>
                  <Input
                    id="current-password"
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    value={pw.current}
                    onChange={(e) =>
                      setPw((prev) => ({ ...prev, current: e.target.value }))
                    }
                    required
                    className="rounded-none h-12"
                  />
                </div>

                <div>
                  <label
                    htmlFor="new-password"
                    className="block text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-2"
                  >
                    New Password *
                  </label>
                  <Input
                    id="new-password"
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    value={pw.next}
                    onChange={(e) =>
                      setPw((prev) => ({ ...prev, next: e.target.value }))
                    }
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
                    htmlFor="confirm-password"
                    className="block text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-2"
                  >
                    Confirm New Password *
                  </label>
                  <Input
                    id="confirm-password"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    value={pw.confirm}
                    onChange={(e) =>
                      setPw((prev) => ({ ...prev, confirm: e.target.value }))
                    }
                    required
                    className="rounded-none h-12"
                  />
                </div>
              </div>

              <Button
                type="submit"
                variant="outline"
                disabled={changePassword.isPending}
                className="mt-6 rounded-none px-8 py-5 text-sm tracking-[0.1em] uppercase"
              >
                {changePassword.isPending ? "Saving..." : "Change Password"}
              </Button>

              <p className="text-xs text-muted-foreground leading-[1.8] mt-4">
                비밀번호를 바꾸면 다른 기기의 로그인은 모두 해제됩니다.
              </p>
            </motion.form>
          </div>
        </div>
      </section>
    </Layout>
  );
};

export default Account;
