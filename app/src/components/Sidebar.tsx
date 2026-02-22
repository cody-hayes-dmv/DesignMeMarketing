import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { RootState } from "../store";
import { logout } from "../store/slices/authSlice";
import logoUrl from "@/assets/zoesi-white.png";
import api from "@/lib/api";
import {
  BarChart3,
  Home,
  FolderOpen,
  Search,
  FileText,
  Settings,
  LogOut,
  Users,
  UserPlus,
  Building2,
  Store,
  Menu,
  ChevronLeft,
  PersonStanding,
  UserCog,
  DollarSign,
  Briefcase,
  Package,
  CreditCard,
  FolderPlus,
  Calculator,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const { user } = useSelector((state: RootState) => state.auth);
  const [agencyMe, setAgencyMe] = useState<{ isBusinessTier?: boolean; trialExpired?: boolean } | null>(null);
  const [hasIncludedClients, setHasIncludedClients] = useState(false);
  const showZoesiLogo = user?.role === "SUPER_ADMIN" || user?.role === "AGENCY";

  useEffect(() => {
    if (user?.role === "AGENCY" || user?.role === "ADMIN") {
      api.get("/agencies/me").then((r) => setAgencyMe(r.data)).catch(() => setAgencyMe(null));
    } else {
      setAgencyMe(null);
    }
  }, [user?.role]);

  const refetchHasIncluded = () => {
    if (user?.role === "AGENCY" || user?.role === "ADMIN") {
      api.get<{ hasIncluded: boolean }>("/agencies/included-clients/exists")
        .then((r) => setHasIncludedClients(r.data?.hasIncluded ?? false))
        .catch(() => setHasIncludedClients(false));
    }
  };

  useEffect(() => {
    refetchHasIncluded();
    if (user?.role !== "AGENCY" && user?.role !== "ADMIN") {
      setHasIncludedClients(false);
    }
  }, [user?.role]);

  useEffect(() => {
    const handler = () => refetchHasIncluded();
    window.addEventListener("included-clients-changed", handler);
    return () => window.removeEventListener("included-clients-changed", handler);
  }, [user?.role]);

  const panelLabel =
    user?.role === "SUPER_ADMIN"
      ? "Super Admin Panel"
      : user?.role === "AGENCY"
        ? "Agency Panel"
        : user?.role === "ADMIN"
          ? "Admin Panel"
          : user?.role === "SPECIALIST"
            ? "Specialist Panel"
            : user?.role
              ? `${user.role} Panel`
              : "Panel";

  const handleLogout = () => {
    dispatch(logout() as any);
    navigate("/login");
  };

  const toggleSubMenu = (path: string) => {
    setOpenMenu(openMenu === path ? null : path);
  };

  type MenuItem = {
    icon: LucideIcon;
    label: string;
    path: string;
    hasSubMenu: boolean;
    roles: string[];
    subMenus?: { label: string; path: string }[];
  };

  const menuItems: MenuItem[] = [
    // Dashboard, Agencies, Clients, Research (keywords), Rankings, Reports, Team, Settings
    // Accessible by AGENCY, ADMIN, and SUPER_ADMIN
    {
      icon: Home,
      label: "Dashboard",
      path: "/agency/dashboard",
      hasSubMenu: false,
      roles: ["AGENCY", "ADMIN"],
    },
    {
      icon: Home,
      label: "Dashboard",
      path: "/superadmin/dashboard",
      hasSubMenu: false,
      roles: ["SUPER_ADMIN"],
    },
    {
      icon: DollarSign,
      label: "Financial Overview",
      path: "/superadmin/financial-overview",
      hasSubMenu: false,
      roles: ["SUPER_ADMIN"],
    },
    {
      icon: Calculator,
      label: "Enterprise Calculator",
      path: "/superadmin/enterprise-calculator",
      hasSubMenu: false,
      roles: ["SUPER_ADMIN"],
    },
    {
      icon: Sparkles,
      label: "AI Commands",
      path: "/superadmin/ai-commands",
      hasSubMenu: false,
      roles: ["SUPER_ADMIN"],
    },
    {
      icon: Building2,
      label: "Agencies",
      path: "/agency/agencies",
      hasSubMenu: false,
      roles: ["ADMIN", "SUPER_ADMIN"],
    },
    {
      icon: PersonStanding,
      label: "Clients",
      path: "/agency/clients",
      hasSubMenu: false,
      roles: ["AGENCY", "ADMIN", "SUPER_ADMIN"],
    },
    {
      icon: Store,
      label: "Vendasta",
      path: "/agency/vendasta",
      hasSubMenu: false,
      roles: ["ADMIN", "SUPER_ADMIN"],
    },
    {
      icon: FolderPlus,
      label: "Included",
      path: "/agency/included",
      hasSubMenu: false,
      roles: ["AGENCY", "ADMIN"],
    },
    {
      icon: FolderOpen,
      label: "Tasks",
      path: "/agency/tasks",
      hasSubMenu: false,
      roles: ["AGENCY", "ADMIN", "SUPER_ADMIN"],
    },
    {
      icon: Search,
      label: "Research",
      path: "/agency/keywords",
      hasSubMenu: false,
      roles: ["AGENCY", "ADMIN", "SUPER_ADMIN"],
    },
    // {
    //   icon: Target,
    //   label: "Rankings",
    //   path: "/agency/rankings",
    //   hasSubMenu: false,
    //   roles: ["AGENCY", "ADMIN", "SUPER_ADMIN"],
    // },
    {
      icon: FileText,
      label: "Reports",
      path: "/agency/reports",
      hasSubMenu: false,
      roles: ["AGENCY", "ADMIN", "SUPER_ADMIN"],
    },
    {
      icon: Briefcase,
      label: "Managed Services",
      path: "/agency/managed-services",
      hasSubMenu: false,
      roles: ["AGENCY", "ADMIN"],
    },
    {
      icon: Package,
      label: "Add-Ons",
      path: "/agency/add-ons",
      hasSubMenu: false,
      roles: ["AGENCY", "ADMIN"],
    },
    {
      icon: CreditCard,
      label: "Subscription",
      path: "/agency/subscription",
      hasSubMenu: false,
      roles: ["AGENCY", "ADMIN"],
    },
    {
      icon: UserPlus,
      label: "Users",
      path: "/agency/users",
      hasSubMenu: false,
      roles: ["AGENCY", "ADMIN", "SUPER_ADMIN"],
    },
    {
      icon: Users,
      label: "Team",
      path: "/agency/team",
      hasSubMenu: false,
      roles: ["AGENCY", "ADMIN", "SUPER_ADMIN"],
    },
    {
      icon: Settings,
      label: "Settings",
      path: "/agency/settings",
      hasSubMenu: false,
      roles: ["AGENCY", "ADMIN", "SUPER_ADMIN"],
    },

    // Specialist role
    {
      icon: Home,
      label: "Dashboard",
      path: "/specialist/dashboard",
      hasSubMenu: false,
      roles: ["SPECIALIST"],
    },
    {
      icon: PersonStanding,
      label: "My Clients",
      path: "/specialist/clients",
      hasSubMenu: false,
      roles: ["SPECIALIST"],
    },
    {
      icon: FolderOpen,
      label: "Tasks",
      path: "/specialist/tasks",
      hasSubMenu: false,
      roles: ["SPECIALIST"],
    },
    {
      icon: Settings,
      label: "Settings",
      path: "/specialist/settings",
      hasSubMenu: false,
      roles: ["SPECIALIST"],
    },
  ];

  const filteredMenuItems = menuItems
    .filter((item) => item.roles.includes(user?.role || ""))
    .filter((item) => !(item.path === "/agency/users" && agencyMe?.isBusinessTier))
    .filter((item) => item.path !== "/agency/included" || hasIncludedClients)
    .map((item) => {
      if (item.path === "/agency/clients" && agencyMe?.isBusinessTier) {
        return { ...item, label: "Your Business" };
      }
      return item;
    });

  return (
    <div
      className={`${collapsed ? "w-16" : "w-64"
        } bg-gray-900 h-screen flex flex-col transition-all duration-300 fixed left-0 top-0 z-30`}
    >
      {/* Toggle Button */}
      <div className="absolute -right-3 top-6 z-40">
        <button
          onClick={onToggle}
          className="bg-white border border-gray-200 rounded-full p-1.5 shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-110"
        >
          {collapsed ? (
            <Menu className="h-4 w-4 text-gray-600" />
          ) : (
            <ChevronLeft className="h-4 w-4 text-gray-600" />
          )}
        </button>
      </div>

      {/* Logo & panel label: centered, logo prominent, label underneath */}
      <div
        className={`${collapsed ? "px-3 py-5" : "px-4 py-6"
          } border-b border-gray-700 transition-all duration-300 flex flex-col items-center justify-center text-center`}
      >
        {showZoesiLogo ? (
          <>
            <img
              src={logoUrl}
              alt="Zoesi"
              className={`${collapsed ? "h-8 w-8" : "h-14 w-auto max-w-[180px]"
                } object-contain transition-all duration-300`}
            />
            {!collapsed && (
              <p className="mt-2 text-xs font-medium text-gray-400 tracking-wide">
                {panelLabel}
              </p>
            )}
          </>
        ) : (
          <>
            <BarChart3
              className={`${collapsed ? "h-8 w-8" : "h-10 w-10"
                } text-primary-400 transition-all duration-300 shrink-0`}
            />
            {!collapsed && (
              <div className="mt-2">
                <h1 className="text-base font-bold text-white">SEO Dashboard</h1>
                <p className="text-xs text-gray-400 mt-0.5">{panelLabel}</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Navigation */}
      <nav
        className={`flex-1 ${collapsed ? "p-2" : "p-4"
          } transition-all duration-300`}
      >
        <ul className="space-y-2">
          {filteredMenuItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.path ||
              (item.path !== "agency/dashboard" &&
                location.pathname.startsWith(item.path));
            const isOpen = openMenu === item.path;

            return (
              <li key={item.path}>
                <button
                  onClick={() => {
                    if (item.hasSubMenu) {
                      toggleSubMenu(item.path);
                    } else {
                      navigate(item.path);
                    }
                  }}
                  className={`w-full flex items-center ${collapsed
                    ? "justify-center px-2 py-3"
                    : "space-x-3 px-4 py-3"
                    } rounded-lg text-left transition-all duration-300 ${isActive
                      ? "bg-primary-600 text-white"
                      : "text-gray-300 hover:bg-gray-800 hover:text-white"
                    } group relative`}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon
                    className={`${collapsed ? "h-5 w-5" : "h-5 w-5"
                      } transition-all duration-300`}
                  />
                  {!collapsed && (
                    <span className="font-medium transition-opacity duration-300">
                      {item.label}
                    </span>
                  )}
                  {collapsed && (
                    <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-sm rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                      {item.label}
                    </div>
                  )}
                </button>
                {/* Submenu */}
                {item.hasSubMenu && (
                  <div
                    className={`overflow-hidden transition-all duration-300 ease-in-out
      ${isOpen && !collapsed ? "max-h-40 opacity-100 mt-1" : "max-h-0 opacity-0"}`}
                  >
                    <ul className="ml-4 space-y-1">
                      {item.subMenus?.map((sub) => {
                        const subActive = location.pathname === sub.path;
                        return (
                          <li key={sub.path}>
                            <button
                              onClick={() => navigate(sub.path)}
                              className={`w-full flex items-center space-x-2 px-3 py-2 rounded-lg text-sm transition-all duration-300 
                                  ${subActive
                                  ? "bg-primary-500 text-white"
                                  : "text-gray-400 hover:bg-gray-700 hover:text-white"
                                }`}
                            >
                              <span>{sub.label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User Info & Logout */}
      <div
        className={`${collapsed ? "p-2" : "p-4"
          } border-t border-gray-700 transition-all duration-300`}
      >
        <div
          className={`flex items-center ${collapsed ? "justify-center mb-2" : "space-x-3 mb-4"
            } transition-all duration-300`}
        >
          <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center">
            <span className="text-sm font-medium text-white">
              {user?.name?.charAt(0) || user?.email?.charAt(0)}
            </span>
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0 transition-opacity duration-300">
              <p className="text-sm font-medium text-white truncate">
                {user?.name || user?.email}
              </p>
              <p className="text-xs text-gray-400">{user?.email}</p>
            </div>
          )}
        </div>
        <button
          onClick={handleLogout}
          className={`w-full flex items-center ${collapsed ? "justify-center px-2 py-2" : "space-x-3 px-4 py-2"
            } text-gray-300 hover:bg-red-600 hover:text-white rounded-lg transition-all duration-300 group relative`}
          title={collapsed ? "Sign out" : undefined}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && (
            <span className="text-sm transition-opacity duration-300">
              Sign out
            </span>
          )}
          {collapsed && (
            <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-sm rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
              Sign out
            </div>
          )}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
