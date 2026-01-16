import React from "react";
import { useSelector, useDispatch } from "react-redux";
import { RootState } from "@/store";
import { logout } from "@/store/slices/authSlice";
import { BarChart3, LogOut, Settings, User } from "lucide-react";
import zoesiBlueLogoUrl from "@/assets/zoesi-blue.png";

interface LayoutProps {
  children: React.ReactNode;
  title: string;
}

const Layout: React.FC<LayoutProps> = ({ children, title }) => {
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.auth);
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const handleLogout = () => {
    dispatch(logout() as any);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-3">
              {isSuperAdmin ? (
                <img
                  src={zoesiBlueLogoUrl}
                  alt="Zoesi"
                  className="h-10 w-auto max-w-[200px] object-contain"
                />
              ) : (
                <BarChart3 className="h-8 w-8 text-primary-600" />
              )}
              <div>
                {!isSuperAdmin && (
                  <h1 className="text-xl font-bold text-gray-900">
                    YourSEODashboard
                  </h1>
                )}
                <p className="text-sm text-gray-600">{title}</p>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <User className="h-4 w-4" />
                <span>{user?.name || user?.email}</span>
                <span className="bg-primary-100 text-primary-800 px-2 py-1 rounded text-xs">
                  {user?.role}
                </span>
              </div>
              <button className="p-2 text-gray-400 hover:text-gray-600 transition-colors">
                <Settings className="h-5 w-5" />
              </button>
              <button
                onClick={handleLogout}
                className="p-2 text-gray-400 hover:text-red-600 transition-colors"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
};

export default Layout;
