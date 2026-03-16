import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "./store";
import { checkAuth } from "./store/slices/authSlice";
import { Toaster } from "react-hot-toast";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import VerifyPage from "./pages/VerifyPage";
import SpecialistDashboard from "./pages/Specialist/SpecialistDashboardPage";
import SpecialistClientsPage from "./pages/Specialist/SpecialistClientsPage";
import DashboardLayout from "./components/DashboardLayout";
import ClientsPage from "./pages/ClientsPage";
import KeywordsPage from "./pages/KeywordsPage";
import RankingsPage from "./pages/RankingPage";
import ReportsPage from "./pages/ReportsPage";
import TeamPage from "./pages/TeamPage";
import SettingsPage from "./pages/SettingsPage";
import TasksPage from "./pages/TasksPage";
import SubscriptionPage from "./pages/Agency/SubscriptionPage";
import ManagedServicesPage from "./pages/Agency/ManagedServicesPage";
import AddOnsPage from "./pages/Agency/AddOnsPage";
import AgencyDashboardPage from "./pages/Agency/AgencyDashboardPage";
import LocalMapSnapshotPage from "./pages/Agency/LocalMapSnapshotPage";
import AgenciesPage from "./pages/SuperAdmin/AgenciesPage";
import SuperAdminDashboard from "./pages/SuperAdmin/SuperAdminDashboard";
import ProspectSnapshotPage from "./pages/SuperAdmin/ProspectSnapshotPage";
import VendastaPage from "./pages/VendastaPage";
import IncludedPage from "./pages/IncludedPage";
import ClientDashboardPage from "./pages/ClientDashboardPage";
import ShareDashboardPage from "./pages/ShareDashboardPage";
import ClientReportIndexPage from "./pages/ClientReportIndexPage";
import InvitePage from "./pages/InvitePage";
import ClientUsersPage from "./pages/ClientUsersPage";
import FinancialOverviewPage from "./pages/FinancialOverviewPage";
import AuthLandingPage from "./pages/AuthLandingPage";
import WebDesignPage from "./pages/WebDesignPage";
import WebDesignDeepLinkPage from "./pages/WebDesignDeepLinkPage";
import InboxPage from "./pages/InboxPage";

