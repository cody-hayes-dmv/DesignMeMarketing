import React, { useState, useEffect } from "react";
import { useLocation, Link, Navigate, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import Sidebar from "./Sidebar";
import NotificationBell from "./NotificationBell";
import AgencyOnboardingModal from "./AgencyOnboardingModal";
import api from "@/lib/api";
import { logout } from "@/store/slices/authSlice";
import { CreditCard, AlertTriangle, LayoutDashboard, CheckSquare, Menu, ChevronLeft, LogOut, Settings } from "lucide-react";

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
  onboardingCompleted?: boolean;
  website?: string | null;
  industry?: string | null;
  agencySize?: string | null;
  numberOfClients?: number | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactJobTitle?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  onboardingData?: {
    referralSource?: string;
    referralSourceOther?: string;
    primaryGoals?: string[];
    primaryGoalsOther?: string;
    currentTools?: string;
    submittedAt?: string;
  } | null;
}

const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [agencyMe, setAgencyMe] = useState<AgencyMe | null>(null);
  const { user } = useSelector((state: RootState) => state.auth);
  const brandName = user?.agencyBranding?.brandDisplayName || "SEO Dashboard";
  const brandColor = user?.agencyBranding?.primaryColor || "#4f46e5";
  const brandLogo = user?.agencyBranding?.logoUrl || null;
  const showBrandedHeader = user?.role === "AGENCY" || user?.role === "USER";
  const isClientPortal = location.pathname.startsWith("/client/");
  const isAgencyRoute = location.pathname.startsWith("/agency/");

  const refetchAgencyMe = () => {
    if (isAgencyRoute && user?.role === "AGENCY") {
      api.get("/agencies/me").then((r) => setAgencyMe(r.data)).catch(() => setAgencyMe(null));
    } else {
      setAgencyMe(null);
    }
  };

  useEffect(() => {
    refetchAgencyMe();
  }, [isAgencyRoute, user?.role]);

  useEffect(() => {
    const handler = () => refetchAgencyMe();
    window.addEventListener("subscription-changed", handler);
    return () => window.removeEventListener("subscription-changed", handler);
  }, [isAgencyRoute, user?.role]);

  // Get page title based on current route
  const getPageTitle = () => {
    const path = location.pathname;


    if (path === "/agency/dashboard") return "Dashboard";
    if (path === "/agency/financial-overview") return "Financial Overview";
    if (path === "/agency/clients") return "Clients";
    if (path === "/agency/tasks") return "Tasks";
    if (path === "/agency/web-design") return "Web Design";
    if (path === "/agency/research" || path === "/agnecy/research" || path === "/admin/research" || path === "/superadmin/research") return "Research";
    if (path === "/agency/rankings") return "Rankings";
    if (path === "/agency/reports") return "Reports";
    if (path === "/agency/local-map-snapshot") return "Local Map Snapshot";
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
    if (path === "/superadmin/prospect-snapshot") return "Prospect Snapshot";

    if (path === "/specialist/dashboard") return "Dashboard";
    if (path === "/specialist/clients") return "My Clients";
    if (path === "/specialist/tasks") return "Tasks";
    if (path === "/specialist/settings") return "Settings";

    if (path === "/designer/web-design") return "Web Design";
    if (path === "/designer/settings") return "Settings";

    if (path.startsWith("/client/dashboard")) return "Dashboard";
    if (path.startsWith("/client/web-design")) return "Web Design";
    if (path === "/client/tasks") return "Tasks";
    if (path === "/client/settings") return "Settings";
    if (path === "/client/report" || path.startsWith("/client/report/")) return "Report";

    return "Dashboard";
  };

  // Client portal: left sidebar with Dashboard + Tasks
  if (isClientPortal || user?.role === "USER") {
    const handleClientSignOut = () => {
      dispatch(logout() as any);
      navigate("/login", { replace: true });
    };
    const firstClientId = (user as any)?.clientAccess?.clients?.[0]?.clientId;
    const clientNavItems = [
      { path: firstClientId ? `/client/dashboard/${firstClientId}` : "/client/tasks", label: "Dashboard", icon: LayoutDashboard },
      { path: firstClientId ? `/client/web-design/${firstClientId}` : "/client/tasks", label: "Web Design", icon: LayoutDashboard },
      { path: "/client/tasks", label: "Tasks", icon: CheckSquare },
      { path: "/client/settings", label: "Settings", icon: Settings },
    ];

    return (
      <div className="min-h-screen bg-gray-50">
        <div
          className={`${sidebarCollapsed ? "w-16" : "w-64"} bg-gray-900 h-screen flex flex-col transition-all duration-300 fixed left-0 top-0 z-30`}
        >
          <div className="absolute -right-3 top-6 z-40">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="bg-white border border-gray-200 rounded-full p-1.5 shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-110"
            >
              {sidebarCollapsed ? (
                <Menu className="h-4 w-4 text-gray-600" />
              ) : (
                <ChevronLeft className="h-4 w-4 text-gray-600" />
              )}
            </button>
          </div>

          <div className={`${sidebarCollapsed ? "px-3 py-5" : "px-4 py-6"} border-b border-gray-700 transition-all duration-300 flex flex-col items-center justify-center text-center`}>
            <div
              className={`${sidebarCollapsed ? "h-8 w-8" : "h-14 w-14"} rounded-full bg-primary-600/90 flex items-center justify-center transition-all duration-300 overflow-hidden`}
              style={{ backgroundColor: brandColor }}
            >
              {brandLogo ? (
                <img
                  src={brandLogo}
                  alt={brandName}
                  className="h-full w-full object-cover"
                />
              ) : user?.profileImageUrl ? (
                <img
                  src={user.profileImageUrl}
                  alt="User avatar"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-sm font-medium text-white">
                  {user?.name?.charAt(0) || user?.email?.charAt(0) || "U"}
                </span>
              )}
            </div>
            {!sidebarCollapsed && (
              <div className="mt-2">
                <p className="text-xs font-semibold text-white truncate max-w-[180px]">{brandName}</p>
                <p className="text-xs font-medium text-gray-400 tracking-wide">Client Panel</p>
              </div>
            )}
          </div>

          <nav className={`flex-1 ${sidebarCollapsed ? "p-2" : "p-4"} transition-all duration-300`}>
            <ul className="space-y-2">
              {clientNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname.startsWith(item.path.split("?")[0]);
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      className={`w-full flex items-center ${sidebarCollapsed ? "justify-center px-2 py-3" : "space-x-3 px-4 py-3"} rounded-lg text-left transition-all duration-300 ${
                        isActive ? "bg-primary-600 text-white" : "text-gray-300 hover:bg-gray-800 hover:text-white"
                      } group relative`}
                      style={isActive ? { backgroundColor: brandColor } : undefined}
                      title={sidebarCollapsed ? item.label : undefined}
                    >
                      <Icon className="h-5 w-5 transition-all duration-300" />
                      {!sidebarCollapsed && <span className="font-medium transition-opacity duration-300">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className={`${sidebarCollapsed ? "p-2" : "p-4"} border-t border-gray-700 transition-all duration-300`}>
            <div
              className={`flex items-center ${sidebarCollapsed ? "justify-center mb-2" : "space-x-3 mb-4"} transition-all duration-300`}
            >
              <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: brandColor }}>
                {user?.profileImageUrl ? (
                  <img
                    src={user.profileImageUrl}
                    alt="User avatar"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-sm font-medium text-white">
                    {user?.name?.charAt(0) || user?.email?.charAt(0) || "U"}
                  </span>
                )}
              </div>
              {!sidebarCollapsed && (
                <div className="flex-1 min-w-0 transition-opacity duration-300">
                  <p className="text-sm font-medium text-white truncate">
                    {user?.name || user?.email}
                  </p>
                  <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={handleClientSignOut}
              className={`w-full flex items-center ${sidebarCollapsed ? "justify-center px-2 py-2" : "space-x-3 px-4 py-2"} text-gray-300 hover:bg-red-600 hover:text-white rounded-lg transition-all duration-300`}
              title={sidebarCollapsed ? "Sign out" : undefined}
            >
              <LogOut className="h-4 w-4" />
              {!sidebarCollapsed && <span className="text-sm">Sign out</span>}
            </button>
          </div>
        </div>

        <div className={`w-full transition-all duration-300 flex flex-col ${sidebarCollapsed ? "pl-16" : "pl-64"}`}>
          <div
            className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between gap-4"
            style={showBrandedHeader ? { borderTop: `3px solid ${brandColor}` } : undefined}
          >
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{getPageTitle()}</h1>
              <p className="text-xs text-gray-500">{brandName}</p>
            </div>
            <NotificationBell />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">{children}</div>
        </div>
      </div>
    );
  }

  const trialExpired = isAgencyRoute && agencyMe?.trialExpired === true;
  const onSubscriptionPage = location.pathname === "/agency/subscription";
  const isTrialBilling = agencyMe?.billingType === "trial";
  const trialDaysLeft = agencyMe?.trialDaysLeft ?? 0;
  const trialActive = isAgencyRoute && isTrialBilling && trialDaysLeft > 0 && !trialExpired;
  const showAgencyOnboardingModal =
    isAgencyRoute &&
    user?.role === "AGENCY" &&
    agencyMe?.id &&
    agencyMe?.onboardingCompleted === false;

  // Restrict access when trial expired: only Subscription page is allowed
  if (trialExpired && !onSubscriptionPage) {
    return <Navigate to="/agency/subscription" replace />;
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
        <div
          className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between gap-4"
          style={showBrandedHeader ? { borderTop: `3px solid ${brandColor}` } : undefined}
        >
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{getPageTitle()}</h1>
            {showBrandedHeader && <p className="text-xs text-gray-500">{brandName}</p>}
          </div>
          {(user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "AGENCY" || user?.role === "SPECIALIST") && <NotificationBell />}
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
        {trialActive && (
          <div className="bg-primary-50 border-b border-primary-200 px-8 py-3 flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm font-medium text-primary-800 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              You have <strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""}</strong> left in your free trial. Select a paid plan before it ends to keep your account active.
            </p>
            {!onSubscriptionPage && (
              <Link
                to="/agency/subscription"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 shrink-0"
              >
                <CreditCard className="h-4 w-4" />
                Choose a Plan
              </Link>
            )}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {children}
        </div>
      </div>
      <AgencyOnboardingModal
        open={!!showAgencyOnboardingModal}
        initialData={agencyMe}
        onSaved={() => {
          refetchAgencyMe();
        }}
      />
    </div>
  );
};

export default DashboardLayout;
