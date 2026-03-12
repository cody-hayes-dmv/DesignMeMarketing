import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { Bell, Loader2, AlertCircle, Building2, CreditCard, TrendingUp, TrendingDown, CheckCircle2, UserPlus, XCircle, Zap, CheckCheck, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { createPortal } from "react-dom";
import api from "@/lib/api";
import { RootState } from "@/store";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string;
  createdAt: string;
  read: boolean;
}

interface NotificationsResponse {
  unreadCount: number;
  items: NotificationItem[];
}

const NotificationBell: React.FC = () => {
  const DEFAULT_DROPDOWN_WIDTH = 384;
  const VIEWPORT_GUTTER = 8;
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.auth);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);

  const isSuperOrAdmin = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";
  const isClientUser = user?.role === "USER";
  const isSpecialistUser = user?.role === "SPECIALIST";
  const firstClientId = (user as any)?.clientAccess?.clients?.[0]?.clientId;
  const clientDashboardPath = firstClientId ? `/client/dashboard/${firstClientId}` : "/client/tasks";
  const defaultDashboardPath = isSuperOrAdmin
    ? "/superadmin/dashboard"
    : isClientUser
    ? clientDashboardPath
    : isSpecialistUser
    ? "/specialist/dashboard"
    : "/agency/dashboard";
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

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await api.get<NotificationsResponse>(notificationsUrl, { _silent: true } as any);
      setData(res.data);
    } catch {
      // Silently ignore - polling will retry in 5s
    } finally {
      setLoading(false);
    }
  };

  const updateDropdownPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const dropdownWidth = dropdownRef.current?.offsetWidth ?? DEFAULT_DROPDOWN_WIDTH;
    const maxLeft = Math.max(VIEWPORT_GUTTER, window.innerWidth - dropdownWidth - VIEWPORT_GUTTER);
    // Anchor dropdown below bell, with dropdown right edge on bell left edge.
    const preferredLeft = rect.left - dropdownWidth;
    const left = Math.min(Math.max(VIEWPORT_GUTTER, preferredLeft), maxLeft);
    const top = Math.min(rect.bottom + 6, window.innerHeight - VIEWPORT_GUTTER);
    setDropdownPosition({ top, left });
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 5 * 1000);
    return () => clearInterval(interval);
  }, [notificationsUrl]);

  useEffect(() => {
    if (open) updateDropdownPosition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleReposition = () => updateDropdownPosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const targetNode = e.target as Node;
      const clickedInsideDropdown = Boolean(dropdownRef.current?.contains(targetNode));
      const clickedTrigger = Boolean(triggerRef.current?.contains(targetNode));
      if (!clickedInsideDropdown && !clickedTrigger) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleMarkAllRead = async () => {
    setMarkingRead(true);
    try {
      await api.post(markReadUrl, {});
      setData((prev) =>
        prev
          ? { ...prev, unreadCount: 0, items: prev.items.map((i) => ({ ...i, read: true })) }
          : prev
      );
    } catch {
      // ignore
    } finally {
      setMarkingRead(false);
    }
  };

  const handleClickNotification = async (item: NotificationItem) => {
    if (!item.read && !item.id.startsWith("pending-")) {
      try {
        await api.post(markReadUrl, { ids: [item.id] });
        setData((prev) =>
          prev
            ? {
                ...prev,
                unreadCount: Math.max(0, prev.unreadCount - 1),
                items: prev.items.map((i) => (i.id === item.id ? { ...i, read: true } : i)),
              }
            : prev
        );
      } catch {
        // ignore
      }
    }
    setOpen(false);
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
      if (isSuperOrAdmin || user?.role === "AGENCY") {
        const query = new URLSearchParams({
          projectId: webDesignTarget.projectId,
          pageId: webDesignTarget.pageId,
        }).toString();
        navigate(`/agency/web-design?${query}`);
        return;
      }
      if (user?.role === "DESIGNER") {
        const query = new URLSearchParams({
          projectId: webDesignTarget.projectId,
          pageId: webDesignTarget.pageId,
        }).toString();
        navigate(`/designer/web-design?${query}`);
        return;
      }
    }

    // Client portal: respect notification deep-links (e.g. /client/tasks?taskId=...).
    if (isClientUser) {
      navigate(item.link || "/client/tasks");
      return;
    }
    // Agency/specialist panels: respect notification deep-links so
    // task/worklog notifications can open the target modal from URL params.
    if (!isSuperOrAdmin) {
      navigate(item.link || defaultDashboardPath);
      return;
    }
    if (["free_trial_started", "new_signup", "new_agency_signup", "agency_signup"].includes(item.type)) {
      navigate("/agency/agencies");
      return;
    }
    navigate(item.link);
  };

  const unreadCount = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  const getIcon = (type: string) => {
    switch (type) {
      case "task_completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "task_activity":
        return <MessageSquare className="h-4 w-4 text-violet-500" />;
      case "managed_service_request":
        return <AlertCircle className="h-4 w-4 text-amber-500" />;
      case "managed_service_approved":
      case "plan_upgrade":
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case "managed_service_rejected":
      case "plan_downgrade":
        return <TrendingDown className="h-4 w-4 text-gray-500" />;
      case "payment_failed":
        return <CreditCard className="h-4 w-4 text-rose-500" />;
      case "new_signup":
      case "new_agency_signup":
        return <UserPlus className="h-4 w-4 text-blue-500" />;
      case "subscription_activated":
        return <Zap className="h-4 w-4 text-emerald-500" />;
      case "subscription_canceled":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Building2 className="h-4 w-4 text-primary-500" />;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open && !data) fetchNotifications();
        }}
        className="relative p-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed w-96 max-h-[28rem] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg z-[9999] flex flex-col"
            style={{
              top: dropdownPosition?.top ?? 56,
              left:
                dropdownPosition?.left ??
                Math.max(VIEWPORT_GUTTER, window.innerWidth - DEFAULT_DROPDOWN_WIDTH - VIEWPORT_GUTTER),
            }}
            data-notification-dropdown
          >
            <div className="p-3 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="text-[10px] font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5 leading-none">
                    {unreadCount}
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  disabled={markingRead}
                  className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50 transition-colors"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
            </div>
            <div className="overflow-y-auto flex-1 min-h-0">
              {loading && !data ? (
                <div className="flex items-center justify-center py-8 text-gray-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : items.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-500">No notifications</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex gap-3 ${
                          !item.read ? "bg-primary-50/40" : ""
                        }`}
                        onClick={() => handleClickNotification(item)}
                      >
                        <span className="shrink-0 mt-0.5">
                          {getIcon(item.type)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm truncate ${!item.read ? "font-semibold text-gray-900" : "font-medium text-gray-600"}`}>
                            {item.title}
                          </p>
                          <p className={`text-xs truncate ${!item.read ? "text-gray-700" : "text-gray-500"}`}>
                            {item.message}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                        {!item.read && (
                          <span className="shrink-0 mt-2">
                            <span className="block h-2 w-2 rounded-full bg-primary-500" />
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {items.length > 0 && (
              <div className="p-2 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate(defaultDashboardPath);
                  }}
                  className="w-full text-center text-xs font-medium text-primary-600 hover:text-primary-700 py-1.5"
                >
                  View dashboard
                </button>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};

export default NotificationBell;
