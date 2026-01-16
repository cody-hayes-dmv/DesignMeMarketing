import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "./store";
import { checkAuth } from "./store/slices/authSlice";
import { Toaster } from "react-hot-toast";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import WorkerDashboard from "./pages/Worker/WorkerDashboardPage";
import WorkerTeamPage from "./pages/Worker/WorkerTeamPage";
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
import WorkersPage from "./pages/WorkersPage";
import ClientDashboardPage from "./pages/ClientDashboardPage";
import ShareDashboardPage from "./pages/ShareDashboardPage";
import AuthLandingPage from "./pages/AuthLandingPage";
import ClientReportIndexPage from "./pages/ClientReportIndexPage";

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
    // Restore previous worker portal landing
    WORKER: "/worker/dashboard",
    // Client should land on report only
    CLIENT: "/client/report",
  };

  // Agency routes with DashboardLayout - accessible by AGENCY, ADMIN, and SUPER_ADMIN
  const agencyRoutes = [
    { path: "/agency/dashboard", component: AgencyDashboardPage },
    { path: "/agency/agencies", component: AgenciesPage },
    { path: "/agency/clients", component: ClientsPage },
    { path: "/agency/keywords", component: KeywordsPage },
    { path: "/agency/rankings", component: RankingsPage },
    { path: "/agency/reports", component: ReportsPage },
    { path: "/agency/team", component: TeamPage },
    { path: "/agency/workers", component: WorkersPage },
    { path: "/agency/clients/:clientId", component: ClientDashboardPage },
    { path: "/agency/settings", component: SettingsPage },
    { path: "/agency/tasks", component: TasksPage },
  ];

  // Worker routes (restore previous version)
  const workerRoutes = [
    { path: "/worker/dashboard", component: WorkerDashboard },
    { path: "/worker/myagency", component: AgencyDashboardPage },
    { path: "/worker/tasks", component: TasksPage },
    { path: "/worker/team", component: WorkerTeamPage },
    { path: "/worker/settings", component: SettingsPage },
  ];

  // Client routes: report-only
  const clientRoutes = [
    { path: "/client/report", component: ClientReportIndexPage },
    { path: "/client/report/:clientId", component: ClientDashboardPage },
  ];

  const isClientRestrictedPath = (path: string) =>
    !(path === "/client/report" || path.startsWith("/client/report/"));

  const getRedirectUrl = () => {
    if (!user) return "/login";
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
      {/* Auth landing (white-labeled entry) */}
      <Route path="/portal" element={user && user.verified ? <Navigate to={getRedirectUrl()} replace /> : <AuthLandingPage />} />
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


      {/* Worker routes */}
      {workerRoutes.map(({ path, component: Component }) => (
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
            ) : user.role !== "WORKER" ? (
              <Navigate to={getRedirectUrl()} replace />
            ) : (
              <DashboardLayout>
                <Component />
              </DashboardLayout>
            )
          }
        />
      ))}

      {/* Client routes */}
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
            ) : user.role !== "CLIENT" ? (
              <Navigate to={getRedirectUrl()} replace />
            ) : isClientRestrictedPath(path) ? (
              <Navigate to={dashboardUrls.CLIENT} replace />
            ) : (
              <DashboardLayout>
                <Component />
              </DashboardLayout>
            )
          }
        />
      ))}

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
            <Navigate to="/portal" replace />
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
