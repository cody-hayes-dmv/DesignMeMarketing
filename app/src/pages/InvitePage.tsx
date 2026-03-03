import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useDispatch, useSelector } from "react-redux";
import { checkAuth } from "@/store/slices/authSlice";
import type { RootState } from "@/store";
import toast from "react-hot-toast";
import { usePublicBranding } from "@/hooks/usePublicBranding";

type InviteInfo =
  | {
      kind: "CLIENT_USER_INVITE";
      email: string;
      clients: Array<{ id: string; name: string }>;
      used?: boolean;
    }
  | {
      kind: "TEAM_INVITE";
      email: string;
      role?: string;
      agencyName?: string;
    }
  | null;

function useQueryParam(name: string): string {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search);
    return String(params.get(name) || "");
  }, [location.search, name]);
}

const InvitePage = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useSelector((state: RootState) => state.auth);
  const token = useQueryParam("token").trim();

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InviteInfo>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { brandName, primaryColor } = usePublicBranding();

  const getAuthedRedirectPath = () => {
    if (!user) return "/login";
    if (user.role === "USER") {
      const firstClientId = (user as any)?.clientAccess?.clients?.[0]?.clientId;
      return firstClientId ? `/client/dashboard/${encodeURIComponent(firstClientId)}` : "/login";
    }
    if (user.role === "SPECIALIST") return "/specialist/dashboard";
    if (user.role === "DESIGNER") return "/designer/web-design";
    if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") return "/superadmin/dashboard";
    return "/agency/dashboard";
  };

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        // If no invite token is present and user is already authenticated, go to dashboard.
        // When a token exists, always honor invite flow (allows accepting from a browser that already has another session).
        if (user?.verified && !token) {
          navigate(getAuthedRedirectPath(), { replace: true });
          return;
        }

        // Wait for auth bootstrap if a session token exists to avoid transient invite lookups.
        const hasSessionToken = Boolean(localStorage.getItem("token"));
        if (hasSessionToken && authLoading) {
          return;
        }

        if (!token) {
          setInvite(null);
          setError("Missing invite token.");
          return;
        }
        const res = await api.get("/auth/invite", { params: { token } });
        const inviteInfo = res.data as InviteInfo;
        if (user?.verified && inviteInfo?.kind === "CLIENT_USER_INVITE" && (inviteInfo as any)?.used) {
          navigate(getAuthedRedirectPath(), { replace: true });
          return;
        }
        setInvite(inviteInfo);
      } catch (e: any) {
        if (user?.verified && e?.response?.status === 400) {
          navigate(getAuthedRedirectPath(), { replace: true });
          return;
        }
        setInvite(null);
        setError(e?.response?.data?.message || "Invalid or expired invite.");
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [token, user?.verified, authLoading, navigate]);

  const handleAccept = async () => {
    if (!token) return;
    if (!name.trim()) {
      toast.error("Please enter your name.");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.post("/auth/invite/accept", { token, name: name.trim(), password });
      const jwt = res.data?.token as string | undefined;
      const redirect = res.data?.redirect as { clientId?: string; type?: string } | undefined;
      const userRole = res.data?.user?.role as string | undefined;

      if (!jwt) {
        toast.error("Invite accepted, but login failed. Please try logging in.");
        navigate("/login", { replace: true });
        return;
      }

      localStorage.setItem("token", jwt);
      await dispatch(checkAuth() as any);

      if (redirect?.type === "TEAM") {
        const dashboardPath =
          userRole === "SPECIALIST"
            ? "/specialist/dashboard"
            : userRole === "DESIGNER"
            ? "/designer/web-design"
            : "/agency/dashboard";
        navigate(dashboardPath, { replace: true });
        return;
      }

      const clientId = redirect?.clientId;
      if (clientId) {
        navigate(`/client/dashboard/${encodeURIComponent(clientId)}`, { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to accept invite.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl bg-white border border-gray-200 rounded-2xl shadow-sm p-8">
        {loading ? (
          <div className="text-center text-gray-600">Loading invitation…</div>
        ) : error ? (
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{brandName}</p>
            <h1 className="text-2xl font-bold text-gray-900">Invitation</h1>
            <p className="mt-2 text-sm text-rose-600">{error}</p>
            <div className="mt-6">
              <button
                className="px-4 py-2 rounded-lg text-white"
                style={{ backgroundColor: primaryColor }}
                onClick={() => navigate("/login")}
              >
                Go to Login
              </button>
            </div>
          </div>
        ) : invite?.kind === "TEAM_INVITE" ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 text-center">{brandName}</p>
            <h1 className="text-3xl font-bold text-gray-900 text-center">Join the team</h1>
            <p className="mt-3 text-sm text-gray-600 text-center">
              Set your name and password to activate your account and access the team dashboard.
              {invite.agencyName && (
                <span className="block mt-1">You’re joining {invite.agencyName}.</span>
              )}
            </p>

            <div className="mt-8">
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input
                type="email"
                value={invite.email}
                disabled
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50"
              />
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Your name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Create password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-8 flex items-center justify-between">
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleAccept()}
                disabled={submitting}
                className="px-6 py-2 rounded-lg text-white disabled:opacity-60"
                style={{ backgroundColor: primaryColor }}
              >
                {submitting ? "Submitting..." : "Accept & sign in"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 text-center">{brandName}</p>
            <h1 className="text-3xl font-bold text-gray-900 text-center">Add Client User(s)</h1>
            <p className="mt-3 text-sm text-gray-600 text-center">
              Complete your account activation to access your invited client dashboards.
            </p>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input
                  type="email"
                  value={invite?.kind === "CLIENT_USER_INVITE" ? invite.email : ""}
                  disabled
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Clients ({invite?.kind === "CLIENT_USER_INVITE" ? invite.clients.length : 0})
                </label>
                <div className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50">
                  {invite?.kind === "CLIENT_USER_INVITE" && invite.clients?.length ? (
                    <ul className="list-disc pl-5 space-y-1">
                      {invite.clients.map((c) => (
                        <li key={c.id}>{c.name}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-gray-500">No clients</span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Your name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Create password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-8 flex items-center justify-between">
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleAccept()}
                disabled={submitting}
                className="px-6 py-2 rounded-lg text-white disabled:opacity-60"
                style={{ backgroundColor: primaryColor }}
              >
                {submitting ? "Submitting..." : "Next"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default InvitePage;

