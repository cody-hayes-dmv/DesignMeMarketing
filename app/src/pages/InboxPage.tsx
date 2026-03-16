import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck, CheckCircle2, Loader2, MessageSquare, PenTool } from "lucide-react";
import { RootState } from "@/store";
import api from "@/lib/api";

type InboxItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string;
  createdAt: string;
  read: boolean;
};

type NotificationsResponse = {
  unreadCount: number;
  items: InboxItem[];
};

const COMMUNICATION_TYPES = new Set([
  "task_activity",
  "task_completed",
  "web_design_activity",
]);

function getInboxItemTheme(type: string) {
  if (type === "web_design_activity") {
    return {
      label: "Web Design",
      chipClass: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200",
      unreadAccentClass: "from-fuchsia-50 to-violet-50 border-fuchsia-200",
      icon: PenTool,
      iconClass: "text-fuchsia-600",
      dotClass: "bg-fuchsia-500",
    };
  }
  if (type === "task_completed") {
    return {
      label: "Completed",
      chipClass: "bg-emerald-100 text-emerald-700 border-emerald-200",
      unreadAccentClass: "from-emerald-50 to-lime-50 border-emerald-200",
      icon: CheckCircle2,
      iconClass: "text-emerald-600",
      dotClass: "bg-emerald-500",
    };
  }
  return {
    label: "Activity",
    chipClass: "bg-sky-100 text-sky-700 border-sky-200",
    unreadAccentClass: "from-sky-50 to-indigo-50 border-sky-200",
    icon: MessageSquare,
    iconClass: "text-sky-600",
    dotClass: "bg-sky-500",
  };
}

