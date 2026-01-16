import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";

type ClientLite = {
  id: string;
  name: string;
};

const ClientReportIndexPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      <div className="p-8">
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
          Loading your report...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-rose-600">{error}</p>
        </div>
      </div>
    );
  }

  return null;
};

export default ClientReportIndexPage;

