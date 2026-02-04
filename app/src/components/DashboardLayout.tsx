import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import { RootState } from "@/store";
import Sidebar from "./Sidebar";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user } = useSelector((state: RootState) => state.auth);
  const isClientPortal = location.pathname.startsWith("/client/");

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
    if (path === "/agency/users") return "Users";
    if (path === "/agency/report") return "Report";
    if (path === "/agency/team") return "Team";
    if (path.startsWith("/agency/clients/")) return "Client Dashboard";
    if (path === "/agency/workers") return "Team";
    if (path === "/agency/settings") return "Settings";

    if (path === "/superadmin/dashboard") return "Dashboard";
    if (path === "/superadmin/financial-overview") return "Financial Overview";
    if (path === "/superadmin/settings") return "Settings";
    if (path === "/superadmin/clients") return "Clients";
    if (path === "/superadmin/agencies/myagency") return "My Agency";
    if (path === "/superadmin/agencies/allagencies") return "All Agencies";
    if (path === "/superadmin/tasks") return "Tasks";

    if (path === "/specialist/dashboard") return "Dashboard";
    if (path === "/specialist/myagency") return "My Agency";
    if (path === "/specialist/tasks") return "Tasks";
    if (path === "/specialist/team") return "Team";
    if (path === "/specialist/settings") return "Settings";

    if (path === "/client/report" || path.startsWith("/client/report/")) return "Report";

    return "Dashboard";
  };

  // Client portal: no sidebar/header chrome.
  if (isClientPortal || user?.role === "USER") {
    return <div className="min-h-screen bg-gray-50">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div
        // Sidebar is `fixed` (out of flow). Use padding-left instead of margin-left
        // so we don't create horizontal overflow (especially on smaller screens).
        className={`w-full transition-all duration-300 flex flex-col ${sidebarCollapsed ? "pl-16" : "pl-64"}`}
      >
        <div className="bg-white border-b border-gray-200 px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-900">{getPageTitle()}</h1>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {children}
        </div>
      </div>
    </div>
  );
};

export default DashboardLayout;