export default function InboxPage() {
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.auth);
  const [loading, setLoading] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<"all" | "unread" | "web_design" | "tasks">("all");

  const isSuperOrAdmin = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";
  const isClientUser = user?.role === "USER";
  const firstClientId = (user as any)?.clientAccess?.clients?.[0]?.clientId;

  const notificationsUrl = isSuperOrAdmin ? "/seo/super-admin/notifications" : "/agencies/me/notifications";
  const markReadUrl = isSuperOrAdmin ? "/seo/super-admin/notifications/mark-read" : "/agencies/me/notifications/mark-read";

  const parseWebDesignLink = (link: string): { projectId: string; pageId: string } | null => {
    const match = String(link || "").match(/^\/web-design\/projects\/([^/]+)\/pages\/([^/?#]+)/);
    if (!match) return null;
    return { projectId: decodeURIComponent(match[1]), pageId: decodeURIComponent(match[2]) };
  };

  const resolveClientIdForWebDesignProject = async (projectId: string): Promise<string | null> => {
    try {
      const res = await api.get(`/web-design/projects/${encodeURIComponent(projectId)}`, { _silent: true } as any);
      const project = res?.data as { client?: { id?: string | null }; clientId?: string | null } | undefined;
      const candidate = String(project?.client?.id || project?.clientId || "").trim();
      return candidate || null;
    } catch {
      return null;
    }
  };

  const fetchInbox = async () => {
    setLoading(true);
    try {
      const res = await api.get<NotificationsResponse>(notificationsUrl, { _silent: true } as any);
      const rows = Array.isArray(res.data?.items) ? res.data.items : [];
      const communicationOnly = rows.filter((row) => COMMUNICATION_TYPES.has(String(row.type || "")));
      communicationOnly.sort((a, b) => {
        if (a.read !== b.read) return a.read ? 1 : -1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      setItems(communicationOnly);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInbox().catch(() => setItems([]));
    const intervalId = window.setInterval(() => {
      fetchInbox().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [notificationsUrl]);

  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);
  const filteredItems = useMemo(() => {
    if (activeFilter === "unread") {
      return items.filter((item) => !item.read);
    }
    if (activeFilter === "web_design") {
      return items.filter((item) => item.type === "web_design_activity");
    }
    if (activeFilter === "tasks") {
      return items.filter((item) => item.type === "task_activity" || item.type === "task_completed");
    }
    return items;
  }, [activeFilter, items]);
  const filterCounts = useMemo(
    () => ({
      all: items.length,
      unread: items.filter((item) => !item.read).length,
      web_design: items.filter((item) => item.type === "web_design_activity").length,
      tasks: items.filter((item) => item.type === "task_activity" || item.type === "task_completed").length,
    }),
    [items]
  );

  const markAsRead = async (ids?: string[]) => {
    await api.post(markReadUrl, ids && ids.length ? { ids } : {});
    if (!ids?.length) {
      setItems((prev) => prev.map((item) => ({ ...item, read: true })));
      return;
    }
    const idSet = new Set(ids);
    setItems((prev) => prev.map((item) => (idSet.has(item.id) ? { ...item, read: true } : item)));
  };

  const handleMarkAllRead = async () => {
    setMarkingRead(true);
    try {
      const unreadIds = items.filter((item) => !item.read).map((item) => item.id).filter((id) => !id.startsWith("pending-"));
      if (unreadIds.length) {
        await markAsRead(unreadIds);
      }
    } finally {
      setMarkingRead(false);
    }
  };

  const handleOpenItem = async (item: InboxItem) => {
    if (!item.read && !item.id.startsWith("pending-")) {
      await markAsRead([item.id]).catch(() => undefined);
    }

    const webDesignTarget = parseWebDesignLink(item.link || "");
    if (webDesignTarget) {
      if (isClientUser) {
        const resolvedClientId = await resolveClientIdForWebDesignProject(webDesignTarget.projectId);
        const targetClientId = resolvedClientId || firstClientId;
        if (!targetClientId) {
          navigate("/client/tasks");
          return;
        }
        navigate(`/client/dashboard/${encodeURIComponent(targetClientId)}`, {
          state: {
            tab: "web-design",
            projectId: webDesignTarget.projectId,
            pageId: webDesignTarget.pageId,
          },
        });
        return;
      }
      navigate(`/agency/web-design?projectId=${encodeURIComponent(webDesignTarget.projectId)}&pageId=${encodeURIComponent(webDesignTarget.pageId)}`);
      return;
    }

    if (item.link) {
      navigate(item.link);
      return;
    }
    navigate(isClientUser ? "/client/tasks" : "/agency/tasks");
  };

  return (
    <div className="p-6 md:p-8">
      <div className="w-full overflow-hidden rounded-2xl border border-indigo-100 bg-white shadow-sm">
        <div className="relative border-b border-indigo-100 px-5 py-4 bg-gradient-to-r from-indigo-50 via-sky-50 to-violet-50">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(99,102,241,0.18),_transparent_40%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.15),_transparent_35%)]" />
          <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-indigo-600" />
            <h1 className="text-lg font-semibold text-gray-900">Inbox</h1>
            {unreadCount > 0 && (
              <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white shadow-sm">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={markingRead}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
        </div>
        </div>

        <div className="border-b border-indigo-100 px-4 py-2.5">
          <div className="flex flex-wrap gap-2">
            {[
              { id: "all" as const, label: "All", className: "border-gray-200 text-gray-700 hover:bg-gray-50" },
              { id: "unread" as const, label: "Unread", className: "border-rose-200 text-rose-700 hover:bg-rose-50" },
              { id: "web_design" as const, label: "Web Design", className: "border-fuchsia-200 text-fuchsia-700 hover:bg-fuchsia-50" },
              { id: "tasks" as const, label: "Tasks", className: "border-sky-200 text-sky-700 hover:bg-sky-50" },
            ].map((filter) => {
              const selected = activeFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setActiveFilter(filter.id)}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    selected ? "bg-indigo-600 text-white border-indigo-600" : filter.className
                  }`}
                >
                  <span>{filter.label}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                      selected ? "bg-white/20 text-white" : "bg-white/80 text-gray-600"
                    }`}
                  >
                    {filterCounts[filter.id]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {loading && filteredItems.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            <Bell className="mx-auto mb-2 h-6 w-6 text-gray-400" />
            No messages in this filter.
          </div>
        ) : (
          <ul className="space-y-2 p-2 sm:p-3">
            {filteredItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => handleOpenItem(item)}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                    item.read
                      ? "bg-white border-gray-100 hover:bg-gray-50"
                      : `bg-gradient-to-r ${getInboxItemTheme(item.type).unreadAccentClass} border`
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center gap-2">
                        {(() => {
                          const theme = getInboxItemTheme(item.type);
                          const TypeIcon = theme.icon;
                          return (
                            <>
                              <TypeIcon className={`h-3.5 w-3.5 ${theme.iconClass}`} />
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${theme.chipClass}`}>
                                {theme.label}
                              </span>
                            </>
                          );
                        })()}
                      </div>
                      <p className={`truncate text-sm ${item.read ? "font-medium text-gray-700" : "font-semibold text-gray-900"}`}>
                        {item.title}
                      </p>
                      <p className={`mt-1 truncate text-xs ${item.read ? "text-gray-500" : "text-gray-700"}`}>
                        {item.message}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!item.read && <span className={`h-2 w-2 rounded-full ${getInboxItemTheme(item.type).dotClass}`} />}
                      <span className="whitespace-nowrap text-[11px] text-gray-400">
                        {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
