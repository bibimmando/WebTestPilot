import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Eye, EyeOff, FlaskConical, Mail, Smartphone } from "lucide-react";
import { clsx } from "clsx";
import { Trans, useT } from "@/i18n";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Me } from "@/lib/types";
import { CommunitiesStep, GenderStep, InterestsStep } from "./Onboarding";

/**
 * 로그인·가입 내용. 모달 안에서도, /login · /signup 페이지에서도 같은 것을 쓴다.
 *   로그인 ↔ 가입 ↔ 전화번호로 계속하기 ↔ 이메일로 계속하기
 *   새로 가입하면 이어서 성별(건너뛰기 가능) → 관심 항목 → 추천 커뮤니티 가입(건너뛰기 가능).
 */

type StartView = "login" | "signup";
type View = StartView | "phone" | "email" | "gender" | "interests" | "communities";

const pill =
  "h-14 w-full rounded-full border border-transparent bg-bg px-5 text-[15px] text-ink placeholder:text-muted focus:border-accent focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-down";
const primaryPill = "btn h-12 w-full rounded-full bg-accent text-base text-on-accent hover:bg-accent-strong disabled:bg-line disabled:text-muted";
const linkBtn = "font-semibold text-accent hover:underline";

function fieldErrors(err: unknown): { fields: Record<string, string>; message: string | null } {
  if (err instanceof ApiError && err.body?.error === "validation") return { fields: err.fields, message: null };
  return { fields: {}, message: errorMessage(err) };
}

export function AuthPanel({
  initialView,
  onSuccess,
  onSignedUp,
}: {
  initialView: StartView;
  onSuccess: (user: Me) => void;
  /** 새 계정이 만들어진 순간 (가입 뒤 단계로 넘어가기 전) */
  onSignedUp?: () => void;
}) {
  const { setUser } = useSession();
  const [view, setView] = useState<View>(initialView);
  const [origin, setOrigin] = useState<StartView>(initialView);
  const [newUser, setNewUser] = useState<Me | null>(null);

  // 가입하자마자 로그인 상태로 둔다. 가입 뒤 단계에서 창을 닫아도 로그인은 유지된다.
  const signedUp = (user: Me) => {
    onSignedUp?.();
    setUser(user);
    setNewUser(user);
    setView("gender");
  };

  if (view === "gender") return <GenderStep onNext={() => setView("interests")} />;
  if (view === "interests" && newUser) {
    return (
      <InterestsStep
        onBack={() => setView("gender")}
        onDone={(interests) => {
          setNewUser({ ...newUser, interests });
          setView("communities");
        }}
      />
    );
  }
  if (view === "communities" && newUser) {
    return <CommunitiesStep onBack={() => setView("interests")} onDone={(user) => onSuccess(user ?? newUser)} />;
  }

  const go = (next: View) => {
    if (next === "login" || next === "signup") setOrigin(next);
    setView(next);
  };

  if (view === "phone" || view === "email") {
    return <OtpFlow key={view} channel={view} onBack={() => setView(origin)} onSuccess={onSuccess} onSignedUp={signedUp} />;
  }
  return view === "login" ? (
    <LoginView go={go} onSuccess={onSuccess} />
  ) : (
    <SignupView go={go} onSignedUp={signedUp} />
  );
}

function Heading({ title, children }: { title: string; children?: ReactNode }) {
  const t = useT();
  return (
    <div className="mb-6 text-center">
      <h2 id="auth-title" className="text-2xl font-extrabold">{title}</h2>
      {children ?? (
        <p className="mt-2 text-sm text-muted">
          {t("계속 진행하면 Agora 의 이용 약관에 동의하고 개인정보 처리방침을 확인한 것으로 봐요.")}
        </p>
      )}
    </div>
  );
}

