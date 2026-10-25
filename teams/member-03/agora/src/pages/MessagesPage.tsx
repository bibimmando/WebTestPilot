import { useT } from "@/i18n";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, MailPlus, Send } from "lucide-react";
import { clsx } from "clsx";
import { UserAvatar } from "@/components/UserAvatar";
import { ApiError, api, errorMessage } from "@/lib/api";
import { fullDate, timeAgo } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";
import type { Conversation, Message, UserInfo } from "@/lib/types";
import { NotFoundCard } from "./NotFoundPage";

const MESSAGE_MAX = 1000;

/**
 * 쪽지함.
 *   /messages          대화 목록
 *   /messages/new      새 쪽지 (?to= 로 받는 사람을 미리 채운다)
 *   /messages/:name    한 사람과 주고받은 쪽지
 * 넓은 화면에서는 목록과 대화를 나란히, 좁은 화면에서는 하나씩 보여 준다.
 */
export function MessagesPage({ compose = false }: { compose?: boolean }) {
  const t = useT();
  const { name } = useParams();
  const { user } = useSession();
  const list = useAsync(() => api.get<{ conversations: Conversation[] }>("/api/messages"), [name, compose, user?.unread.messages]);
  const selected = compose || !!name;

  return (
    <div className="card flex h-[calc(100vh-7.5rem)] min-h-[28rem] overflow-hidden">
      <aside className={clsx("w-full flex-col border-r border-line md:flex md:w-72", selected ? "hidden" : "flex")}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h1 className="font-bold">{t("쪽지")}</h1>
          <Link to="/messages/new" className="btn-primary px-3 py-1.5 text-xs">
            <MailPlus className="h-4 w-4" /> {t("새 쪽지")}
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.error ? (
            <p role="alert" className="p-4 text-sm text-down">{errorMessage(list.error)}</p>
          ) : !list.data ? (
            <p className="p-6 text-center text-sm text-muted">{t("불러오는 중…")}</p>
          ) : list.data.conversations.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">{t("주고받은 쪽지가 없어요.")}</p>
          ) : (
            <ul>
              {list.data.conversations.map((c) => (
                <li key={c.with}>
                  <NavLink
                    to={`/messages/${c.with}`}
                    className={({ isActive }) => clsx("flex gap-3 px-4 py-3 hover:bg-bg", isActive && "bg-accent-soft")}
                  >
                    <UserAvatar name={c.with} src={c.avatar} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline justify-between gap-2">
                        <span className={clsx("truncate text-sm", c.unread ? "font-bold" : "font-semibold")}>{c.with}</span>
                        <span className="shrink-0 text-xs text-muted">{timeAgo(c.last.createdAt)}</span>
                      </p>
                      <p className={clsx("truncate text-sm", c.unread ? "text-ink" : "text-muted")}>
                        {c.last.mine && t("나: ")}
                        {c.last.body}
                      </p>
                    </div>
                    {c.unread > 0 && (
                      <span className="mt-1 h-5 min-w-[1.25rem] rounded-full bg-accent px-1.5 text-center text-[11px] font-bold leading-5 text-on-accent" aria-label={t("새 쪽지 {n}개", { n: c.unread })}>
                        {c.unread}
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className={clsx("min-w-0 flex-1 flex-col", selected ? "flex" : "hidden md:flex")}>
        {compose ? (
          <ComposeForm onSent={list.reload} />
        ) : name ? (
          <Thread key={name} name={name} onSent={list.reload} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <MailPlus className="h-10 w-10 text-muted" />
            <p className="font-semibold">{t("대화를 고르거나 새 쪽지를 보내 보세요")}</p>
            <Link to="/messages/new" className="btn-primary">{t("새 쪽지")}</Link>
          </div>
        )}
      </section>
    </div>
  );
}

function BackToList() {
  const t = useT();
  return (
    <Link to="/messages" className="btn-ghost h-9 w-9 p-0 md:hidden" aria-label={t("쪽지 목록으로")}>
      <ArrowLeft className="h-5 w-5" />
    </Link>
  );
}

function Thread({ name, onSent }: { name: string; onSent: () => void }) {
  const t = useT();
  const { refresh } = useSession();
  const { data, error, reload } = useAsync(() => api.get<{ with: UserInfo; items: Message[] }>(`/api/messages/${name}`), [name]);
  const endRef = useRef<HTMLLIElement>(null);

  // 열면 받은 쪽지가 읽음으로 바뀌니, 머리글 숫자를 다시 받는다.
  useEffect(() => {
    if (data) void refresh();
  }, [data, refresh]);
  // 최신 브라우저는 scrollIntoView 가 Promise 를 돌려주므로 화살표 함수가 값을 돌려주지 않게 감싼다.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [data?.items.length]);

  if (error instanceof ApiError && error.status === 404) return <NotFoundCard title={t("u/{name} 사용자를 찾을 수 없어요", { name })} />;
  if (error) return <p role="alert" className="p-6 text-sm text-down">{errorMessage(error)}</p>;
  if (!data) return <p className="p-6 text-center text-sm text-muted">{t("불러오는 중…")}</p>;

  const peer = data.with;
  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <BackToList />
        <UserAvatar name={peer.name} src={peer.avatar} size="md" />
        <div className="min-w-0">
          <h2 className="font-bold">
            <Link to={`/u/${peer.name}`} className="hover:underline">u/{peer.name}</Link>
          </h2>
          {peer.bio && <p className="truncate text-xs text-muted">{peer.bio}</p>}
        </div>
      </header>

      <ol className="flex-1 space-y-2 overflow-y-auto bg-bg/50 px-4 py-4" aria-label={t("u/{name} 와 주고받은 쪽지", { name: peer.name })}>
        {data.items.length === 0 && <li className="py-6 text-center text-sm text-muted">{t("첫 쪽지를 보내 보세요.")}</li>}
        {data.items.map((m) => (
          <li key={m.id} className={clsx("flex", m.mine ? "justify-end" : "justify-start")}>
            <div className={clsx("max-w-[80%] rounded-2xl px-4 py-2", m.mine ? "rounded-br-sm bg-accent text-on-accent" : "rounded-bl-sm border border-line bg-surface")}>
              <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
              <p className={clsx("mt-1 text-[11px]", m.mine ? "text-white/75" : "text-muted")}>
                <time dateTime={m.createdAt} title={fullDate(m.createdAt)}>{timeAgo(m.createdAt)}</time>
                {!m.mine && !m.read && <span className="ml-1.5 font-bold text-accent">{t("새 쪽지")}</span>}
              </p>
            </div>
          </li>
        ))}
        <li ref={endRef} aria-hidden="true" />
      </ol>

      {peer.canMessage ? (
        <ReplyBox
          to={peer.name}
          onSent={() => {
            reload();
            onSent();
          }}
        />
      ) : (
        <p className="border-t border-line px-4 py-3 text-sm text-muted">{t("이 사용자는 쪽지를 받지 않아요.")}</p>
      )}
    </>
  );
}

function ReplyBox({ to, onSent }: { to: string; onSent: () => void }) {
  const t = useT();
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const length = [...text].length;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/messages", { to, body: text });
      setText("");
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.body ?? err.fields.to ?? err.message) : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={send} className="border-t border-line p-3">
      <div className="flex items-end gap-2">
        <label htmlFor={id} className="sr-only">{t("쪽지 내용")}</label>
        <textarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={2}
          placeholder={t("쪽지를 입력하세요 (Shift+Enter 줄바꿈)")}
          className="input flex-1 resize-none"
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button type="submit" className="btn-primary h-10 w-10 p-0" disabled={busy || !text.trim()} aria-label={t("보내기")}>
          <Send className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-1 flex justify-between">
        {error ? <p id={`${id}-error`} role="alert" className="field-error mt-0">{error}</p> : <span />}
        <span className={clsx("text-xs", length > MESSAGE_MAX ? "text-down" : "text-muted")}>{length}/{MESSAGE_MAX}</span>
      </div>
    </form>
  );
}

function ComposeForm({ onSent }: { onSent: () => void }) {
  const t = useT();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [to, setTo] = useState(params.get("to") ?? "");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const length = [...body].length;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      await api.post("/api/messages", { to, body });
      onSent();
      navigate(`/messages/${to.trim().replace(/^u\//, "")}`);
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === "validation") setErrors(err.fields);
      else setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <BackToList />
        <h2 className="font-bold">{t("새 쪽지")}</h2>
      </header>
      <form onSubmit={send} className="flex-1 space-y-4 overflow-y-auto p-5" noValidate>
        <div>
          <label htmlFor="message-to" className="mb-1 block text-sm font-semibold">{t("받는 사람")}</label>
          <input
            id="message-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={t("아이디 (예: alice)")}
            className="input"
            autoComplete="off"
            aria-invalid={!!errors.to}
            aria-describedby={errors.to ? "message-to-error" : undefined}
          />
          {errors.to && <p id="message-to-error" className="field-error">{errors.to}</p>}
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label htmlFor="message-body" className="text-sm font-semibold">{t("내용")}</label>
            <span className={clsx("text-xs", length > MESSAGE_MAX ? "text-down" : "text-muted")}>{length}/{MESSAGE_MAX}</span>
          </div>
          <textarea
            id="message-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="input resize-y"
            placeholder={t("보낼 내용을 입력하세요")}
            aria-invalid={!!errors.body}
            aria-describedby={errors.body ? "message-body-error" : undefined}
          />
          {errors.body && <p id="message-body-error" className="field-error">{errors.body}</p>}
        </div>
        {formError && <p role="alert" className="rounded-lg bg-down/10 px-4 py-3 text-sm font-medium text-down">{formError}</p>}
        <div className="flex justify-end gap-2">
          <Link to="/messages" className="btn-ghost">{t("취소")}</Link>
          <button type="submit" className="btn-primary" disabled={busy}>
            <Send className="h-4 w-4" /> {t("보내기")}
          </button>
        </div>
      </form>
    </>
  );
}
