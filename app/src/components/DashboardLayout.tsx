import React, { useState, useEffect } from "react";
import { useLocation, Link, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { RootState } from "@/store";
import Sidebar from "./Sidebar";
import NotificationBell from "./NotificationBell";
import api from "@/lib/api";
import { CreditCard, AlertTriangle } from "lucide-react";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

interface AgencyMe {
  id?: string;
  trialExpired?: boolean;
  isBusinessTier?: boolean;
  /** "trial" = No Charge during 7 days trial */
  billingType?: string | null;
  trialDaysLeft?: number | null;
}

const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [agencyMe, setAgencyMe] = useState<AgencyMe | null>(null);
  const { user } = useSelector((state: RootState) => state.auth);
  const isClientPortal = location.pathname.startsWith("/client/");
  const isAgencyRoute = location.pathname.startsWith("/agency/");

  useEffect(() => {
    if (isAgencyRoute && (user?.role === "AGENCY" || user?.role === "ADMIN")) {
      api.get("/agencies/me").then((r) => setAgencyMe(r.data)).catch(() => setAgencyMe(null));
    } else {
      setAgencyMe(null);
    }
  }, [isAgencyRoute, user?.role]);

  // Get page title based on current route
  const getPageTitle = () => {
    const path = location.pathname;


    if (path === "/agency/dashboard") return "Dashboard";
    if (path === "/agency/financial-overview") return "Financial Overview";
    if (path === "/agency/clients") return "Clients";
    if (path === "/agency/tasks") return "Tasks";
    if (path === "/agency/keywords") return "Research";
    if (path === "/agency/rankings") return "Rankings";
    if (path === "/agency/reports") return "Reports";
    if (path === "/agency/managed-services") return "Managed Services";
    if (path === "/agency/add-ons") return "Add-Ons";
    if (path === "/agency/subscription") return "Subscription";
    if (path === "/agency/users") return "Users";
    if (path === "/agency/report") return "Report";
    if (path === "/agency/team") return "Team";
    if (path.startsWith("/agency/clients/")) return "Client Dashboard";
    if (path === "/agency/settings") return "Settings";

    if (path === "/superadmin/dashboard") return "Dashboard";
    if (path === "/superadmin/financial-overview") return "Financial Overview";
    if (path === "/superadmin/settings") return "Settings";
    if (path === "/superadmin/clients") return "Clients";
    if (path === "/superadmin/agencies/myagency") return "My Agency";
    if (path === "/superadmin/agencies/allagencies") return "All Agencies";
    if (path === "/superadmin/tasks") return "Tasks";

    if (path === "/specialist/dashboard") return "Dashboard";
    if (path === "/specialist/clients") return "My Clients";
    if (path === "/specialist/team") return "Team";
    if (path === "/specialist/tasks") return "Tasks";
    if (path === "/specialist/settings") return "Settings";

    if (path === "/client/report" || path.startsWith("/client/report/")) return "Report";

    return "Dashboard";
  };

  // Client portal: no sidebar/header chrome.
  if (isClientPortal || user?.role === "USER") {
    return <div className="min-h-screen bg-gray-50">{children}</div>;
  }

  const trialExpired = isAgencyRoute && agencyMe?.trialExpired === true;
  const onSubscriptionPage = location.pathname === "/agency/subscription";
  const isTrialBilling = agencyMe?.billingType === "trial";
  const trialDaysLeft = agencyMe?.trialDaysLeft ?? 0;
  const trialActiveRequireTier = isAgencyRoute && isTrialBilling && trialDaysLeft > 0 && !trialExpired;

  // Restrict access when trial expired: only Subscription page is allowed
  if (trialExpired && !onSubscriptionPage) {
    return <Navigate to="/agency/subscription" replace />;
  }

  // Require tier selection before trial expiration (No Charge during 7 days trial): redirect to Subscription until they choose a plan
  if (trialActiveRequireTier && !onSubscriptionPage) {
    return <Navigate to="/agency/subscription?require_tier=1" replace />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div
        className={`w-full transition-all duration-300 flex flex-col ${sidebarCollapsed ? "pl-16" : "pl-64"}`}
      >
        <div className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-gray-900">{getPageTitle()}</h1>
          {(user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "AGENCY") && <NotificationBell />}
        </div>
        {trialExpired && (
          <div className="bg-amber-50 border-b border-amber-200 px-8 py-3 flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm font-medium text-amber-800 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              Your free trial has ended. Choose a paid plan below to continue using the agency panel.
            </p>
            <Link
              to="/agency/subscription"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700"
            >
              <CreditCard className="h-4 w-4" />
              Subscription
            </Link>
          </div>
        )}
        {trialActiveRequireTier && onSubscriptionPage && (
          <div className="bg-primary-50 border-b border-primary-200 px-8 py-3 flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm font-medium text-primary-800 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              You have <strong>{trialDaysLeft} days</strong> left in your free trial. Select a paid plan before it ends to keep your account active.
            </p>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {children}
        </div>
      </div>
    </div>
  );
};

export default DashboardLayout;