function ContinueOptions({ go }: { go: (v: View) => void }) {
  const t = useT();
  const option = "btn h-12 w-full justify-start rounded-full border border-line bg-surface px-5 text-[15px] text-ink hover:bg-bg";
  return (
    <>
      <div className="space-y-3">
        <button type="button" className={option} onClick={() => go("phone")}>
          <Smartphone className="h-5 w-5" />
          <span className="flex-1 text-center">{t("전화번호로 계속하기")}</span>
          <span className="w-5" />
        </button>
        <button type="button" className={option} onClick={() => go("email")}>
          <Mail className="h-5 w-5" />
          <span className="flex-1 text-center">{t("이메일로 계속하기")}</span>
          <span className="w-5" />
        </button>
      </div>
      <div className="my-6 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> {t("또는")} <span className="h-px flex-1 bg-line" />
      </div>
    </>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">{placeholder}</label>
      <input
        id={id}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`${placeholder} *`}
        autoComplete={autoComplete}
        className={clsx(pill, "pr-14")}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={t(shown ? "비밀번호 숨기기" : "비밀번호 보기")}
        aria-pressed={shown}
        className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted hover:text-ink"
      >
        {shown ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </button>
    </div>
  );
}

function LoginView({ go, onSuccess }: { go: (v: View) => void; onSuccess: (u: Me) => void }) {
  const t = useT();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: Me }>("/api/auth/login", { username: identifier, password });
      onSuccess(r.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Heading title={t("로그인")} />
      <ContinueOptions go={go} />
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="login-identifier" className="sr-only">{t("아이디 또는 이메일")}</label>
          <input
            id="login-identifier"
            data-autofocus
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={t("아이디 또는 이메일 *")}
            autoComplete="username"
            className={pill}
          />
        </div>
        <PasswordInput id="login-password" value={password} onChange={setPassword} placeholder={t("비밀번호")} autoComplete="current-password" />
        {error && <p role="alert" className="rounded-2xl bg-down/10 px-4 py-3 text-sm font-medium text-down">{error}</p>}
        <div className="space-y-2 pt-1 text-sm">
          <p>
            <button type="button" className={linkBtn} onClick={() => go("email")}>{t("비밀번호를 잊으셨나요?")}</button>
            <span className="text-muted"> {t("이메일 인증으로 로그인할 수 있어요.")}</span>
          </p>
          <p>
            {t("Agora 를 처음 이용하시나요?")} <button type="button" className={linkBtn} onClick={() => go("signup")}>{t("가입하기@@signup")}</button>
          </p>
        </div>
        <button type="submit" className={primaryPill} disabled={busy || !identifier.trim() || !password}>{t("로그인")}</button>
      </form>
    </>
  );
}

function SignupView({ go, onSignedUp }: { go: (v: View) => void; onSignedUp: (u: Me) => void }) {
  const t = useT();
  const [form, setForm] = useState({ username: "", password: "", passwordConfirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const r = await api.post<{ user: Me }>("/api/auth/signup", form);
      onSignedUp(r.user);
    } catch (err) {
      const { fields, message: m } = fieldErrors(err);
      setErrors(fields);
      setMessage(m);
    } finally {
      setBusy(false);
    }
  };

  const err = (key: string) => errors[key] && <p id={`signup-${key}-error`} className="field-error px-5">{errors[key]}</p>;

  return (
    <>
      <Heading title={t("회원가입")} />
      <ContinueOptions go={go} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="signup-username" className="sr-only">{t("아이디")}</label>
          <input
            id="signup-username"
            data-autofocus
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            placeholder={t("아이디 *")}
            autoComplete="username"
            className={pill}
            aria-invalid={!!errors.username || undefined}
            aria-describedby={errors.username ? "signup-username-error" : "signup-username-hint"}
          />
          {err("username") || <p id="signup-username-hint" className="mt-1 px-5 text-xs text-muted">{t("영문·숫자·밑줄로 3~20자")}</p>}
        </div>
        <div>
          <PasswordInput
            id="signup-password"
            value={form.password}
            onChange={(v) => setForm((f) => ({ ...f, password: v }))}
            placeholder={t("비밀번호 (8자 이상)")}
            autoComplete="new-password"
            invalid={!!errors.password}
            describedBy={errors.password ? "signup-password-error" : undefined}
          />
          {err("password")}
        </div>
        <div>
          <PasswordInput
            id="signup-passwordConfirm"
            value={form.passwordConfirm}
            onChange={(v) => setForm((f) => ({ ...f, passwordConfirm: v }))}
            placeholder={t("비밀번호 확인")}
            autoComplete="new-password"
            invalid={!!errors.passwordConfirm}
            describedBy={errors.passwordConfirm ? "signup-passwordConfirm-error" : undefined}
          />
          {err("passwordConfirm")}
        </div>
        {message && <p role="alert" className="rounded-2xl bg-down/10 px-4 py-3 text-sm font-medium text-down">{message}</p>}
        <p className="pt-1 text-sm">
          {t("이미 계정이 있나요?")} <button type="button" className={linkBtn} onClick={() => go("login")}>{t("로그인")}</button>
        </p>
        <button type="submit" className={primaryPill} disabled={busy}>{t("가입하기@@signup")}</button>
      </form>
    </>
  );
}

