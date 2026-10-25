import { useT } from "@/i18n";
import { useId, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, useParams, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, Check, ImagePlus, Loader2, Plus, Shield, Trash2, X } from "lucide-react";
import { clsx } from "clsx";
import { CommunityAvatar, CommunityBanner } from "@/components/CommunityAvatar";
import { UserAvatar } from "@/components/UserAvatar";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useCommunities } from "@/lib/communities";
import { fullDate, postPath, shortDate, timeAgo } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";
import type { Ban, Community, Report, ReportReason } from "@/lib/types";
import { UPLOAD_ACCEPT, imageFileError, uploadImage } from "@/lib/upload";
import { ModMembers } from "./ModMembers";
import { NotFoundCard } from "./NotFoundPage";

type Tab = "queue" | "bans" | "members" | "settings";

const REASON_LABELS: Record<ReportReason, string> = {
  spam: "스팸·광고",
  harassment: "괴롭힘·혐오 표현",
  misinformation: "잘못된 정보",
  rule: "커뮤니티 규칙 위반",
  other: "기타",
};

const BAN_DAYS: [number, string][] = [
  [1, "1일"],
  [3, "3일"],
  [7, "7일"],
  [30, "30일"],
  [0, "영구"],
];

/**
 * 운영 도구. 그 커뮤니티 운영진만 들어올 수 있다.
 *   /c/:name/mod           신고함
 *   /c/:name/mod/bans      활동 정지
 *   /c/:name/mod/members   회원 (가입 요청 · 초대 · 회원 목록)
 *   /c/:name/mod/settings  커뮤니티 설정
 */
