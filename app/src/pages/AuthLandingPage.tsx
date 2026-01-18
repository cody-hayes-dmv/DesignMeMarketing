import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import zoesiBlueLogoUrl from "@/assets/zoesi-blue.png";

type LoginRole = "SUPER_ADMIN" | "ADMIN" | "AGENCY" | "CLIENT" | "WORKER";

const getBrandName = () => {
  const host = window.location.hostname;
  // localhost / IPs: keep generic
  if (host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return "Your Dashboard";

  // simple subdomain-based brand (white-label friendly)
  const parts = host.split(".");
  if (parts.length >= 3) {
    const sub = parts[0];
    if (sub && sub !== "www") return sub.replace(/-/g, " ");
  }
  return "Your Dashboard";
};

const roleCards: Array<{
  role: LoginRole;
  title: string;
  subtitle: string;
}> = [
  { role: "SUPER_ADMIN", title: "Super Admin", subtitle: "Full access." },
  { role: "ADMIN", title: "Admin", subtitle: "Manage agencies, clients, and reporting." },
  { role: "AGENCY", title: "Agency", subtitle: "View and manage your clients." },
  { role: "CLIENT", title: "Client", subtitle: "View your report only." },
  { role: "WORKER", title: "Worker", subtitle: "View your assigned tasks and logins." },
];

const AuthLandingPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const brandName = getBrandName();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <img
              src={zoesiBlueLogoUrl}
              alt={brandName}
              className="h-12 w-auto object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Sign in</h1>
          <p className="text-gray-600 mt-1">Choose your portal to continue.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {roleCards.map((card) => (
            <button
              key={card.role}
              type="button"
              onClick={() => navigate(`/login?as=${card.role}`, { state: { from: location } })}
              className="bg-white border border-gray-200 rounded-xl p-5 text-left hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold text-gray-900">{card.title}</p>
                  <p className="text-sm text-gray-600 mt-1">{card.subtitle}</p>
                </div>
                <span className="text-sm text-primary-600 font-medium">Continue</span>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-6 text-center text-xs text-gray-500">
          {brandName}
        </div>
      </div>
    </div>
  );
};

export default AuthLandingPage;

