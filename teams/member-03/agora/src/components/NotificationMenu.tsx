import { useT } from "@/i18n";
import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { tr } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useDismiss } from "@/lib/useDismiss";
import { useBug } from "@/lib/bugs";
import type { AppNotification, Unread } from "@/lib/types";
import { NotificationItem } from "./NotificationItem";

export function Badge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      className="absolute -right-0.5 -top-0.5 min-w-[1.125rem] rounded-full bg-down px-1 text-center text-[11px] font-bold leading-[1.125rem] text-white ring-2 ring-surface"
      aria-label={tr("{label} {n}개", { label, n: count })}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** 머리글의 종 모양 버튼. 누르면 최근 알림을 펼친다. */
export function NotificationMenu() {
  const t = useT();
  const { user, refresh } = useSession();
  const bugU2 = useBug("U2");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const unread = user?.unread.notifications ?? 0;

  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    setError(null);
    try {
      const r = await api.get<{ items: AppNotification[] }>("/api/notifications");
      setItems(r.items.slice(0, 6));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const markRead = async (ids?: string[]) => {
    await api.post<{ unread: Unread }>("/api/notifications/read", ids ? { ids } : {});
    setItems((prev) => prev?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) ?? null);
    // 결함 U2: 읽음 처리 뒤 머리글 숫자를 다시 불러오지 않는다
    if (!bugU2) void refresh();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-bg"
        aria-label={t("알림")}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggle}
      >
        <Bell className="h-5 w-5" />
        <Badge count={unread} label={t("읽지 않은 알림")} />
      </button>
      {open && (
        <div className="card absolute right-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-bold">{t("알림")}</h2>
            <button type="button" className="text-xs font-semibold text-accent hover:underline disabled:text-muted disabled:no-underline" disabled={unread === 0} onClick={() => markRead()}>
              {t("모두 읽음으로 표시")}
            </button>
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            {error ? (
              <p role="alert" className="p-4 text-sm text-down">{error}</p>
            ) : !items ? (
              <p className="p-6 text-center text-sm text-muted">{t("불러오는 중…")}</p>
            ) : items.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">{t("아직 알림이 없어요.")}</p>
            ) : (
              items.map((n) => (
                <NotificationItem
                  key={n.id}
                  n={n}
                  compact
                  onOpen={(x) => {
                    setOpen(false);
                    if (!x.read) void markRead([x.id]);
                  }}
                />
              ))
            )}
          </div>
          <Link to="/notifications" onClick={close} className="block border-t border-line px-4 py-2.5 text-center text-sm font-semibold text-accent hover:bg-bg">
            {t("알림 전체 보기")}
          </Link>
        </div>
      )}
    </div>
  );
}