interface Challenge {
  challengeId: string;
  maskedTarget: string;
  expiresAt: string;
  resendAfter: string;
  devCode: string;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 전화번호·이메일 인증: 대상 입력 → 인증번호 → (처음이면) 아이디 정하기 */
function OtpFlow({
  channel,
  onBack,
  onSuccess,
  onSignedUp,
}: {
  channel: "phone" | "email";
  onBack: () => void;
  onSuccess: (u: Me) => void;
  onSignedUp: (u: Me) => void;
}) {
  const t = useT();
  const isPhone = channel === "phone";
  const [step, setStep] = useState<"target" | "code" | "username">("target");
  const [target, setTarget] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (step !== "code") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [step]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      await action();
    } catch (err) {
      const { fields, message: m } = fieldErrors(err);
      setErrors(fields);
      setMessage(m);
    } finally {
      setBusy(false);
    }
  };

  const send = () =>
    run(async () => {
      const r = await api.post<Challenge>("/api/auth/otp/start", { channel, target });
      setChallenge(r);
      setCode("");
      setNow(Date.now());
      setStep("code");
    });

  const verify = () =>
    run(async () => {
      const r = await api.post<{ status: "logged_in" | "needs_username"; user?: Me }>("/api/auth/otp/verify", {
        challengeId: challenge?.challengeId,
        code,
      });
      if (r.status === "logged_in" && r.user) onSuccess(r.user);
      else setStep("username");
    });

  const complete = () =>
    run(async () => {
      const r = await api.post<{ user: Me }>("/api/auth/otp/complete", { challengeId: challenge?.challengeId, username });
      onSignedUp(r.user);
    });

  const remaining = challenge ? new Date(challenge.expiresAt).getTime() - now : 0;
  const resendIn = challenge ? new Date(challenge.resendAfter).getTime() - now : 0;
  const label = t(isPhone ? "휴대전화 번호" : "이메일 주소");

  return (
    <>
      <button type="button" onClick={onBack} className="absolute left-4 top-4 flex h-9 items-center gap-1 rounded-full px-3 text-sm font-semibold text-muted hover:bg-bg hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> {t("뒤로")}
      </button>

      {step === "target" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="space-y-4"
          noValidate
        >
          <Heading title={t(isPhone ? "전화번호로 계속하기" : "이메일로 계속하기")}>
            <p className="mt-2 text-sm text-muted">
              {t(isPhone ? "휴대전화로 인증번호를 보내 드려요." : "이메일로 인증번호를 보내 드려요.")} {t("처음이면 바로 가입돼요.")}
            </p>
          </Heading>
          <div>
            <label htmlFor="otp-target" className="sr-only">{label}</label>
            <input
              id="otp-target"
              data-autofocus
              type={isPhone ? "tel" : "email"}
              inputMode={isPhone ? "tel" : "email"}
              autoComplete={isPhone ? "tel" : "email"}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={isPhone ? "010-1234-5678 *" : t("이메일 주소 *")}
              className={pill}
              aria-invalid={!!errors.target || undefined}
              aria-describedby={errors.target ? "otp-target-error" : undefined}
            />
            {errors.target && <p id="otp-target-error" className="field-error px-5">{errors.target}</p>}
          </div>
          {message && <p role="alert" className="rounded-2xl bg-down/10 px-4 py-3 text-sm font-medium text-down">{message}</p>}
          <button type="submit" className={primaryPill} disabled={busy || !target.trim()}>{t("인증번호 받기")}</button>
        </form>
      )}

      {step === "code" && challenge && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
          className="space-y-4"
          noValidate
        >
          <Heading title={t("인증번호 입력")}>
            <p className="mt-2 text-sm text-muted">
              <Trans text="{target} (으)로 보낸 6자리 인증번호를 입력하세요." values={{ target: <strong className="text-ink">{challenge.maskedTarget}</strong> }} />
            </p>
          </Heading>

          <p className="flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <Trans text="테스트 환경이라 실제로 보내지 않아요. 인증번호는 {code} 예요." values={{ code: <strong className="font-mono tracking-widest">{challenge.devCode}</strong> }} />
            </span>
          </p>

          <div>
            <label htmlFor="otp-code" className="sr-only">{t("인증번호")}</label>
            <div className="relative">
              <input
                id="otp-code"
                data-autofocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder={t("인증번호 6자리 *")}
                className={clsx(pill, "pr-20 font-mono tracking-[0.3em] placeholder:font-sans placeholder:tracking-normal")}
                aria-invalid={!!errors.code || undefined}
                aria-describedby="otp-timer"
              />
              <span id="otp-timer" className={clsx("absolute right-5 top-1/2 -translate-y-1/2 text-sm font-semibold tabular-nums", remaining > 0 ? "text-accent" : "text-down")}>
                {remaining > 0 ? mmss(remaining) : t("만료")}
              </span>
            </div>
            {errors.code && <p className="field-error px-5">{errors.code}</p>}
          </div>

          {message && <p role="alert" className="rounded-2xl bg-down/10 px-4 py-3 text-sm font-medium text-down">{message}</p>}

          <p className="text-sm text-muted">
            {t("인증번호가 오지 않았나요?")}{" "}
            <button type="button" className={clsx(linkBtn, "disabled:cursor-not-allowed disabled:text-muted disabled:no-underline")} disabled={busy || resendIn > 0} onClick={() => void send()}>
              {t("다시 받기")}{resendIn > 0 ? t(" ({n}초)", { n: Math.ceil(resendIn / 1000) }) : ""}
            </button>
          </p>

          <button type="submit" className={primaryPill} disabled={busy || code.length !== 6}>{t("확인")}</button>
        </form>
      )}

      {step === "username" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void complete();
          }}
          className="space-y-4"
          noValidate
        >
          <Heading title={t("아이디 정하기")}>
            <p className="mt-2 text-sm text-muted">{t("처음 오셨네요! Agora 에서 쓸 아이디를 정해 주세요.")}</p>
          </Heading>
          <div>
            <label htmlFor="otp-username" className="sr-only">{t("아이디")}</label>
            <input
              id="otp-username"
              data-autofocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("아이디 *")}
              autoComplete="username"
              className={pill}
              aria-invalid={!!errors.username || undefined}
              aria-describedby={errors.username ? "otp-username-error" : "otp-username-hint"}
            />
            {errors.username ? (
              <p id="otp-username-error" className="field-error px-5">{errors.username}</p>
            ) : (
              <p id="otp-username-hint" className="mt-1 px-5 text-xs text-muted">{t("영문·숫자·밑줄로 3~20자")}</p>
            )}
          </div>
          {message && <p role="alert" className="rounded-2xl bg-down/10 px-4 py-3 text-sm font-medium text-down">{message}</p>}
          <button type="submit" className={primaryPill} disabled={busy || !username.trim()}>{t("가입 완료")}</button>
        </form>
      )}
    </>
  );
}
