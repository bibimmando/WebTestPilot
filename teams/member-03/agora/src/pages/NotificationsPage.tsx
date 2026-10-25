import { useT } from "@/i18n";
import { useSearchParams } from "react-router-dom";
import { CheckCheck } from "lucide-react";
import { clsx } from "clsx";
import { NotificationItem } from "@/components/NotificationItem";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";
import { useBug } from "@/lib/bugs";
import type { AppNotification, Unread } from "@/lib/types";

/** /notifications  알림 전체. ?filter=unread 면 읽지 않은 것만 */
export function NotificationsPage() {
  const t = useT();
  const { refresh } = useSession();
  const bugU2 = useBug("U2");
  const [params, setParams] = useSearchParams();
  const unreadOnly = params.get("filter") === "unread";
  const { data, error, reload, setData } = useAsync(
    () => api.get<{ items: AppNotification[]; unread: Unread }>(`/api/notifications${unreadOnly ? "?filter=unread" : ""}`),
    [unreadOnly],
  );

  const markRead = async (ids?: string[]) => {
    const r = await api.post<{ unread: Unread }>("/api/notifications/read", ids ? { ids } : {});
    setData((prev) => prev && { unread: r.unread, items: prev.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) });
    // 결함 U2: 읽음 처리 뒤 머리글 숫자를 다시 불러오지 않는다
    if (!bugU2) void refresh();
    if (unreadOnly && !ids) reload();
  };

  const unread = data?.unread.notifications ?? 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t("알림")}</h1>
        <button type="button" className="btn-outline py-1.5" disabled={unread === 0} onClick={() => markRead()}>
          <CheckCheck className="h-4 w-4" /> {t("모두 읽음으로 표시")}
        </button>
      </div>

      <div className="mb-3 flex gap-1 border-b border-line" role="tablist">
        {(
          [
            ["all", t("전체")],
            ["unread", `${t("읽지 않음")}${unread ? ` ${unread}` : ""}`],
          ] as const
        ).map(([value, label]) => {
          const selected = (value === "unread") === unreadOnly;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setParams(value === "all" ? {} : { filter: "unread" })}
              className={clsx(
                "-mb-px border-b-2 px-4 py-2 text-sm font-semibold",
                selected ? "border-accent text-accent-strong" : "border-transparent text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="card p-6 text-sm text-down">{t("알림을 불러오지 못했어요.")} {errorMessage(error)}</p>
      ) : !data ? (
        <p className="py-10 text-center text-sm text-muted">{t("불러오는 중…")}</p>
      ) : data.items.length === 0 ? (
        <p className="card p-10 text-center text-sm text-muted">{t(unreadOnly ? "읽지 않은 알림이 없어요." : "아직 알림이 없어요.")}</p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {data.items.map((n) => (
            <li key={n.id}>
              <NotificationItem n={n} onOpen={(x) => !x.read && void markRead([x.id])} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
