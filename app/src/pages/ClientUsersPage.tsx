import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { ChevronDown, Eye, EyeOff, MoreVertical, Plus, Users, UserPlus, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import { checkAuth } from "@/store/slices/authSlice";
import ConfirmDialog from "@/components/ConfirmDialog";

type ClientUserRow = {
  id: string;
  clientId: string;
  clientName: string;
  clientDomain: string;
  userId: string;
  email: string;
  name: string | null;
  role: "CLIENT" | "STAFF";
  status: "PENDING" | "ACTIVE";
  lastLoginAt: string | null;
};

type ClientOption = {
  id: string;
  name: string;
  domain?: string | null;
};

const ClientUsersPage: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [rows, setRows] = useState<ClientUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Edit Profile modal state
  const [editClientUserProfileOpen, setEditClientUserProfileOpen] = useState(false);
  const [editClientUserProfileUser, setEditClientUserProfileUser] = useState<{
    userId: string;
    email: string;
    name: string | null;
  } | null>(null);
  const [editClientUserProfileClientId, setEditClientUserProfileClientId] = useState<string | null>(null);
  const [editClientUserFirstName, setEditClientUserFirstName] = useState("");
  const [editClientUserLastName, setEditClientUserLastName] = useState("");
  const [editClientUserPassword, setEditClientUserPassword] = useState("");
  const [editClientUserPasswordVisible, setEditClientUserPasswordVisible] = useState(false);
  const [editClientUserEmailCredentials, setEditClientUserEmailCredentials] = useState<"YES" | "NO">("NO");
  const [savingClientUserProfile, setSavingClientUserProfile] = useState(false);

  // Edit Client Access modal state
  const [editClientAccessOpen, setEditClientAccessOpen] = useState(false);
  const [editClientAccessUser, setEditClientAccessUser] = useState<{
    userId: string;
    email: string;
    name: string | null;
  } | null>(null);
  const [editClientAccessSearch, setEditClientAccessSearch] = useState("");
  const [editClientAccessClients, setEditClientAccessClients] = useState<Array<{ id: string; name: string; domain?: string }>>(
    []
  );
  const [editClientAccessSelected, setEditClientAccessSelected] = useState<Set<string>>(new Set());
  const [editClientAccessLoading, setEditClientAccessLoading] = useState(false);
  const [editClientAccessSaving, setEditClientAccessSaving] = useState(false);

  const fetchAllUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get("/clients/users");
      setRows(Array.isArray(res.data) ? (res.data as ClientUserRow[]) : []);
    } catch (e: any) {
      console.error("Failed to load client users", e);
      setRows([]);
      setError(e?.response?.data?.message || "Failed to load users.");
      toast.error(e?.response?.data?.message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAllUsers();
  }, [fetchAllUsers]);

  // Invite modal state (multi-client invites)
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteSendEmail, setInviteSendEmail] = useState(true);
  const [inviteRows, setInviteRows] = useState<Array<{ id: string; email: string; clientIds: string[] }>>([
    { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, email: "", clientIds: [] },
  ]);

  const [allClients, setAllClients] = useState<ClientOption[]>([]);
  const [allClientsLoading, setAllClientsLoading] = useState(false);
  const [allClientsError, setAllClientsError] = useState<string | null>(null);

  const inviteClientsMenuButtonRef = useRef<HTMLElement | null>(null);
  const [inviteClientsMenu, setInviteClientsMenu] = useState<{
    rowId: string;
    rect: { top: number; left: number; right: number; bottom: number; width: number; height: number };
  } | null>(null);

  const openInviteModal = useCallback(() => {
    setInviteRows([{ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, email: "", clientIds: [] }]);
    setInviteSendEmail(true);
    setInviteClientsMenu(null);
    setInviteOpen(true);
  }, []);

  useEffect(() => {
    if (!inviteOpen) return;
    const run = async () => {
      try {
        setAllClientsLoading(true);
        setAllClientsError(null);
        const res = await api.get("/clients");
        const arr = Array.isArray(res.data) ? (res.data as any[]) : [];
        setAllClients(
          arr
            .map((c) => ({ id: String(c.id), name: String(c.name || ""), domain: c.domain ? String(c.domain) : null }))
            .filter((c) => c.id && c.name)
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      } catch (e: any) {
        console.error("Failed to load clients for invite", e);
        setAllClients([]);
        setAllClientsError(e?.response?.data?.message || "Failed to load clients.");
      } finally {
        setAllClientsLoading(false);
      }
    };
    void run();
  }, [inviteOpen]);

  useEffect(() => {
    if (!inviteClientsMenu) return;

    const getRect = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };

    const syncPosition = () => {
      const el = inviteClientsMenuButtonRef.current;
      if (!el) return;
      setInviteClientsMenu((prev) => (prev ? { ...prev, rect: getRect(el) } : prev));
    };

    const onDocClick = () => setInviteClientsMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInviteClientsMenu(null);
    };

    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [inviteClientsMenu]);

  const submitInvites = useCallback(async () => {
    const cleaned = inviteRows
      .map((r) => ({ ...r, email: r.email.trim(), clientIds: Array.from(new Set(r.clientIds)) }))
      .filter((r) => r.email || r.clientIds.length > 0);

    if (cleaned.length === 0) {
      toast.error("Add at least one invite row.");
      return;
    }
    for (const r of cleaned) {
      if (!r.email) {
        toast.error("Please enter an email for each row.");
        return;
      }
      if (r.clientIds.length === 0) {
        toast.error("Please select at least one client for each row.");
        return;
      }
    }

    try {
      setInviting(true);
      await api.post("/clients/users/invite", {
        invites: cleaned.map((r) => ({ email: r.email, clientIds: r.clientIds })),
        sendEmail: inviteSendEmail,
        clientRole: "CLIENT",
      });
      toast.success("Invite(s) created successfully.");
      setInviteOpen(false);
      setInviteClientsMenu(null);
      await fetchAllUsers();
    } catch (e: any) {
      console.error("Failed to invite users", e);
      toast.error(e?.response?.data?.message || "Failed to send invites.");
    } finally {
      setInviting(false);
    }
  }, [fetchAllUsers, inviteRows, inviteSendEmail]);

  // Row "More" menu
  const clientUserMoreMenuButtonRef = useRef<HTMLElement | null>(null);
  const [clientUserMoreMenu, setClientUserMoreMenu] = useState<{
    id: string; // client_users row id
    rect: { top: number; left: number; right: number; bottom: number; width: number; height: number };
  } | null>(null);

  const [removeClientUserConfirm, setRemoveClientUserConfirm] = useState<{
    open: boolean;
    clientId: string;
    userId: string;
    label: string;
  }>({ open: false, clientId: "", userId: "", label: "" });

  useEffect(() => {
    if (!clientUserMoreMenu) return;

    const getRect = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };

    const syncPosition = () => {
      const el = clientUserMoreMenuButtonRef.current;
      if (!el) return;
      setClientUserMoreMenu((prev) => (prev ? { ...prev, rect: getRect(el) } : prev));
    };

    const onDocClick = () => setClientUserMoreMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setClientUserMoreMenu(null);
    };

    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [clientUserMoreMenu]);

  const resendInviteForClientUser = useCallback(
    async (u: ClientUserRow) => {
      try {
        await api.post(`/clients/${encodeURIComponent(u.clientId)}/users/${encodeURIComponent(u.userId)}/invite`);
        toast.success("Invite sent.");
        await fetchAllUsers();
      } catch (e: any) {
        console.error("Failed to resend invite", e);
        toast.error(e?.response?.data?.message || "Failed to send invite.");
      }
    },
    [fetchAllUsers]
  );

  const loginAsClientUser = useCallback(
    async (u: ClientUserRow) => {
      try {
        const res = await api.post(
          `/clients/${encodeURIComponent(u.clientId)}/users/${encodeURIComponent(u.userId)}/impersonate`
        );
        const token = res?.data?.token as string | undefined;
        if (!token) {
          toast.error("Unable to impersonate user.");
          return;
        }
        localStorage.setItem("token", token);
        await dispatch(checkAuth() as any);
        navigate(`/client/dashboard/${encodeURIComponent(u.clientId)}`);
        toast.success("Logged in as user.");
      } catch (e: any) {
        console.error("Failed to impersonate user", e);
        toast.error(e?.response?.data?.message || "Failed to login as user.");
      }
    },
    [dispatch, navigate]
  );

  const removeClientUser = useCallback(async () => {
    const { clientId, userId } = removeClientUserConfirm;
    if (!clientId || !userId) return;
    try {
      await api.delete(`/clients/${encodeURIComponent(clientId)}/users/${encodeURIComponent(userId)}`);
      toast.success("User removed.");
      setRemoveClientUserConfirm({ open: false, clientId: "", userId: "", label: "" });
      await fetchAllUsers();
    } catch (e: any) {
      console.error("Failed to remove user", e);
      toast.error(e?.response?.data?.message || "Failed to remove user.");
    }
  }, [fetchAllUsers, removeClientUserConfirm]);

  const openEditClientUserProfile = useCallback((u: ClientUserRow) => {
    const rawName = String(u.name || "").trim();
    const fallback = u.email.split("@")[0] || "";
    const base = rawName || fallback;
    const parts = base.split(/\s+/g).filter(Boolean);
    const first = parts[0] || "";
    const last = parts.slice(1).join(" ");

    setEditClientUserProfileClientId(u.clientId);
    setEditClientUserProfileUser({ userId: u.userId, email: u.email, name: u.name });
    setEditClientUserFirstName(first);
    setEditClientUserLastName(last);
    setEditClientUserPassword("");
    setEditClientUserPasswordVisible(false);
    setEditClientUserEmailCredentials("NO");
    setEditClientUserProfileOpen(true);
  }, []);

  const generateRandomPassword = useCallback(() => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
    const len = 12;
    let out = "";
    for (let i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
    setEditClientUserPassword(out);
    setEditClientUserPasswordVisible(true);
  }, []);

  const saveClientUserProfile = useCallback(async () => {
    if (!editClientUserProfileClientId) return;
    if (!editClientUserProfileUser?.userId) return;
    if (!editClientUserFirstName.trim()) {
      toast.error("First name is required.");
      return;
    }
    const wantsEmailCredentials = editClientUserEmailCredentials === "YES";
    if (wantsEmailCredentials && editClientUserPassword.trim().length < 6) {
      toast.error("Enter a password (min 6) to email credentials.");
      return;
    }

    try {
      setSavingClientUserProfile(true);
      await api.put(
        `/clients/${encodeURIComponent(editClientUserProfileClientId)}/users/${encodeURIComponent(
          editClientUserProfileUser.userId
        )}/profile`,
        {
          firstName: editClientUserFirstName.trim(),
          lastName: editClientUserLastName.trim(),
          password: editClientUserPassword.trim() ? editClientUserPassword.trim() : undefined,
          emailCredentials: wantsEmailCredentials,
        }
      );
      toast.success("User updated.");
      setEditClientUserProfileOpen(false);
      setEditClientUserProfileUser(null);
      setEditClientUserProfileClientId(null);
      await fetchAllUsers();
    } catch (e: any) {
      console.error("Failed to update client user profile", e);
      toast.error(e?.response?.data?.message || "Failed to update user.");
    } finally {
      setSavingClientUserProfile(false);
    }
  }, [
    editClientUserEmailCredentials,
    editClientUserFirstName,
    editClientUserLastName,
    editClientUserPassword,
    editClientUserProfileClientId,
    editClientUserProfileUser?.userId,
    fetchAllUsers,
  ]);

  const openEditClientAccess = useCallback(async (u: ClientUserRow) => {
    try {
      setEditClientAccessOpen(true);
      setEditClientAccessUser({ userId: u.userId, email: u.email, name: u.name });
      setEditClientAccessSearch("");
      setEditClientAccessLoading(true);

      const [clientsRes, accessRes] = await Promise.all([
        api.get("/clients"),
        api.get(`/clients/users/${encodeURIComponent(u.userId)}/access`),
      ]);

      const all = Array.isArray(clientsRes.data) ? clientsRes.data : [];
      setEditClientAccessClients(
        all.map((c: any) => ({
          id: String(c.id),
          name: String(c.name || c.domain || c.id),
          domain: String(c.domain || ""),
        }))
      );

      const selectedIds = new Set<string>();
      const accessClients = accessRes.data?.clients as Array<{ clientId: string }> | undefined;
      if (Array.isArray(accessClients)) {
        for (const r of accessClients) {
          if (r?.clientId) selectedIds.add(String(r.clientId));
        }
      }
      setEditClientAccessSelected(selectedIds);
    } catch (e: any) {
      console.error("Failed to load client access", e);
      toast.error(e?.response?.data?.message || "Failed to load client access.");
      setEditClientAccessOpen(false);
      setEditClientAccessUser(null);
    } finally {
      setEditClientAccessLoading(false);
    }
  }, []);

  const saveEditClientAccess = useCallback(async () => {
    if (!editClientAccessUser?.userId) return;
    try {
      setEditClientAccessSaving(true);
      await api.put(`/clients/users/${encodeURIComponent(editClientAccessUser.userId)}/access`, {
        clientIds: Array.from(editClientAccessSelected),
      });
      toast.success("Client access updated.");
      setEditClientAccessOpen(false);
      setEditClientAccessUser(null);
      await fetchAllUsers();
    } catch (e: any) {
      console.error("Failed to update client access", e);
      toast.error(e?.response?.data?.message || "Failed to update client access.");
    } finally {
      setEditClientAccessSaving(false);
    }
  }, [editClientAccessSelected, editClientAccessUser?.userId, fetchAllUsers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.name || "",
        r.email,
        r.clientName,
        r.clientDomain,
        r.role,
        r.status,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-sky-50/30 p-8">
      <div className="relative mb-10 overflow-hidden rounded-2xl bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-500 p-8 shadow-lg">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNnKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white md:text-3xl">Users</h1>
            <p className="mt-2 text-sky-100 text-sm md:text-base">All client portal users across your clients.</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full max-w-sm rounded-lg border-0 bg-white/20 px-4 py-2.5 text-sm text-white placeholder-white/60 backdrop-blur-sm focus:ring-2 focus:ring-white/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={openInviteModal}
              className="inline-flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
            >
              <Plus className="h-4 w-4" />
              Invite User
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Showing {filtered.length} of {rows.length} Rows
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider border-l-4 border-primary-400 first:border-l-0">Name</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-emerald-800 uppercase tracking-wider border-l-4 border-emerald-300">Email</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-amber-800 uppercase tracking-wider border-l-4 border-amber-300">Client</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Role</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Status</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Last Login</th>
                <th className="px-6 py-3.5 text-right text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-gray-500 bg-gray-50/50">
                    Loading users...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-rose-600 bg-rose-50/50">
                    {error}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-gray-500 bg-amber-50/50">
                    No users found.
                  </td>
                </tr>
              ) : (
                filtered.map((u, index) => {
                  const initials = (u.name || u.email || "?")
                    .split(" ")
                    .map((p) => p.trim()[0] || "")
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();
                  const lastLogin = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never";
                  return (
                    <tr key={u.id} className={`transition-colors ${index % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-primary-50/50`}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-primary-100 flex items-center justify-center text-xs font-semibold text-primary-700">
                            {initials}
                          </div>
                          <div className="text-sm font-semibold text-gray-900">{u.name || u.email}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-emerald-800/90">{u.email}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="font-medium text-amber-900/90">{u.clientName}</div>
                        <div className="text-xs text-gray-500">{u.clientDomain}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-violet-100 text-violet-800">
                          {u.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            u.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{lastLogin}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="relative inline-block">
                          <button
                            type="button"
                            className="inline-flex items-center justify-center h-9 w-9 rounded-lg hover:bg-violet-50 hover:text-violet-600 text-gray-500 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              const el = e.currentTarget as unknown as HTMLElement;
                              clientUserMoreMenuButtonRef.current = el;
                              const r = el.getBoundingClientRect();
                              setClientUserMoreMenu((prev) =>
                                prev?.id === u.id
                                  ? null
                                  : {
                                      id: u.id,
                                      rect: {
                                        top: r.top,
                                        left: r.left,
                                        right: r.right,
                                        bottom: r.bottom,
                                        width: r.width,
                                        height: r.height,
                                      },
                                    }
                              );
                            }}
                            title="More"
                          >
                            <MoreVertical className="h-5 w-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {clientUserMoreMenu &&
        typeof window !== "undefined" &&
        createPortal(
          (() => {
            const menuWidth = 224; // w-56
            const menuMaxHeight = 320;
            const gap = 8;

            const u = rows.find((x) => x.id === clientUserMoreMenu.id) || null;

            const rightEdge = Math.min(
              Math.max(clientUserMoreMenu.rect.right, menuWidth + gap),
              window.innerWidth - gap
            );
            const top = Math.min(
              clientUserMoreMenu.rect.bottom + gap,
              Math.max(gap, window.innerHeight - gap - menuMaxHeight)
            );

            return (
              <div className="fixed inset-0 z-[999]" onClick={() => setClientUserMoreMenu(null)}>
                <div
                  className="absolute rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden"
                  style={{
                    top,
                    left: rightEdge,
                    transform: "translateX(-100%)",
                    width: menuWidth,
                    maxHeight: menuMaxHeight,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => {
                      if (u) openEditClientUserProfile(u);
                      else toast.error("Unable to load user.");
                      setClientUserMoreMenu(null);
                    }}
                  >
                    Edit Profile
                  </button>
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => {
                      if (u) void openEditClientAccess(u);
                      else toast.error("Unable to load user.");
                      setClientUserMoreMenu(null);
                    }}
                  >
                    Edit Client Access
                  </button>
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => {
                      toast("Edit Permissions coming soon.");
                      setClientUserMoreMenu(null);
                    }}
                  >
                    Edit Permissions
                  </button>
                  <div className="h-px bg-gray-100" />
                  {u?.status === "PENDING" && (
                    <button
                      type="button"
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      onClick={() => {
                        if (u) void resendInviteForClientUser(u);
                        else toast.error("Unable to load user.");
                        setClientUserMoreMenu(null);
                      }}
                    >
                      Send Invite
                    </button>
                  )}
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => {
                      if (u) void loginAsClientUser(u);
                      else toast.error("Unable to load user.");
                      setClientUserMoreMenu(null);
                    }}
                  >
                    Login as user
                  </button>
                  <div className="h-px bg-gray-100" />
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-rose-50"
                    onClick={() => {
                      if (!u) {
                        toast.error("Unable to load user.");
                        setClientUserMoreMenu(null);
                        return;
                      }
                      setRemoveClientUserConfirm({
                        open: true,
                        clientId: u.clientId,
                        userId: u.userId,
                        label: u.name || u.email,
                      });
                      setClientUserMoreMenu(null);
                    }}
                  >
                    Remove user
                  </button>
                </div>
              </div>
            );
          })(),
          document.body
        )}

      <ConfirmDialog
        isOpen={removeClientUserConfirm.open}
        title="Remove user?"
        message={`Are you sure you want to remove ${removeClientUserConfirm.label} from this client?`}
        confirmText="Remove"
        cancelText="Cancel"
        onClose={() => setRemoveClientUserConfirm({ open: false, clientId: "", userId: "", label: "" })}
        onConfirm={() => void removeClientUser()}
        variant="danger"
      />

      {editClientUserProfileOpen &&
        editClientUserProfileUser &&
        typeof window !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => !savingClientUserProfile && setEditClientUserProfileOpen(false)}
            />
            <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
              <button
                type="button"
                className="absolute top-4 right-4 h-10 w-10 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 inline-flex items-center justify-center"
                onClick={() => !savingClientUserProfile && setEditClientUserProfileOpen(false)}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="px-10 py-10">
                <h2 className="text-3xl font-bold text-gray-900 text-center">What are the login details for this user?</h2>
                <p className="mt-3 text-sm text-gray-600 text-center">
                  Fill in the contact details for this user and optionally upload a picture
                </p>

                <div className="mt-8 border-t border-gray-200 pt-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">First Name</label>
                      <input
                        type="text"
                        value={editClientUserFirstName}
                        onChange={(e) => setEditClientUserFirstName(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Last Name</label>
                      <input
                        type="text"
                        value={editClientUserLastName}
                        onChange={(e) => setEditClientUserLastName(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                      <input
                        type="email"
                        value={editClientUserProfileUser.email}
                        disabled
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium text-gray-700">Password</label>
                        <button
                          type="button"
                          className="text-sm text-primary-600 hover:text-primary-700"
                          onClick={() => generateRandomPassword()}
                        >
                          Generate
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          type={editClientUserPasswordVisible ? "text" : "password"}
                          value={editClientUserPassword}
                          onChange={(e) => setEditClientUserPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm pr-10"
                        />
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                          onClick={() => setEditClientUserPasswordVisible((v) => !v)}
                          aria-label="Toggle password visibility"
                        >
                          {editClientUserPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Email Login Credentials</label>
                      <select
                        value={editClientUserEmailCredentials}
                        onChange={(e) => setEditClientUserEmailCredentials(e.target.value as any)}
                        disabled={!editClientUserPassword.trim()}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50"
                      >
                        <option value="NO">No</option>
                        <option value="YES">Yes</option>
                      </select>
                      {!editClientUserPassword.trim() && (
                        <p className="mt-1 text-xs text-gray-500">Enter a password to enable this option.</p>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Photo</label>
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600">
                          <Users className="h-5 w-5" />
                        </div>
                        <button
                          type="button"
                          className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200"
                          onClick={() => toast("Photo upload coming soon.")}
                        >
                          Upload New Picture
                        </button>
                        <button
                          type="button"
                          className="text-sm text-rose-600 hover:text-rose-700"
                          onClick={() => toast("Photo delete coming soon.")}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-12">
                    <button
                      type="button"
                      disabled={savingClientUserProfile}
                      onClick={() => void saveClientUserProfile()}
                      className="px-10 py-3 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60"
                    >
                      {savingClientUserProfile ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {editClientAccessOpen &&
        editClientAccessUser &&
        typeof window !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => !editClientAccessSaving && setEditClientAccessOpen(false)}
            />
            <div className="relative w-full max-w-5xl rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
              <button
                type="button"
                className="absolute top-4 right-4 h-10 w-10 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 inline-flex items-center justify-center"
                onClick={() => !editClientAccessSaving && setEditClientAccessOpen(false)}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="px-10 py-10">
                <h2 className="text-3xl font-bold text-gray-900 text-center">Which clients should this user have access to?</h2>
                <p className="mt-3 text-sm text-gray-600 text-center">
                  Choose to restrict this user to specific clients in order to control what they have access to
                </p>

                <div className="mt-8 border-t border-gray-200 pt-8">
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-200 bg-white">
                      <input
                        type="text"
                        value={editClientAccessSearch}
                        onChange={(e) => setEditClientAccessSearch(e.target.value)}
                        placeholder="Search..."
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>

                    <div className="max-h-[360px] overflow-y-auto">
                      {editClientAccessLoading ? (
                        <div className="px-6 py-10 text-center text-sm text-gray-500">Loading clients...</div>
                      ) : (
                        editClientAccessClients
                          .filter((c) => {
                            const q = editClientAccessSearch.trim().toLowerCase();
                            if (!q) return true;
                            return c.name.toLowerCase().includes(q) || String(c.domain || "").toLowerCase().includes(q);
                          })
                          .map((c) => {
                            const checked = editClientAccessSelected.has(c.id);
                            return (
                              <button
                                key={c.id}
                                type="button"
                                className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                                onClick={() =>
                                  setEditClientAccessSelected((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(c.id)) next.delete(c.id);
                                    else next.add(c.id);
                                    return next;
                                  })
                                }
                              >
                                <div className="flex items-center gap-4">
                                  <div
                                    className={`h-8 w-8 rounded-full flex items-center justify-center border ${
                                      checked ? "bg-primary-600 border-primary-600" : "bg-white border-gray-300"
                                    }`}
                                  >
                                    {checked && <span className="text-white text-sm font-bold">✓</span>}
                                  </div>
                                  <div className="text-left">
                                    <div className="text-sm font-medium text-gray-900">{c.name}</div>
                                  </div>
                                </div>
                                <div className="text-sm text-gray-400 truncate max-w-[50%]">
                                  {c.domain ? `https://${c.domain}/` : ""}
                                </div>
                              </button>
                            );
                          })
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-10">
                  <button
                    type="button"
                    disabled={editClientAccessSaving}
                    onClick={() => void saveEditClientAccess()}
                    className="px-10 py-3 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60"
                  >
                    {editClientAccessSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {inviteOpen &&
        typeof window !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setInviteOpen(false)} />
            <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl ring-1 ring-gray-200/80 overflow-hidden flex flex-col max-h-[90vh]">
              <div className="shrink-0 px-8 py-5 flex items-center justify-between bg-gradient-to-r from-primary-600 via-primary-500 to-blue-600 text-white rounded-t-2xl">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20">
                    <UserPlus className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Invite User</h2>
                    <p className="text-sm text-white/90 mt-0.5">Invite users to one or more client dashboards.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  className="h-10 w-10 inline-flex items-center justify-center rounded-lg text-white/90 hover:bg-white/20 hover:text-white"
                  title="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6 bg-gray-50/50">
                {allClientsError && (
                  <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {allClientsError}
                  </div>
                )}

                <div className="rounded-xl border-l-4 border-blue-500 bg-blue-50/50 p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-blue-900 mb-4 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    Invite Rows
                  </h3>
                <div className="space-y-4">
                  {inviteRows.map((row) => (
                    <div key={row.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-start">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                        <input
                          type="email"
                          value={row.email}
                          onChange={(e) =>
                            setInviteRows((prev) =>
                              prev.map((r) => (r.id === row.id ? { ...r, email: e.target.value } : r))
                            )
                          }
                          placeholder="Type user's email"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Clients</label>
                        <button
                          type="button"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white flex items-center justify-between gap-2 hover:bg-gray-50 disabled:opacity-60"
                          disabled={allClientsLoading}
                          onClick={(e) => {
                            e.stopPropagation();
                            const el = e.currentTarget as unknown as HTMLElement;
                            inviteClientsMenuButtonRef.current = el;
                            const r = el.getBoundingClientRect();
                            setInviteClientsMenu((prev) =>
                              prev?.rowId === row.id
                                ? null
                                : {
                                    rowId: row.id,
                                    rect: {
                                      top: r.top,
                                      left: r.left,
                                      right: r.right,
                                      bottom: r.bottom,
                                      width: r.width,
                                      height: r.height,
                                    },
                                  }
                            );
                          }}
                        >
                          <span className="truncate text-left">
                            {row.clientIds.length === 0
                              ? "Select..."
                              : row.clientIds.length === 1
                                ? allClients.find((c) => c.id === row.clientIds[0])?.name || "1 client selected"
                                : `${row.clientIds.length} clients selected`}
                          </span>
                          <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                        </button>
                      </div>

                      <div className="pt-7">
                        <button
                          type="button"
                          className="h-10 w-10 inline-flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500"
                          title="Remove"
                          onClick={() =>
                            setInviteRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== row.id)))
                          }
                          disabled={inviting || inviteRows.length <= 1}
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() =>
                      setInviteRows((prev) => [
                        ...prev,
                        { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, email: "", clientIds: [] },
                      ])
                    }
                    className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 inline-flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add Client User
                  </button>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={inviteSendEmail}
                      onChange={(e) => setInviteSendEmail(e.target.checked)}
                    />
                    Invite users via email
                  </label>
                </div>
                </div>
              </div>

              <div className="shrink-0 px-8 py-4 border-t border-gray-200 bg-gray-100/80 flex items-center justify-end gap-3 rounded-b-2xl">
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium"
                  disabled={inviting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submitInvites()}
                  className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-md hover:shadow-lg disabled:opacity-60 transition-all"
                  disabled={inviting}
                >
                  {inviting ? "Sending..." : "Send Invite"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {inviteClientsMenu &&
        typeof window !== "undefined" &&
        createPortal(
          (() => {
            const menuWidth = Math.max(320, inviteClientsMenu.rect.width);
            const menuMaxHeight = 320;
            const gap = 8;

            const left = Math.min(
              Math.max(inviteClientsMenu.rect.left, gap),
              window.innerWidth - gap - menuWidth
            );
            const top = Math.min(
              inviteClientsMenu.rect.bottom + gap,
              Math.max(gap, window.innerHeight - gap - menuMaxHeight)
            );

            const activeRow = inviteRows.find((r) => r.id === inviteClientsMenu.rowId) || null;
            const selected = new Set(activeRow?.clientIds || []);

            return (
              <div className="fixed inset-0 z-[1150]" onClick={() => setInviteClientsMenu(null)}>
                <div
                  className="absolute rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden"
                  style={{ top, left, width: menuWidth, maxHeight: menuMaxHeight }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="max-h-[320px] overflow-y-auto">
                    {allClientsLoading ? (
                      <div className="px-4 py-3 text-sm text-gray-500">Loading clients...</div>
                    ) : allClients.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-500">No clients found.</div>
                    ) : (
                      allClients.map((c) => {
                        const isOn = selected.has(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-start gap-3"
                            onClick={() => {
                              setInviteRows((prev) =>
                                prev.map((r) => {
                                  if (r.id !== inviteClientsMenu.rowId) return r;
                                  const next = new Set(r.clientIds);
                                  if (next.has(c.id)) next.delete(c.id);
                                  else next.add(c.id);
                                  return { ...r, clientIds: Array.from(next) };
                                })
                              );
                            }}
                          >
                            <span
                              className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center ${
                                isOn ? "bg-primary-600 border-primary-600" : "bg-white border-gray-300"
                              }`}
                            >
                              {isOn ? <span className="h-2 w-2 bg-white rounded-sm" /> : null}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-gray-900">{c.name}</span>
                              {c.domain ? <span className="block truncate text-xs text-gray-500">{c.domain}</span> : null}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                  <div className="h-px bg-gray-100" />
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => setInviteClientsMenu(null)}
                  >
                    Done
                  </button>
                </div>
              </div>
            );
          })(),
          document.body
        )}
    </div>
  );
};

export default ClientUsersPage;

