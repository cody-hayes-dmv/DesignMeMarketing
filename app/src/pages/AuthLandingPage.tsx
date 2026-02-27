import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import zoesiBlueLogoUrl from "@/assets/zoesi-blue.png";
import { usePublicBranding } from "@/hooks/usePublicBranding";
import AgencyRegisterModal from "@/components/AgencyRegisterModal";

const AuthLandingPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { brandName, logoUrl, primaryColor } = usePublicBranding();
  const [agencyModalOpen, setAgencyModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-4xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          <div className="rounded-3xl bg-white border border-gray-200/80 shadow-xl p-8 md:p-10">
            <div className="flex items-center justify-center lg:justify-start mb-6">
              <img
                src={logoUrl || zoesiBlueLogoUrl}
                alt={brandName}
                className="h-12 w-auto object-contain"
              />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 text-center lg:text-left">
              Welcome to {brandName}
            </h1>
            <p className="text-gray-600 mt-3 text-base md:text-lg text-center lg:text-left">
              Manage SEO performance, reporting, and growth workflows in one place.
            </p>

            <div className="mt-8 space-y-3">
              <button
                type="button"
                onClick={() => navigate("/login", { state: { from: location } })}
                className="w-full rounded-xl px-5 py-3.5 font-semibold text-white shadow-md hover:shadow-lg transition-all"
                style={{ backgroundColor: primaryColor }}
              >
                Sign in / Sign up
              </button>
              <button
                type="button"
                onClick={() => setAgencyModalOpen(true)}
                className="w-full rounded-xl px-5 py-3.5 font-semibold border border-gray-300 text-gray-800 bg-white hover:bg-gray-50 transition-all"
              >
                Start for free
              </button>
            </div>

            <p className="mt-5 text-sm text-gray-500 text-center lg:text-left">
              Already have an account? Use Sign in / Sign up.
            </p>
          </div>

          <div className="rounded-3xl bg-slate-900 text-white shadow-xl p-8 md:p-10 flex flex-col justify-between">
            <div>
              <p className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide uppercase">
                All-in-one SEO Platform
              </p>
              <h2 className="mt-5 text-2xl md:text-3xl font-bold leading-tight">
                Build better client outcomes with faster insights.
              </h2>
              <p className="mt-4 text-slate-200">
                Track rankings, automate recurring work, and share branded dashboards your clients trust.
              </p>
            </div>
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded-xl bg-white/10 p-3">
                <p className="font-semibold">Rank Tracking</p>
                <p className="text-slate-300 mt-1">Monitor keyword growth.</p>
              </div>
              <div className="rounded-xl bg-white/10 p-3">
                <p className="font-semibold">Auto Reports</p>
                <p className="text-slate-300 mt-1">Send updates on schedule.</p>
              </div>
              <div className="rounded-xl bg-white/10 p-3">
                <p className="font-semibold">Team Workflow</p>
                <p className="text-slate-300 mt-1">Keep delivery organized.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-gray-500">
          {brandName}
        </div>
      </div>
      <AgencyRegisterModal
        open={agencyModalOpen}
        onClose={() => setAgencyModalOpen(false)}
        onSuccess={() => setAgencyModalOpen(false)}
      />
    </div>
  );
};

export default AuthLandingPage;

