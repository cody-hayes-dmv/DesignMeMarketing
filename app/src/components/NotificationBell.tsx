import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Loader2, AlertCircle, Building2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import api from "@/lib/api";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string;
  createdAt: string;
}

interface NotificationsResponse {
  unreadCount: number;
  items: NotificationItem[];
}

const NotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await api.get<NotificationsResponse>("/seo/super-admin/notifications");
      setData(res.data);
    } catch {
      setData({ unreadCount: 0, items: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const unreadCount = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
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

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-96 max-h-[28rem] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg z-[100] flex flex-col"
          data-notification-dropdown
        >
          <div className="p-3 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
            {unreadCount > 0 && (
              <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                {unreadCount} pending
              </span>
            )}
          </div>
          <div className="overflow-y-auto flex-1 min-h-0">
            {loading ? (
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
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex gap-3"
                      onClick={() => {
                        setOpen(false);
                        navigate(item.link);
                      }}
                    >
                      <span className="shrink-0 mt-0.5">
                        {item.type === "managed_service_request" ? (
                          <AlertCircle className="h-4 w-4 text-amber-500" />
                        ) : (
                          <Building2 className="h-4 w-4 text-primary-500" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                        <p className="text-xs text-gray-600 truncate">{item.message}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                        </p>
                      </div>
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
                  navigate("/superadmin/dashboard");
                }}
                className="w-full text-center text-xs font-medium text-primary-600 hover:text-primary-700 py-1.5"
              >
                View dashboard
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
