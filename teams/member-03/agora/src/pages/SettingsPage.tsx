import { useT } from "@/i18n";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Camera, Loader2 } from "lucide-react";
import { clsx } from "clsx";
import { GENDER_LABELS, InterestPicker, toggleIn } from "@/components/Onboarding";
import { LANGS, useI18n, type Lang } from "@/i18n";
import { UserAvatar } from "@/components/UserAvatar";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";
import type { Gender, Settings } from "@/lib/types";
import { UPLOAD_ACCEPT, imageFileError, uploadImage } from "@/lib/upload";

const BIO_MAX = 200;
type Tab = "profile" | "account" | "notifications";

const TABS: [Tab, string, string][] = [
  ["profile", "프로필", "/settings"],
  ["account", "계정", "/settings/account"],
  ["notifications", "알림·쪽지", "/settings/notifications"],
];

/** /settings  /settings/account  /settings/notifications */
export function SettingsPage({ tab }: { tab: Tab }) {
  const t = useT();
  const { data, error, setData } = useAsync(() => api.get<{ settings: Settings }>("/api/me/settings").then((r) => r.settings), []);
  const update = (s: Settings) => setData(() => s);

  return (
    <div>
      <h1 className="mb-3 text-xl font-bold">{t("설정")}</h1>
      <nav className="mb-4 flex gap-1 border-b border-line" aria-label={t("설정 메뉴")}>
        {TABS.map(([value, label, to]) => (
          <NavLink
            key={value}
            to={to}
            end
            className={({ isActive }) =>
              clsx("-mb-px border-b-2 px-4 py-2 text-sm font-semibold", isActive ? "border-accent text-accent-strong" : "border-transparent text-muted hover:text-ink")
            }
          >
            {t(label)}
          </NavLink>
        ))}
      </nav>
      {error ? (
        <p role="alert" className="card p-6 text-sm text-down">{t("설정을 불러오지 못했어요.")} {errorMessage(error)}</p>
      ) : !data ? (
        <p className="py-10 text-center text-sm text-muted">{t("불러오는 중…")}</p>
      ) : tab === "profile" ? (
        <div className="space-y-4">
          <ProfileForm settings={data} onSaved={update} />
          <InterestsForm settings={data} onSaved={update} />
        </div>
      ) : tab === "account" ? (
        <div className="space-y-4">
          <AccountInfo settings={data} />
          <LanguageForm />
          <GenderForm settings={data} onSaved={update} />
          <EmailForm settings={data} onSaved={update} />
          <PasswordForm settings={data} onSaved={update} />
        </div>
      ) : (
        <PrefsForm settings={data} onSaved={update} />
      )}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const t = useT();
  return (
    <section className="card p-5">
      <h2 className="font-bold">{t(title)}</h2>
      {description && <p className="mt-0.5 text-sm text-muted">{t(description)}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** 저장 결과를 버튼 옆에 잠깐 보여 준다. */
function useSavedNotice(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return [
    saved,
    () => {
      setSaved(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(false), 2500);
    },
  ];
}

function SavedNotice({ show }: { show: boolean }) {
  const t = useT();
  return (
    <span role="status" className="text-sm font-medium text-up">
      {show ? t("저장했어요") : ""}
    </span>
  );
}

function fieldErrors(err: unknown): [Record<string, string>, string | null] {
  if (err instanceof ApiError && err.body?.error === "validation") return [err.fields, null];
  return [{}, errorMessage(err)];
}

function ProfileForm({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const t = useT();
  const { refresh } = useSession();
  const fileRef = useRef<HTMLInputElement>(null);
  const [bio, setBio] = useState(settings.bio);
  // undefined: 그대로, null: 기본 그림으로, 문자열: 새로 올린 파일
  const [avatar, setAvatar] = useState<{ id: string; url: string } | null | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, showSaved] = useSavedNotice();
  const bioLength = [...bio].length;
  const preview = avatar === undefined ? settings.avatar : avatar?.url ?? null;

  const pick = async (file: File) => {
    const problem = imageFileError(file);
    if (problem) {
      setErrors({ avatar: problem });
      return;
    }
    setErrors({});
    setUploading(true);
    try {
      const up = await uploadImage(file);
      if (up.width < 64 || up.height < 64) setErrors({ avatar: t("가로·세로 64px 이상인 이미지를 골라 주세요.") });
      else setAvatar({ id: up.id, url: up.url });
    } catch (err) {
      setErrors({ avatar: errorMessage(err) });
    } finally {
      setUploading(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const body: Record<string, unknown> = { bio };
      if (avatar !== undefined) body.avatar = avatar ? avatar.id : null;
      const r = await api.patch<{ settings: Settings }>("/api/me/profile", body);
      onSaved(r.settings);
      setAvatar(undefined);
      showSaved();
      void refresh();
    } catch (err) {
      const [fields, message] = fieldErrors(err);
      setErrors(fields);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} noValidate>
      <Section title={t("프로필")} description="다른 사람에게 보이는 사진과 소개예요.">
        <div className="flex items-center gap-4">
          <div className="relative">
            <UserAvatar name={settings.name} src={preview} size="xl" />
            {uploading && (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white" role="status" aria-label={t("사진 올리는 중")}>
                <Loader2 className="h-6 w-6 animate-spin" />
              </span>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-outline py-1.5" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <Camera className="h-4 w-4" /> {t("사진 바꾸기")}
              </button>
              {preview && (
                <button type="button" className="btn-ghost py-1.5" onClick={() => setAvatar(null)}>
                  {t("기본 그림으로")}
                </button>
              )}
            </div>
            <p className="text-xs text-muted">{t("JPG · PNG · WEBP · GIF, 5MB 이하, 64px 이상")}</p>
            <input
              ref={fileRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              className="sr-only"
              aria-label={t("프로필 사진 파일 선택")}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void pick(file);
                e.target.value = "";
              }}
            />
            {errors.avatar && <p role="alert" className="field-error">{errors.avatar}</p>}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-1 flex items-baseline justify-between">
            <label htmlFor="bio" className="text-sm font-semibold">{t("자기소개")}</label>
            <span className={clsx("text-xs", bioLength > BIO_MAX ? "text-down" : "text-muted")}>{bioLength}/{BIO_MAX}</span>
          </div>
          <textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            className="input resize-y"
            placeholder={t("나를 소개해 주세요")}
            aria-invalid={!!errors.bio}
            aria-describedby={errors.bio ? "bio-error" : undefined}
          />
          {errors.bio && <p id="bio-error" className="field-error">{errors.bio}</p>}
        </div>

        {formError && <p role="alert" className="mt-4 rounded-lg bg-down/10 px-4 py-3 text-sm font-medium text-down">{formError}</p>}
        <div className="mt-5 flex items-center justify-end gap-3">
          <SavedNotice show={saved} />
          <button type="submit" className="btn-primary" disabled={busy || uploading}>{t("저장")}</button>
        </div>
      </Section>
    </form>
  );
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}-****-${phone.slice(-4)}`;
}

function AccountInfo({ settings }: { settings: Settings }) {
  const t = useT();
  return (
    <Section title={t("계정 정보")}>
      <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted">{t("아이디")}</dt>
        <dd className="font-semibold">{settings.name}</dd>
        <dt className="text-muted">{t("전화번호")}</dt>
        <dd>{settings.phone ? maskPhone(settings.phone) : <span className="text-muted">{t("등록 안 함")}</span>}</dd>
      </dl>
    </Section>
  );
}

function EmailForm({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const t = useT();
  const [email, setEmail] = useState(settings.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, showSaved] = useSavedNotice();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.patch<{ settings: Settings }>("/api/me/email", { email });
      onSaved(r.settings);
      setEmail(r.settings.email ?? "");
      showSaved();
    } catch (err) {
      const [fields, message] = fieldErrors(err);
      setError(fields.email ?? message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} noValidate>
      <Section title={t("이메일")} description="로그인과 비밀번호 찾기에 써요.">
        <label htmlFor="settings-email" className="mb-1 block text-sm font-semibold">{t("이메일 주소")}</label>
        <input
          id="settings-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input"
          autoComplete="email"
          aria-invalid={!!error}
          aria-describedby={error ? "settings-email-error" : undefined}
        />
        {error && <p id="settings-email-error" className="field-error">{error}</p>}
        <div className="mt-4 flex items-center justify-end gap-3">
          <SavedNotice show={saved} />
          <button type="submit" className="btn-primary" disabled={busy || email === (settings.email ?? "")}>{t("이메일 바꾸기")}</button>
        </div>
      </Section>
    </form>
  );
}

function PasswordForm({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const t = useT();
  const id = useId();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, showSaved] = useSavedNotice();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const r = await api.post<{ settings: Settings }>("/api/me/password", { current, password, passwordConfirm: confirm });
      onSaved(r.settings);
      setCurrent("");
      setPassword("");
      setConfirm("");
      showSaved();
    } catch (err) {
      const [fields, message] = fieldErrors(err);
      setErrors(fields);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  };

  const field = (key: string, label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <div>
      <label htmlFor={`${id}-${key}`} className="mb-1 block text-sm font-semibold">{t(label)}</label>
      <input
        id={`${id}-${key}`}
        type="password"
        value={value}
        onChange={(e) => set(e.target.value)}
        className="input"
        autoComplete={autoComplete}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
      />
      {errors[key] && <p id={`${id}-${key}-error`} className="field-error">{errors[key]}</p>}
    </div>
  );

  return (
    <form onSubmit={save} noValidate>
      <Section
        title={t(settings.hasPassword ? "비밀번호 바꾸기" : "비밀번호 만들기")}
        description={settings.hasPassword ? undefined : "전화번호·이메일 인증으로 가입해서 아직 비밀번호가 없어요. 만들면 아이디로도 로그인할 수 있어요."}
      >
        <div className="space-y-3">
          {settings.hasPassword && field("current", "현재 비밀번호", current, setCurrent, "current-password")}
          {field("password", "새 비밀번호 (8자 이상)", password, setPassword, "new-password")}
          {field("passwordConfirm", "새 비밀번호 확인", confirm, setConfirm, "new-password")}
        </div>
        {formError && <p role="alert" className="mt-4 rounded-lg bg-down/10 px-4 py-3 text-sm font-medium text-down">{formError}</p>}
        <div className="mt-4 flex items-center justify-end gap-3">
          <SavedNotice show={saved} />
          <button type="submit" className="btn-primary" disabled={busy}>{t(settings.hasPassword ? "비밀번호 바꾸기" : "비밀번호 만들기")}</button>
        </div>
      </Section>
    </form>
  );
}

const PREFS: { key: keyof Settings["prefs"]; label: string; hint: string }[] = [
  { key: "replyNotifications", label: "답글 알림", hint: "내 글에 댓글, 내 댓글에 답글이 달리면 알려 드려요." },
  { key: "modNotifications", label: "운영진 조치 알림", hint: "운영진이 내 글을 지우거나 활동을 정지하면 알려 드려요." },
  { key: "allowMessages", label: "쪽지 받기", hint: "끄면 다른 사람이 나에게 쪽지를 보낼 수 없어요." },
];

function PrefsForm({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const t = useT();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, showSaved] = useSavedNotice();

  const toggle = async (key: keyof Settings["prefs"]) => {
    setPending(key);
    setError(null);
    try {
      const r = await api.patch<{ settings: Settings }>("/api/me/prefs", { [key]: !settings.prefs[key] });
      onSaved(r.settings);
      showSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <Section title={t("알림·쪽지")} description="바꾸면 바로 저장돼요.">
      <ul className="divide-y divide-line">
        {PREFS.map((p) => {
          const on = settings.prefs[p.key];
          return (
            <li key={p.key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p id={`pref-${p.key}`} className="text-sm font-semibold">{t(p.label)}</p>
                <p className="text-xs text-muted">{t(p.hint)}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-labelledby={`pref-${p.key}`}
                disabled={pending !== null}
                onClick={() => toggle(p.key)}
                className={clsx("relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60", on ? "bg-accent" : "bg-line")}
              >
                <span className={clsx("absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-[1.375rem]" : "translate-x-0.5")} />
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="mt-2 flex justify-end">
        <SavedNotice show={saved} />
      </div>
    </Section>
  );
}

function InterestsForm({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const t = useT();
  const { refresh } = useSession();
  const [selected, setSelected] = useState(() => new Set(settings.interests));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, showSaved] = useSavedNotice();
  const changed = selected.size !== settings.interests.length || settings.interests.some((id) => !selected.has(id));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.put<{ settings: Settings }>("/api/me/interests", { interests: [...selected] });
      onSaved(r.settings);
      showSaved();
      void refresh(); // 추천 커뮤니티가 새 관심 항목을 따라가게
    } catch (err) {
      const [fields, message] = fieldErrors(err);
      setError(fields.interests ?? message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t("관심 항목")} description={t("가입할 때 고른 주제예요. {n}개 골랐어요.", { n: selected.size })}>
      <InterestPicker selected={selected} onToggle={(id) => setSelected((s) => toggleIn(s, id))} />
      {error && <p role="alert" className="field-error mt-3">{error}</p>}
      <div className="mt-5 flex items-center justify-end gap-3">
        <SavedNotice show={saved} />
        <button type="button" className="btn-primary" disabled={busy || !changed} onClick={save}>{t("관심 항목 저장")}</button>
      </div>
    </Section>
  );
}

function GenderForm({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const t = useT();
  const [value, setValue] = useState<Gender | "">(settings.gender ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, showSaved] = useSavedNotice();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.put<{ settings: Settings }>("/api/me/gender", { gender: value || null });
      onSaved(r.settings);
      showSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save}>
      <Section title={t("성별")} description="맞춤 추천에만 쓰고, 다른 사람에게는 보이지 않아요.">
        <label htmlFor="settings-gender" className="sr-only">{t("성별")}</label>
        <select id="settings-gender" value={value} onChange={(e) => setValue(e.target.value as Gender | "")} className="input">
          <option value="">{t("밝히지 않음")}</option>
          {(Object.keys(GENDER_LABELS) as Gender[]).map((g) => (
            <option key={g} value={g}>{t(GENDER_LABELS[g])}</option>
          ))}
        </select>
        {error && <p role="alert" className="field-error">{error}</p>}
        <div className="mt-4 flex items-center justify-end gap-3">
          <SavedNotice show={saved} />
          <button type="submit" className="btn-primary" disabled={busy || value === (settings.gender ?? "")}>{t("저장")}</button>
        </div>
      </Section>
    </form>
  );
}

/** 화면 언어. 이 브라우저에 기억하고, 바꾸는 즉시 화면 전체가 새 언어로 다시 그려진다. */
function LanguageForm() {
  const { lang, setLang, t } = useI18n();
  return (
    <Section title="언어" description="화면에 보이는 메뉴와 안내 문구의 언어예요. 글과 댓글은 쓴 사람의 언어 그대로 보여요.">
      <label htmlFor="settings-language" className="sr-only">{t("언어")}</label>
      <select id="settings-language" value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="input">
        {LANGS.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>
        ))}
      </select>
    </Section>
  );
}