export function ModPage({ tab }: { tab: Tab }) {
  const t = useT();
  const { name = "" } = useParams();
  const { user } = useSession();
  const { data: community, error, setData } = useAsync(
    () => api.get<{ community: Community }>(`/api/communities/${name}`).then((r) => r.community),
    [name, user?.name],
  );

  if (error instanceof ApiError && error.status === 404) return <NotFoundCard title={t("c/{name} 커뮤니티를 찾을 수 없어요", { name })} />;
  if (!community) return <p className="py-10 text-center text-sm text-muted">{t("불러오는 중…")}</p>;
  if (!community.isModerator) {
    return <NotFoundCard title={t("운영진만 볼 수 있는 화면이에요")} detail={t("c/{name} 운영진으로 로그인해 주세요.", { name })} />;
  }

  const base = `/c/${community.name}/mod`;
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <CommunityAvatar name={community.name} title={community.title} icon={community.icon} color={community.color} size="md" />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-1.5 text-xl font-bold"><Shield className="h-5 w-5 text-accent" /> {t("운영 도구")}</h1>
          <Link to={`/c/${community.name}`} className="text-sm text-muted hover:underline">{t("c/{name} 으로 돌아가기", { name: community.name })}</Link>
        </div>
      </div>

      <nav className="mb-4 flex gap-1 border-b border-line" aria-label={t("운영 도구 메뉴")}>
        {(
          [
            ["queue", `${t("신고함")}${community.openReports ? ` ${community.openReports}` : ""}`, base],
            ["bans", t("활동 정지"), `${base}/bans`],
            ["members", t("회원"), `${base}/members`],
            ["settings", t("커뮤니티 설정"), `${base}/settings`],
          ] as const
        ).map(([value, label, to]) => (
          <NavLink
            key={value}
            to={to}
            end
            className={({ isActive }) =>
              clsx("-mb-px border-b-2 px-4 py-2 text-sm font-semibold", isActive ? "border-accent text-accent-strong" : "border-transparent text-muted hover:text-ink")
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      {tab === "queue" && <ReportQueue community={community} onCommunity={(c) => setData(() => c)} />}
      {tab === "bans" && <Bans community={community} />}
      {tab === "members" && <ModMembers community={community} />}
      {tab === "settings" && <CommunitySettings community={community} onSaved={(c) => setData(() => c)} />}
    </div>
  );
}

// ── 신고함 ──────────────────────────────────────────────

function ReportQueue({ community, onCommunity }: { community: Community; onCommunity: (c: Community) => void }) {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const resolved = params.get("status") === "resolved";
  const { data, error, reload } = useAsync(
    () => api.get<{ items: Report[] }>(`/api/communities/${community.name}/reports${resolved ? "?status=resolved" : ""}`),
    [community.name, resolved],
  );

  return (
    <div>
      <div className="mb-3 flex gap-1.5" role="group" aria-label={t("신고 상태")}>
        {(
          [
            [false, t("처리 대기")],
            [true, t("처리 완료")],
          ] as const
        ).map(([value, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={resolved === value}
            onClick={() => setParams(value ? { status: "resolved" } : {})}
            className={clsx("btn px-3 py-1 text-xs", resolved === value ? "bg-ink text-surface" : "border border-line bg-surface text-muted hover:text-ink")}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="card p-6 text-sm text-down">{errorMessage(error)}</p>
      ) : !data ? (
        <p className="py-10 text-center text-sm text-muted">{t("불러오는 중…")}</p>
      ) : data.items.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <Check className="h-8 w-8 text-up" />
          <p className="font-semibold">{t(resolved ? "처리한 신고가 없어요" : "처리할 신고가 없어요")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.items.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              community={community}
              onResolved={(c) => {
                onCommunity(c);
                reload();
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportCard({ report, community, onResolved }: { report: Report; community: Community; onResolved: (c: Community) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = report.status === "open";
  const link = postPath(report.post) + (report.comment ? `#comment-${report.comment.id}` : "");

  const resolve = async (action: "approve" | "remove") => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ community: Community }>(`/api/reports/${report.id}/resolve`, { action });
      onResolved(r.community);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-down/10 px-2 py-0.5 font-semibold text-down">{t(REASON_LABELS[report.reason])}</span>
        <span className="chip">{t(report.type === "post" ? "글@@one" : "댓글@@one")}</span>
        <span className="text-muted">
          {t("u/{name} 신고", { name: report.reporter })} · <time dateTime={report.createdAt} title={fullDate(report.createdAt)}>{timeAgo(report.createdAt)}</time>
        </span>
        {!open && (
          <span className={clsx("ml-auto rounded-full px-2 py-0.5 font-semibold", report.status === "removed" ? "bg-down/10 text-down" : "bg-up/10 text-up")}>
            {t(report.status === "removed" ? "삭제함" : "유지함")} · u/{report.resolvedBy}
          </span>
        )}
      </div>
      {report.rule && <p className="mt-2 text-sm"><span className="text-muted">{t("어긴 규칙:")}</span> {report.rule}</p>}
      {report.detail && <p className="mt-1 text-sm"><span className="text-muted">{t("신고 내용:")}</span> {report.detail}</p>}

      <div className="mt-3 rounded-lg border border-line bg-bg/60 p-3">
        <p className="text-xs text-muted">
          u/{report.targetAuthor}
          {report.type === "comment" && <> · {t("글@@one")} <Link to={postPath(report.post)} className="hover:underline">{report.post.title}</Link></>}
        </p>
        <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm">{report.original}</p>
        <Link to={link} className="mt-1 inline-block text-xs font-semibold text-accent hover:underline">{t("원래 자리에서 보기")}</Link>
      </div>

      {error && <p role="alert" className="field-error">{error}</p>}
      {open && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Link to={`/c/${community.name}/mod/bans?user=${report.targetAuthor}`} className="btn-ghost py-1.5">{t("작성자 활동 정지")}</Link>
          <button type="button" className="btn-outline py-1.5" disabled={busy} onClick={() => resolve("approve")}>
            <Check className="h-4 w-4" /> {t("문제없음")}
          </button>
          <button type="button" className="btn-danger py-1.5" disabled={busy} onClick={() => resolve("remove")}>
            <Trash2 className="h-4 w-4" /> {t(report.type === "post" ? "글 삭제" : "댓글 삭제")}
          </button>
        </div>
      )}
    </li>
  );
}

// ── 활동 정지 ────────────────────────────────────────────

function Bans({ community }: { community: Community }) {
  const t = useT();
  const { data, error, reload } = useAsync(() => api.get<{ items: Ban[] }>(`/api/communities/${community.name}/bans`), [community.name]);
  return (
    <div className="space-y-4">
      <BanForm community={community} onBanned={reload} />
      <section className="card">
        <h2 className="border-b border-line px-5 py-3 font-bold">{t("정지된 사용자")}</h2>
        {error ? (
          <p role="alert" className="p-5 text-sm text-down">{errorMessage(error)}</p>
        ) : !data ? (
          <p className="p-6 text-center text-sm text-muted">{t("불러오는 중…")}</p>
        ) : data.items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">{t("정지된 사용자가 없어요.")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((b) => <BanRow key={b.user} ban={b} community={community} onLifted={reload} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

function BanRow({ ban, community, onLifted }: { ban: Ban; community: Community; onLifted: () => void }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lift = async () => {
    try {
      await api.del(`/api/communities/${community.name}/bans/${ban.user}`);
      onLifted();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <UserAvatar name={ban.user} src={ban.avatar} size="md" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          <Link to={`/u/${ban.user}`} className="hover:underline">u/{ban.user}</Link>
          <span className="ml-2 text-xs font-normal text-muted">{ban.until ? t("{date}까지", { date: shortDate(ban.until) }) : t("영구 정지")}</span>
        </p>
        <p className="text-sm text-muted">{ban.reason}</p>
        <p className="text-xs text-muted">u/{ban.by} · {timeAgo(ban.createdAt)}</p>
        {error && <p role="alert" className="field-error">{error}</p>}
      </div>
      {confirming ? (
        <span className="flex items-center gap-1 text-sm">
          {t("정지를 풀까요?")}
          <button type="button" className="btn-primary px-3 py-1" onClick={lift}>{t("풀기")}</button>
          <button type="button" className="btn-ghost px-3 py-1" onClick={() => setConfirming(false)}>{t("취소")}</button>
        </span>
      ) : (
        <button type="button" className="btn-outline py-1.5" onClick={() => setConfirming(true)}>{t("정지 풀기")}</button>
      )}
    </li>
  );
}

function BanForm({ community, onBanned }: { community: Community; onBanned: () => void }) {
  const t = useT();
  const [params] = useSearchParams();
  const [username, setUsername] = useState(params.get("user") ?? "");
  const [days, setDays] = useState<number | "">("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    setDone(null);
    try {
      await api.post(`/api/communities/${community.name}/bans`, { username, days: days === "" ? null : days, reason });
      setDone(t("u/{name} 의 활동을 정지했어요.", { name: username.replace(/^u\//, "") }));
      setUsername("");
      setDays("");
      setReason("");
      onBanned();
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === "validation") setErrors(err.fields);
      else setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4 p-5" noValidate>
      <div>
        <h2 className="font-bold">{t("활동 정지하기")}</h2>
        <p className="mt-0.5 text-sm text-muted">{t("정지된 사용자는 이 커뮤니티에 글과 댓글을 쓸 수 없어요. 정지하면 본인에게 알림이 가요.")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ban-user" className="mb-1 block text-sm font-semibold">{t("아이디")}</label>
          <input
            id="ban-user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input"
            placeholder={t("예: bob")}
            autoComplete="off"
            aria-invalid={!!errors.username}
            aria-describedby={errors.username ? "ban-user-error" : undefined}
          />
          {errors.username && <p id="ban-user-error" className="field-error">{errors.username}</p>}
        </div>
        <div>
          <label htmlFor="ban-days" className="mb-1 block text-sm font-semibold">{t("기간")}</label>
          <select
            id="ban-days"
            value={days}
            onChange={(e) => setDays(e.target.value === "" ? "" : Number(e.target.value))}
            className="input"
            aria-invalid={!!errors.days}
            aria-describedby={errors.days ? "ban-days-error" : undefined}
          >
            <option value="">{t("기간을 고르세요")}</option>
            {BAN_DAYS.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
          </select>
          {errors.days && <p id="ban-days-error" className="field-error">{errors.days}</p>}
        </div>
      </div>
      <div>
        <label htmlFor="ban-reason" className="mb-1 block text-sm font-semibold">{t("이유")} <span className="font-normal text-muted">{t("(본인에게 보여요, 100자까지)")}</span></label>
        <input
          id="ban-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="input"
          placeholder={t("예: 규칙 3 위반 — 홍보 글 반복 게시")}
          aria-invalid={!!errors.reason}
          aria-describedby={errors.reason ? "ban-reason-error" : undefined}
        />
        {errors.reason && <p id="ban-reason-error" className="field-error">{errors.reason}</p>}
      </div>
      {formError && <p role="alert" className="rounded-lg bg-down/10 px-4 py-3 text-sm font-medium text-down">{formError}</p>}
      <div className="flex items-center justify-end gap-3">
        <span role="status" className="text-sm font-medium text-up">{done}</span>
        <button type="submit" className="btn-danger" disabled={busy}>{t("활동 정지")}</button>
      </div>
    </form>
  );
}

// ── 커뮤니티 설정 ──────────────────────────────────────────

const DESCRIPTION_MAX = 500;
const RULES_MAX = 10;

function ImageField({
  label,
  hint,
  value,
  onPick,
  onClear,
  error,
  shape,
}: {
  label: string;
  hint: string;
  value: { url: string } | null;
  onPick: (file: File) => Promise<void>;
  onClear: () => void;
  error?: string;
  shape: "icon" | "banner";
}) {
  const t = useT();
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <p id={id} className="mb-1 text-sm font-semibold">{t(label)}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className={clsx("relative overflow-hidden bg-bg", shape === "icon" ? "h-16 w-16 rounded-full" : "h-16 w-48 rounded-lg")}>
          {value ? <img src={value.url} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-xs text-muted">{t("없음")}</span>}
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white" role="status" aria-label={t("{label} 올리는 중", { label: t(label) })}>
              <Loader2 className="h-5 w-5 animate-spin" />
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-outline py-1.5" disabled={busy} onClick={() => ref.current?.click()} aria-describedby={id}>
            <ImagePlus className="h-4 w-4" /> {t("올리기")}
          </button>
          {value && <button type="button" className="btn-ghost py-1.5" onClick={onClear}>{t("빼기")}</button>}
        </div>
        <input
          ref={ref}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="sr-only"
          aria-label={t("{label} 파일 선택", { label: t(label) })}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setBusy(true);
            await onPick(file);
            setBusy(false);
          }}
        />
      </div>
      <p className="mt-1 text-xs text-muted">{t(hint)}</p>
      {error && <p role="alert" className="field-error">{error}</p>}
    </div>
  );
}

function CommunitySettings({ community, onSaved }: { community: Community; onSaved: (c: Community) => void }) {
  const t = useT();
  const { replace } = useCommunities();
  // 화면 언어와 상관없이 원문을 고친다(번역은 원문이 바뀌면 자연히 빠진다).
  const [description, setDescription] = useState(community.source.description);
  const [rules, setRules] = useState(community.source.rules);
  const [requireFlair, setRequireFlair] = useState(community.requireFlair);
  const [access, setAccess] = useState(community.access);
  const [mature, setMature] = useState(community.mature);
  const [approvedNote, setApprovedNote] = useState<string | null>(null);
  const [color, setColor] = useState(community.color);
  // 값: 지금 쓰는 주소(문자열 그대로 보냄) · 새로 올린 파일 · null(빼기)
  const [icon, setIcon] = useState<{ send: string; url: string } | null>(community.icon ? { send: community.icon, url: community.icon } : null);
  const [banner, setBanner] = useState<{ send: string; url: string } | null>(community.banner ? { send: community.banner, url: community.banner } : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const descLength = [...description].length;

  const pick = (key: "icon" | "banner", set: (v: { send: string; url: string }) => void) => async (file: File) => {
    const problem = imageFileError(file);
    if (problem) {
      setErrors((e) => ({ ...e, [key]: problem }));
      return;
    }
    try {
      const up = await uploadImage(file);
      set({ send: up.id, url: up.url });
      setErrors((e) => ({ ...e, [key]: "" }));
    } catch (err) {
      setErrors((e) => ({ ...e, [key]: errorMessage(err) }));
    }
  };

  const moveRule = (i: number, delta: number) =>
    setRules((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      next.splice(i + delta, 0, item);
      return next;
    });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    setSaved(false);
    setApprovedNote(null);
    try {
      const r = await api.patch<{ community: Community; approved: number }>(`/api/communities/${community.name}`, {
        description,
        rules,
        requireFlair,
        access,
        mature,
        color,
        icon: icon ? icon.send : null,
        banner: banner ? banner.send : null,
      });
      onSaved(r.community);
      replace(r.community);
      setSaved(true);
      if (r.approved > 0) setApprovedNote(t("비공개를 풀어서 기다리던 가입 요청 {n}건을 승인했어요.", { n: r.approved }));
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === "validation") setErrors(err.fields);
      else setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4" noValidate>
      <section className="card overflow-hidden">
        <CommunityBanner banner={banner?.url ?? null} color={color} className="h-24" />
        <div className="space-y-5 p-5">
          <p className="text-xs text-muted">{t("위는 미리보기예요. 저장해야 커뮤니티에 반영돼요.")}</p>
          <ImageField label={t("아이콘")} hint="정사각형 이미지 권장, 64×64px 이상" value={icon} shape="icon" onPick={pick("icon", setIcon)} onClear={() => setIcon(null)} error={errors.icon} />
          <ImageField label={t("배너")} hint="가로로 긴 이미지 권장, 600×100px 이상" value={banner} shape="banner" onPick={pick("banner", setBanner)} onClear={() => setBanner(null)} error={errors.banner} />
          <div>
            <label htmlFor="community-color" className="mb-1 block text-sm font-semibold">{t("대표 색")} <span className="font-normal text-muted">{t("(배너가 없을 때 써요)")}</span></label>
            <div className="flex items-center gap-3">
              <input id="community-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-surface p-1" />
              <code className="text-sm text-muted">{color}</code>
            </div>
            {errors.color && <p className="field-error">{errors.color}</p>}
          </div>
        </div>
      </section>

      <section className="card space-y-5 p-5">
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label htmlFor="community-description" className="text-sm font-semibold">{t("소개")}</label>
            <span className={clsx("text-xs", descLength > DESCRIPTION_MAX ? "text-down" : "text-muted")}>{descLength}/{DESCRIPTION_MAX}</span>
          </div>
          <textarea
            id="community-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="input resize-y"
            aria-invalid={!!errors.description}
            aria-describedby={errors.description ? "community-description-error" : undefined}
          />
          {errors.description && <p id="community-description-error" className="field-error">{errors.description}</p>}
        </div>

        <fieldset aria-describedby={errors.rules ? "community-rules-error" : undefined}>
          <legend className="mb-1 text-sm font-semibold">{t("규칙")} <span className="font-normal text-muted">({rules.length}/{RULES_MAX})</span></legend>
          <ol className="space-y-2">
            {rules.map((rule, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-5 text-right text-sm text-muted">{i + 1}.</span>
                <label className="flex-1">
                  <span className="sr-only">{t("{n}번 규칙", { n: i + 1 })}</span>
                  <input value={rule} onChange={(e) => setRules((list) => list.map((r, j) => (j === i ? e.target.value : r)))} className="input py-1.5" />
                </label>
                <button type="button" className="btn-ghost h-8 w-8 p-0" aria-label={t("{n}번 규칙 위로", { n: i + 1 })} disabled={i === 0} onClick={() => moveRule(i, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button type="button" className="btn-ghost h-8 w-8 p-0" aria-label={t("{n}번 규칙 아래로", { n: i + 1 })} disabled={i === rules.length - 1} onClick={() => moveRule(i, 1)}>
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button type="button" className="btn-ghost h-8 w-8 p-0" aria-label={t("{n}번 규칙 지우기", { n: i + 1 })} onClick={() => setRules((list) => list.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="btn-outline mt-2 py-1.5" disabled={rules.length >= RULES_MAX} onClick={() => setRules((list) => [...list, ""])}>
            <Plus className="h-4 w-4" /> {t("규칙 추가")}
          </button>
          {errors.rules && <p id="community-rules-error" className="field-error">{errors.rules}</p>}
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{t("공개 범위")}</legend>
          <div className="space-y-2">
            {(
              [
                ["public", "공개", "누구나 보고 글을 쓸 수 있어요."],
                ["restricted", "제한", "누구나 볼 수 있지만, 글은 운영진만 쓸 수 있어요."],
                ["private", "비공개", "회원만 보고 글을 쓸 수 있어요. 가입 요청이나 초대로만 들어와요."],
              ] as const
            ).map(([value, label, detail]) => (
              <label key={value} className={clsx("flex cursor-pointer items-start gap-3 rounded-xl border p-3", access === value ? "border-accent bg-accent-soft" : "border-line hover:bg-bg")}>
                <input type="radio" name="access" value={value} checked={access === value} onChange={() => setAccess(value)} className="mt-1 h-4 w-4 accent-[rgb(var(--accent))]" />
                <span>
                  <span className="block text-sm font-semibold">{t(label)}</span>
                  <span className="block text-sm text-muted">{t(detail)}</span>
                </span>
              </label>
            ))}
          </div>
          {community.access === "private" && access !== "private" && (
            <p className="mt-2 text-sm font-medium text-accent-strong">{t("비공개를 풀면 기다리던 가입 요청은 모두 승인되고, 보낸 초대는 취소돼요.")}</p>
          )}
          {errors.access && <p className="field-error">{errors.access}</p>}
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mature} onChange={(e) => setMature(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
          {t("성인용 (18+) 커뮤니티 — 인기 피드와 추천에 나오지 않아요")}
        </label>

        {community.flairs.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={requireFlair} onChange={(e) => setRequireFlair(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
            {t("글을 쓸 때 말머리를 반드시 고르게 하기")}
          </label>
        )}
      </section>

      {formError && <p role="alert" className="rounded-lg bg-down/10 px-4 py-3 text-sm font-medium text-down">{formError}</p>}
      <div className="flex items-center justify-end gap-3">
        <span role="status" className="text-sm font-medium text-up">{saved ? (approvedNote ?? t("저장했어요")) : ""}</span>
        <button type="submit" className="btn-primary" disabled={busy}>{t("저장")}</button>
      </div>
    </form>
  );
}
