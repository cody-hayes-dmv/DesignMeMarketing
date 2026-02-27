import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import api from "@/lib/api";
import { logout } from "@/store/slices/authSlice";
import { usePublicBranding } from "@/hooks/usePublicBranding";

type ClientLite = {
  id: string;
  name: string;
};

const ClientReportIndexPage: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { brandName, primaryColor } = usePublicBranding();

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        const res = await api.get("/clients");
        const clients = (Array.isArray(res.data) ? res.data : []) as ClientLite[];
        const first = clients[0];
        if (!first?.id) {
          setError("No client is associated with this account.");
          return;
        }
        navigate(`/client/report/${first.id}`, {
          replace: true,
          state: { tab: "report", reportOnly: true },
        });
      } catch (e: any) {
        console.error("Failed to load client report", e);
        setError(e?.response?.data?.message || "Unable to load your report.");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [navigate]);

  if (loading) {
    return (
      <div className="p-8 min-h-screen bg-gradient-to-br from-primary-50 via-blue-50 to-indigo-50">
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{brandName}</p>
          Loading your report...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 min-h-screen bg-gradient-to-br from-primary-50 via-blue-50 to-indigo-50">
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{brandName}</p>
          <p className="text-sm text-rose-600">{error}</p>
          <button
            type="button"
            onClick={() => {
              dispatch(logout() as any);
              navigate("/login", { replace: true });
            }}
            className="mt-4 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: primaryColor }}
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default ClientReportIndexPage;

