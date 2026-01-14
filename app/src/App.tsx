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
import WorkersPage from "./pages/WorkersPage";
import ClientDashboardPage from "./pages/ClientDashboardPage";

function App() {
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      dispatch(checkAuth() as any);
    }
  }, [dispatch]);

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
    SUPER_ADMIN: "/agency/dashboard",
    ADMIN: "/agency/dashboard", // Admin uses agency dashboard
    AGENCY: "/agency/dashboard",
    WORKER: "/worker/dashboard",
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

  // Agency routes with DashboardLayout
  const workerRoutes = [
    { path: "/worker/dashboard", component: WorkerDashboard },
    { path: "/worker/myagency", component: AgencyDashboardPage },
    { path: "/worker/tasks", component: TasksPage },
    { path: "/worker/team", component: WorkerTeamPage },
    { path: "/worker/settings", component: SettingsPage },
  ];

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
      {/* <Route
        path="/worker/dashboard"
        element={
          !user || !user.verified ? (
            <Navigate to="/login" replace />
          ) : user.role !== "WORKER" ? (
            <Navigate to={getRedirectUrl()} replace />
          ) : (
            <WorkerDashboard />
          )
        }
      /> */}
      {workerRoutes.map(({ path, component: Component }) => (
        <Route
          key={path}
          path={path}
          element={
            !user || !user.verified ? (
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


      {/* Agency routes - accessible by AGENCY, ADMIN, and SUPER_ADMIN */}
      {agencyRoutes.map(({ path, component: Component }) => (
        <Route
          key={path}
          path={path}
          element={
            !user || !user.verified ? (
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

      {/* Root redirect */}
      <Route path="/" element={<Navigate to={getRedirectUrl()} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}

export default App;
