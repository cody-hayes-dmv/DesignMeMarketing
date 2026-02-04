import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "./store";
import { checkAuth } from "./store/slices/authSlice";
import { Toaster } from "react-hot-toast";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import SpecialistDashboard from "./pages/Specialist/SpecialistDashboardPage";
import SpecialistTeamPage from "./pages/Specialist/SpecialistTeamPage";
import DashboardLayout from "./components/DashboardLayout";
import ClientsPage from "./pages/ClientsPage";
import KeywordsPage from "./pages/KeywordsPage";
import RankingsPage from "./pages/RankingPage";
import ReportsPage from "./pages/ReportsPage";
import TeamPage from "./pages/TeamPage";
import SettingsPage from "./pages/SettingsPage";
import TasksPage from "./pages/TasksPage";
import AgencyDashboardPage from "./pages/Agency/AgencyDashboardPage";
import AgenciesPage from "./pages/SuperAdmin/AgenciesPage";
import SuperAdminDashboard from "./pages/SuperAdmin/SuperAdminDashboard";
import VendastaPage from "./pages/VendastaPage";
import ClientDashboardPage from "./pages/ClientDashboardPage";
import ShareDashboardPage from "./pages/ShareDashboardPage";
import ClientReportIndexPage from "./pages/ClientReportIndexPage";
import InvitePage from "./pages/InvitePage";
import ClientUsersPage from "./pages/ClientUsersPage";
import FinancialOverviewPage from "./pages/FinancialOverviewPage";

function App() {
  const dispatch = useDispatch();
  const { user, loading } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      dispatch(checkAuth() as any);
    }
  }, [dispatch]);

  // Show loading while checking auth on initial load
  const token = localStorage.getItem("token");
  // Wait for auth to complete if we have a token but no user yet
  // Only show loading if we're actually loading, not if auth failed
  if (token && !user && loading) {
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
    ADMIN: "/agency/dashboard",
    // Restore previous agency portal landing
    AGENCY: "/agency/dashboard",
    // Restore previous specialist portal landing
    SPECIALIST: "/specialist/dashboard",
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
    { path: "/agency/keywords", component: KeywordsPage },
    { path: "/agency/rankings", component: RankingsPage },
    { path: "/agency/reports", component: ReportsPage },
    { path: "/agency/users", component: ClientUsersPage },
    { path: "/agency/team", component: TeamPage },
    { path: "/agency/clients/:clientId", component: ClientDashboardPage },
    { path: "/agency/settings", component: SettingsPage },
    { path: "/agency/tasks", component: TasksPage },
  ];

  // Specialist routes (restore previous version)
  const specialistRoutes = [
    { path: "/specialist/dashboard", component: SpecialistDashboard },
    { path: "/specialist/myagency", component: AgencyDashboardPage },
    { path: "/specialist/tasks", component: TasksPage },
    { path: "/specialist/team", component: SpecialistTeamPage },
    { path: "/specialist/settings", component: SettingsPage },
  ];

  // Client portal routes (client users)
  const clientRoutes = [
    { path: "/client/dashboard/:clientId", component: ClientDashboardPage },
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

  return (
    <>
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
      <Routes>
      {/* Public share route - no auth required */}
      <Route path="/share/:token" element={<ShareDashboardPage />} />
      {/* Public invite accept route - no auth required */}
      <Route path="/invite" element={<InvitePage />} />
      {/* Backwards-compatible alias: redirect old portal entry to login */}
      <Route path="/portal" element={<Navigate to="/login" replace />} />
      {/* Auth routes - only redirect if user is authenticated and verified */}
      <Route
        path="/login"
        element={
          user && user.verified ? (
            <Navigate to={getRedirectUrl()} replace />
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
      {/* Redirect legacy worker portal paths */}
      <Route path="/worker/*" element={<Navigate to="/specialist/dashboard" replace />} />

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
          ) : user.role !== "SUPER_ADMIN" ? (
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
          ) : user.role !== "SUPER_ADMIN" ? (
            <Navigate to={getRedirectUrl()} replace />
          ) : (
            <DashboardLayout>
              <SuperAdminDashboard />
            </DashboardLayout>
          )
        }
      />

      {/* Root redirect - only redirect if user is authenticated */}
      <Route
        path="/"
        element={
          user && user.verified ? (
            <Navigate to={getRedirectUrl()} replace />
          ) : (
            <Navigate to="/login" replace />
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
    </>
  );
}

export default App;