function App() {
  const dispatch = useDispatch();
  const { user, loading } = useSelector((state: RootState) => state.auth);
  const token = localStorage.getItem("token");
  const [authBootstrapDone, setAuthBootstrapDone] = useState(!Boolean(token));

  useEffect(() => {
    const isVerifyRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/verify");
    if (token && !isVerifyRoute) {
      Promise.resolve(dispatch(checkAuth() as any)).finally(() => {
        setAuthBootstrapDone(true);
      });
    } else {
      setAuthBootstrapDone(true);
    }
  }, [dispatch, token]);

  useEffect(() => {
    const closeTabAfterVerifySignal = () => {
      const path = window.location.pathname;
      if (path.startsWith("/verify")) return;
      // Try to close this (older) tab. Browsers may block close() for user-opened tabs.
      window.close();
      // Additional best-effort variant used by some browsers.
      if (!window.closed) {
        try {
          window.open("", "_self");
          window.close();
        } catch {
          // Ignore close restrictions.
        }
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === "email_verified_signal" && event.newValue) {
        closeTabAfterVerifySignal();
      }
    };

    let channel: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel("auth_events");
      channel.onmessage = (event) => {
        if (event.data?.type === "EMAIL_VERIFIED") {
          closeTabAfterVerifySignal();
        }
      };
    }

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      if (channel) channel.close();
    };
  }, []);

  // Defer Toaster mount to avoid removeChild race with initial route/portals and with
  // browser extensions that inject into the DOM on production (see React #17256).
  const [toasterReady, setToasterReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => {
      requestAnimationFrame(() => setToasterReady(true));
    }, 100);
    return () => window.clearTimeout(t);
  }, []);

  // Show loading while checking auth on initial load (must be after all hooks)
  if (token && !user && (!authBootstrapDone || loading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  // Only show loading on initial app load, not during auth operations
  // const isInitialLoad = loading && !user && !localStorage.getItem("token");

  // if (isInitialLoad) {
  //   return (
  //     <div className="min-h-screen flex items-center justify-center">
  //       <div className="text-center">
  //         <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
  //         <p className="text-gray-500">Loading...</p>
  //       </div>
  //     </div>
  //   );
  // }

  // Role-based dashboard URLs
  // ADMIN and SUPER_ADMIN can access agency dashboard as well
  const dashboardUrls = {
    SUPER_ADMIN: "/superadmin/dashboard",
    ADMIN: "/superadmin/dashboard",
    // Restore previous agency portal landing
    AGENCY: "/agency/dashboard",
    // Restore previous specialist portal landing
    SPECIALIST: "/specialist/dashboard",
    DESIGNER: "/designer/web-design",
    // Client-portal user: redirect handled dynamically (see getRedirectUrl)
    USER: "/client/dashboard",
  };

  // Agency routes with DashboardLayout - accessible by AGENCY, ADMIN, and SUPER_ADMIN
  const agencyRoutes = [
    { path: "/agency/dashboard", component: AgencyDashboardPage },
    { path: "/agency/financial-overview", component: FinancialOverviewPage },
    { path: "/agency/agencies", component: AgenciesPage },
    { path: "/agency/clients", component: ClientsPage },
    { path: "/agency/vendasta", component: VendastaPage },
    { path: "/agency/included", component: IncludedPage },
    { path: "/agency/rankings", component: RankingsPage },
    { path: "/agency/reports", component: ReportsPage },
    { path: "/agency/managed-services", component: ManagedServicesPage },
    { path: "/agency/add-ons", component: AddOnsPage },
    { path: "/agency/subscription", component: SubscriptionPage },
    { path: "/agency/users", component: ClientUsersPage },
    { path: "/agency/team", component: TeamPage },
    { path: "/agency/clients/:clientId", component: ClientDashboardPage },
    { path: "/agency/settings", component: SettingsPage },
    { path: "/agency/tasks", component: TasksPage },
    { path: "/agency/inbox", component: InboxPage },
    { path: "/agency/web-design", component: WebDesignPage },
  ];

  // Specialist routes
  const specialistRoutes = [
    { path: "/specialist/dashboard", component: SpecialistDashboard },
    { path: "/specialist/clients", component: SpecialistClientsPage },
    { path: "/specialist/clients/:clientId", component: ClientDashboardPage },
    { path: "/specialist/tasks", component: TasksPage },
    { path: "/specialist/inbox", component: InboxPage },
    { path: "/specialist/settings", component: SettingsPage },
  ];

  const designerRoutes = [
    { path: "/designer/web-design", component: WebDesignPage },
    { path: "/designer/settings", component: SettingsPage },
  ];

  // Client portal routes (client users)
  const clientRoutes = [
    { path: "/client/dashboard/:clientId", component: ClientDashboardPage },
    { path: "/client/web-design/:clientId", component: WebDesignPage },
    { path: "/client/tasks", component: TasksPage },
    { path: "/client/inbox", component: InboxPage },
    { path: "/client/settings", component: SettingsPage },
    // Back-compat: keep report portal paths if still used
    { path: "/client/report", component: ClientReportIndexPage },
    { path: "/client/report/:clientId", component: ClientDashboardPage },
  ];

  const getRedirectUrl = () => {
    if (!user) return "/login";
    if (user.role === "USER") {
      const firstClientId = (user as any)?.clientAccess?.clients?.[0]?.clientId;
      return firstClientId ? `/client/dashboard/${firstClientId}` : "/login";
    }
    return dashboardUrls[user.role as keyof typeof dashboardUrls] || "/login";
  };

  const getResearchUrlByRole = () => {
    if (!user) return "/login";
    if (user.role === "SUPER_ADMIN" || user.role === "ADMIN" || user.role === "AGENCY") return "/agency/research";
    return getRedirectUrl();
  };

  const getSafeRedirectFromQuery = () => {
    if (typeof window === "undefined") return null;
    const redirect = new URLSearchParams(window.location.search).get("redirect");
    if (!redirect) return null;
    if (!redirect.startsWith("/") || redirect.startsWith("//")) return null;
    return redirect;
  };

  const getLoginUrlWithCurrentLocation = () => {
    if (typeof window === "undefined") return "/login";
    const current = `${window.location.pathname}${window.location.search}`;
    return `/login?redirect=${encodeURIComponent(current)}`;
  };

  return (
    <div id="app-root" style={{ minHeight: "100vh" }}>
      {toasterReady && (
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: "#363636",
              color: "#fff",
            },
            success: {
              duration: 3000,
              iconTheme: {
                primary: "#10B981",
                secondary: "#fff",
              },
            },
            error: {
              duration: 5000,
              iconTheme: {
                primary: "#EF4444",
                secondary: "#fff",
              },
            },
          }}
        />
      )}
      <Routes>
      {/* Public share route - no auth required */}
      <Route path="/share/:token" element={<ShareDashboardPage />} />
      {/* Public invite accept route - no auth required */}
      <Route path="/invite" element={<InvitePage />} />
      {/* Public auth landing */}
      <Route
        path="/auth"
        element={
          user && user.verified ? (
            <Navigate to={getRedirectUrl()} replace />
          ) : (
            <AuthLandingPage />
          )
        }
      />
      {/* Backwards-compatible alias: redirect old portal entry to login */}
      <Route path="/portal" element={<Navigate to="/login" replace />} />
      {/* Auth routes - only redirect if user is authenticated and verified */}
      <Route
        path="/login"
        element={
          user && user.verified ? (
            <Navigate to={getSafeRedirectFromQuery() || getRedirectUrl()} replace />
          ) : (
            <LoginPage />
          )
        }
      />
      <Route
        path="/register"
        element={
          user && user.verified ? (
            <Navigate to={getRedirectUrl()} replace />
          ) : (
            <RegisterPage />
          )
        }
      />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify" element={<VerifyPage />} />
      <Route
        path="/web-design/projects/:projectId/pages/:pageId"
        element={
          (token && !user) ? (
            <div className="min-h-screen flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
                <p className="text-gray-500">Loading...</p>
              </div>
            </div>
          ) : !user || !user.verified ? (
            <Navigate to={getLoginUrlWithCurrentLocation()} replace />
          ) : (
            <DashboardLayout>
              <WebDesignDeepLinkPage />
            </DashboardLayout>
          )
        }
      />


      {/* Specialist routes */}
      {specialistRoutes.map(({ path, component: Component }) => (
        <Route
          key={path}
          path={path}
          element={
            (token && !user) ? (
              <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
                  <p className="text-gray-500">Loading...</p>
                </div>
              </div>
            ) : !user || !user.verified ? (
              <Navigate to="/login" replace />
            ) : user.role !== "SPECIALIST" ? (
              <Navigate to={getRedirectUrl()} replace />
            ) : (
              <DashboardLayout>
                <Component />
              </DashboardLayout>
            )
          }
        />
      ))}

      {/* Designer routes */}
      {designerRoutes.map(({ path, component: Component }) => (
        <Route
          key={path}
          path={path}
          element={
            (token && !user) ? (
              <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
                  <p className="text-gray-500">Loading...</p>
                </div>
              </div>
            ) : !user || !user.verified ? (
              <Navigate to="/login" replace />
            ) : user.role !== "DESIGNER" ? (
              <Navigate to={getRedirectUrl()} replace />
            ) : (
              <DashboardLayout>
                <Component />
              </DashboardLayout>
            )
          }
        />
      ))}

      {/* Client portal routes (client users) */}
      {clientRoutes.map(({ path, component: Component }) => (
        <Route
          key={path}
          path={path}
          element={
            (token && !user) ? (
              <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
                  <p className="text-gray-500">Loading...</p>
                </div>
              </div>
            ) : !user || !user.verified ? (
              <Navigate to="/login" replace />
            ) : user.role !== "USER" ? (
              <Navigate to={getRedirectUrl()} replace />
            ) : path.startsWith("/client/report") ? (
              <Navigate to={getRedirectUrl()} replace />
            ) : (
              <DashboardLayout>
                <Component />
              </DashboardLayout>
            )
          }
        />
      ))}

      {/* Redirect old Workers path to Team (Workers combined into Team) */}
      <Route path="/agency/workers" element={<Navigate to="/agency/team" replace />} />
      {/* Legacy Research URLs -> role-based Research panel URL */}
      <Route
        path="/agency/keywords"
        element={
          (token && !user) ? (
            <div className="min-h-screen flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
                <p className="text-gray-500">Loading...</p>
              </div>
            </div>
          ) : !user || !user.verified ? (
            <Navigate to="/login" replace />
          ) : (
            <Navigate to={getResearchUrlByRole()} replace />
          )
        }
      />
      <Route
        path="/agency/research"
        element={
          (token && !user) ? (
            <div className="min-h-screen flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
                <p className="text-gray-500">Loading...</p>
              </div>
            </div>
          ) : !user || !user.verified ? (
            <Navigate to="/login" replace />
          ) : !["AGENCY", "ADMIN", "SUPER_ADMIN"].includes(user.role) ? (
            <Navigate to={getRedirectUrl()} replace />
          ) : ["AGENCY", "ADMIN", "SUPER_ADMIN"].includes(user.role) ? (
            <DashboardLayout>
              <KeywordsPage />
            </DashboardLayout>
          ) : (
            <Navigate to={getResearchUrlByRole()} replace />
          )
        }
      />
      <Route path="/admin/research" element={<Navigate to="/agency/research" replace />} />
      <Route path="/superadmin/research" element={<Navigate to="/agency/research" replace />} />
      <Route
        path="/agnecy/research"
        element={
          <Navigate to="/agency/research" replace />
        }
      />
      {/* Redirect legacy worker portal paths */}
      <Route path="/worker/*" element={<Navigate to="/specialist/dashboard" replace />} />
      {/* Redirect removed specialist team page */}
      <Route path="/specialist/team" element={<Navigate to="/specialist/dashboard" replace />} />

      {/* Agency routes - accessible by AGENCY, ADMIN, and SUPER_ADMIN */}
      {agencyRoutes.map(({ path, component: Component }) => (
        <Route
          key={path}
          path={path}
          element={
            (token && !user) ? (
              <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
                  <p className="text-gray-500">Loading...</p>
                </div>
              </div>
            ) : !user || !user.verified ? (
              <Navigate to="/login" replace />
            ) : !["AGENCY", "ADMIN", "SUPER_ADMIN"].includes(user.role) ? (
              <Navigate to={getRedirectUrl()} replace />
            ) : (
              <DashboardLayout>
                <Component />
              </DashboardLayout>
            )
          }
        />
      ))}

      <Route
        path="/agency/local-map-snapshot"
        element={
          (token && !user) ? (
            <div className="min-h-screen flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
                <p className="text-gray-500">Loading...</p>
              </div>
            </div>
          ) : !user || !user.verified ? (
            <Navigate to="/login" replace />
          ) : !["AGENCY"].includes(user.role) ? (
            <Navigate to={getRedirectUrl()} replace />
          ) : (
            <DashboardLayout>
              <LocalMapSnapshotPage />
            </DashboardLayout>
          )
        }
      />

      <Route
        path="/superadmin/prospect-snapshot"
        element={
          (token && !user) ? (
            <div className="min-h-screen flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
                <p className="text-gray-500">Loading...</p>
              </div>
            </div>
          ) : !user || !user.verified ? (
            <Navigate to="/login" replace />
          ) : !["SUPER_ADMIN", "ADMIN"].includes(user.role) ? (
            <Navigate to={getRedirectUrl()} replace />
          ) : (
            <DashboardLayout>
              <ProspectSnapshotPage />
            </DashboardLayout>
          )
        }
      />

      {/* Super Admin Financial Overview route */}
      <Route
        path="/superadmin/financial-overview"
        element={
          (token && !user) ? (
            <div className="min-h-screen flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
                <p className="text-gray-500">Loading...</p>
              </div>
            </div>
          ) : !user || !user.verified ? (
            <Navigate to="/login" replace />
          ) : !["SUPER_ADMIN", "ADMIN"].includes(user.role) ? (
            <Navigate to={getRedirectUrl()} replace />
          ) : (
            <DashboardLayout>
              <FinancialOverviewPage />
            </DashboardLayout>
          )
        }
      />

      {/* Super Admin Dashboard route */}
      <Route
        path="/superadmin/dashboard"
        element={
          (token && !user) ? (
            <div className="min-h-screen flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
                <p className="text-gray-500">Loading...</p>
              </div>
            </div>
          ) : !user || !user.verified ? (
            <Navigate to="/login" replace />
          ) : !["SUPER_ADMIN", "ADMIN"].includes(user.role) ? (
            <Navigate to={getRedirectUrl()} replace />
          ) : (
            <DashboardLayout>
              <SuperAdminDashboard />
            </DashboardLayout>
          )
        }
      />

      {/* Super Admin Web Design route */}
      <Route
        path="/superadmin/web-design"
        element={
          (token && !user) ? (
            <div className="min-h-screen flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
                <p className="text-gray-500">Loading...</p>
              </div>
            </div>
          ) : !user || !user.verified ? (
            <Navigate to="/login" replace />
          ) : !["SUPER_ADMIN", "ADMIN"].includes(user.role) ? (
            <Navigate to={getRedirectUrl()} replace />
          ) : (
            <DashboardLayout>
              <WebDesignPage />
            </DashboardLayout>
          )
        }
      />

      {/* Root redirect - only redirect if user is authenticated */}
      <Route
        path="/"
        element={
          token && !user && (!authBootstrapDone || loading) ? (
            <div className="min-h-screen flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
                <p className="text-gray-500">Loading...</p>
              </div>
            </div>
          ) : user && user.verified ? (
            <Navigate to={getRedirectUrl()} replace />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      {/* Catch-all route - redirect to login if not authenticated, otherwise show 404 */}
      <Route
        path="*"
        element={
          !user || !user.verified ? (
            <Navigate to="/login" replace />
          ) : (
            <div className="min-h-screen flex items-center justify-center">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">404</h1>
                <p className="text-gray-600 mb-4">Page not found</p>
                <a
                  href={getRedirectUrl()}
                  className="text-primary-600 hover:text-primary-700 underline"
                >
                  Go to Dashboard
                </a>
              </div>
            </div>
          )
        }
      />
    </Routes>
    </div>
  );
}

export default App;
