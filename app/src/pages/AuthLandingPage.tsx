import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import zoesiBlueLogoUrl from "@/assets/zoesi-blue.png";
import { usePublicBranding } from "@/hooks/usePublicBranding";

type LoginRole = "SUPER_ADMIN" | "ADMIN" | "AGENCY" | "USER" | "SPECIALIST";

const roleCards: Array<{
  role: LoginRole;
  title: string;
  subtitle: string;
}> = [
  { role: "SUPER_ADMIN", title: "Super Admin", subtitle: "Full access." },
  { role: "ADMIN", title: "Admin", subtitle: "Manage agencies, clients, and reporting." },
  { role: "AGENCY", title: "Agency", subtitle: "View and manage your clients." },
  { role: "USER", title: "Client", subtitle: "Access your invited client dashboard." },
  { role: "SPECIALIST", title: "Specialist", subtitle: "View your assigned tasks and logins." },
];

const AuthLandingPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { brandName, logoUrl, primaryColor } = usePublicBranding();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <img
              src={logoUrl || zoesiBlueLogoUrl}
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
                <span className="text-sm font-medium" style={{ color: primaryColor }}>Continue</span>
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

