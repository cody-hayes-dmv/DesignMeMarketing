import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useDispatch } from "react-redux";
import { checkAuth } from "@/store/slices/authSlice";
import toast from "react-hot-toast";

type InviteInfo =
  | {
      kind: "CLIENT_USER_INVITE";
      email: string;
      clients: Array<{ id: string; name: string }>;
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
  const token = useQueryParam("token").trim();

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InviteInfo>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        if (!token) {
          setInvite(null);
          setError("Missing invite token.");
          return;
        }
        const res = await api.get("/auth/invite", { params: { token } });
        setInvite(res.data as InviteInfo);
      } catch (e: any) {
        setInvite(null);
        setError(e?.response?.data?.message || "Invalid or expired invite.");
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [token]);

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
      const clientId = res.data?.redirect?.clientId as string | undefined;

      if (!jwt || !clientId) {
        toast.error("Invite accepted, but login failed. Please try logging in.");
        navigate("/login", { replace: true });
        return;
      }

      localStorage.setItem("token", jwt);
      await dispatch(checkAuth() as any);
      navigate(`/client/dashboard/${encodeURIComponent(clientId)}`, { replace: true });
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
            <h1 className="text-2xl font-bold text-gray-900">Invitation</h1>
            <p className="mt-2 text-sm text-rose-600">{error}</p>
            <div className="mt-6">
              <button
                className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800"
                onClick={() => navigate("/login")}
              >
                Go to Login
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="text-3xl font-bold text-gray-900 text-center">Add Client User(s)</h1>
            <p className="mt-3 text-sm text-gray-600 text-center">
              Complete your account activation to access your invited client dashboards.
            </p>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input
                  type="email"
                  value={invite?.email || ""}
                  disabled
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Clients ({invite?.clients?.length || 0})
                </label>
                <div className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50">
                  {invite?.clients?.length ? (
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
                className="px-6 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60"
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

