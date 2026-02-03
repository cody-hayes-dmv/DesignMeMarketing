import React, { useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { RootState } from "../store";
import {
  User,
  Building2,
  Bell,
  Shield,
  CreditCard,
  Save,
  Eye,
  EyeOff,
  Loader2,
  FileText,
  Plus,
  Pencil,
  Trash2,
  X,
  GripVertical,
} from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { checkAuth } from "@/store/slices/authSlice";

const SettingsPage = () => {
  const { user } = useSelector((state: RootState) => state.auth);
  const dispatch = useDispatch();
  const [activeTab, setActiveTab] = useState("profile");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [agencyLoading, setAgencyLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [profileForm, setProfileForm] = useState({
    name: user?.name || "",
    email: user?.email || "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [agencyForm, setAgencyForm] = useState({
    name: "",
    subdomain: "",
    website: "",
  });

  const [notificationSettings, setNotificationSettings] = useState({
    emailReports: true,
    rankingAlerts: true,
    weeklyDigest: false,
    teamUpdates: true,
  });

  // Templates (onboarding)
  type TemplateTask = { id?: string; title: string; description: string | null; category: string | null; priority: string | null; estimatedHours: number | null; order: number };
  type ManageableTemplate = {
    id: string;
    name: string;
    description: string | null;
    isDefault: boolean;
    agencyId: string | null;
    agency?: { id: string; name: string } | null;
    tasks: TemplateTask[];
  };
  const [templates, setTemplates] = useState<ManageableTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateModalMode, setTemplateModalMode] = useState<"create" | "edit">("create");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateForm, setTemplateForm] = useState({ name: "", description: "", isDefault: false, agencyId: "" as string | null, tasks: [] as Array<{ title: string; description: string; category: string; priority: string; estimatedHours: string }> });
  const [templateSaveLoading, setTemplateSaveLoading] = useState(false);
  const [agenciesList, setAgenciesList] = useState<Array<{ id: string; name: string }>>([]);

  // Remove billing tab for SUPER_ADMIN, remove agency tab for SUPER_ADMIN (they don't have agencies)
  const tabs = [
    { id: "profile", label: "Profile", icon: User, roles: ["SUPER_ADMIN", "ADMIN", "AGENCY", "WORKER"] },
    { id: "agency", label: "Agency", icon: Building2, roles: ["AGENCY", "ADMIN"] },
    { id: "templates", label: "Templates", icon: FileText, roles: ["SUPER_ADMIN", "ADMIN", "AGENCY"] },
    { id: "notifications", label: "Notifications", icon: Bell, roles: ["SUPER_ADMIN", "ADMIN", "AGENCY", "WORKER"] },
    { id: "security", label: "Security", icon: Shield, roles: ["SUPER_ADMIN", "ADMIN", "AGENCY", "WORKER"] },
    { id: "billing", label: "Billing", icon: CreditCard, roles: ["ADMIN", "AGENCY", "WORKER"] },
  ];

  // Fetch agency data on mount if user has agency access
  useEffect(() => {
    if (user && (user.role === "AGENCY" || user.role === "ADMIN" || user.role === "SUPER_ADMIN")) {
      fetchAgencyData();
    }
  }, [user]);

  // Update profile form when user changes
  useEffect(() => {
    if (user) {
      setProfileForm((prev) => ({
        ...prev,
        name: user.name || "",
        email: user.email || "",
      }));
    }
  }, [user]);

  // Fetch manageable templates when Templates tab is active
  const fetchManageableTemplates = async () => {
    try {
      setTemplatesLoading(true);
      const res = await api.get("/onboarding/templates/manageable");
      setTemplates(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      toast.error("Failed to load templates");
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  };
  useEffect(() => {
    if (activeTab === "templates" && user && ["SUPER_ADMIN", "ADMIN", "AGENCY"].includes(user.role || "")) {
      fetchManageableTemplates();
    }
  }, [activeTab, user?.role]);

  // Fetch agencies for super admin when opening template create modal
  useEffect(() => {
    if (templateModalOpen && templateModalMode === "create" && user?.role === "SUPER_ADMIN") {
      api.get("/agencies").then((res) => {
        const list = Array.isArray(res.data) ? res.data : [];
        setAgenciesList(list.map((a: any) => ({ id: a.id, name: a.name || a.subdomain || a.id })));
      }).catch(() => setAgenciesList([]));
    }
  }, [templateModalOpen, templateModalMode, user?.role]);

  const fetchAgencyData = async () => {
    try {
      setAgencyLoading(true);
      const response = await api.get("/agencies/me");
      // Handle null response for SUPER_ADMIN (though they shouldn't call this)
      if (response.data) {
        setAgencyForm({
          name: response.data.name || "",
          subdomain: response.data.subdomain || "",
          website: "", // Not stored in backend currently
        });
      }
    } catch (error: any) {
      if (error.response?.status !== 404) {
        console.error("Error fetching agency data:", error);
      }
    } finally {
      setAgencyLoading(false);
    }
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const updateData: { name?: string; email?: string } = {};
      if (profileForm.name !== user?.name) {
        updateData.name = profileForm.name;
      }
      if (profileForm.email !== user?.email) {
        updateData.email = profileForm.email;
      }

      if (Object.keys(updateData).length === 0) {
        toast.error("No changes to save");
        return;
      }

      await api.put("/auth/profile", updateData);
      toast.success("Profile updated successfully!");
      // Refresh user data
      dispatch(checkAuth() as any);
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (profileForm.newPassword !== profileForm.confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }

    if (profileForm.newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    try {
      setPasswordLoading(true);
      await api.put("/auth/password", {
        currentPassword: profileForm.currentPassword,
        newPassword: profileForm.newPassword,
      });
      toast.success("Password updated successfully!");
      setProfileForm({
        ...profileForm,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to update password");
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleAgencySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const updateData: { name?: string; subdomain?: string } = {};
      if (agencyForm.name) {
        updateData.name = agencyForm.name;
      }
      if (agencyForm.subdomain) {
        updateData.subdomain = agencyForm.subdomain;
      }

      if (Object.keys(updateData).length === 0) {
        toast.error("No changes to save");
        return;
      }

      await api.put("/agencies/me", updateData);
      toast.success("Agency settings updated successfully!");
      fetchAgencyData();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to update agency settings");
    } finally {
      setLoading(false);
    }
  };

  const openCreateTemplate = () => {
    setTemplateModalMode("create");
    setEditingTemplateId(null);
    setTemplateForm({
      name: "",
      description: "",
      isDefault: false,
      agencyId: user?.role === "SUPER_ADMIN" ? null : undefined as any,
      tasks: [],
    });
    setTemplateModalOpen(true);
  };

  const openEditTemplate = (t: ManageableTemplate) => {
    setTemplateModalMode("edit");
    setEditingTemplateId(t.id);
    setTemplateForm({
      name: t.name,
      description: t.description || "",
      isDefault: t.isDefault,
      agencyId: t.agencyId ?? "",
      tasks: t.tasks.map((task) => ({
        title: task.title,
        description: task.description ?? "",
        category: task.category ?? "",
        priority: task.priority ?? "",
        estimatedHours: task.estimatedHours != null ? String(task.estimatedHours) : "",
      })),
    });
    setTemplateModalOpen(true);
  };

  const addTemplateTask = () => {
    setTemplateForm((f) => ({
      ...f,
      tasks: [...f.tasks, { title: "", description: "", category: "", priority: "", estimatedHours: "" }],
    }));
  };

  const updateTemplateTask = (index: number, field: string, value: string) => {
    setTemplateForm((f) => ({
      ...f,
      tasks: f.tasks.map((t, i) => (i === index ? { ...t, [field]: value } : t)),
    }));
  };

  const removeTemplateTask = (index: number) => {
    setTemplateForm((f) => ({ ...f, tasks: f.tasks.filter((_, i) => i !== index) }));
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateForm.name.trim()) {
      toast.error("Template name is required");
      return;
    }
    const tasksPayload = templateForm.tasks
      .filter((t) => t.title.trim())
      .map((t, i) => ({
        title: t.title.trim(),
        description: t.description.trim() || null,
        category: t.category.trim() || null,
        priority: t.priority.trim() || null,
        estimatedHours: t.estimatedHours.trim() ? parseFloat(t.estimatedHours) : null,
        order: i + 1,
      }));
    setTemplateSaveLoading(true);
    try {
      if (templateModalMode === "create") {
        const body: any = {
          name: templateForm.name.trim(),
          description: templateForm.description.trim() || null,
          isDefault: templateForm.isDefault,
          tasks: tasksPayload,
        };
        if (user?.role === "SUPER_ADMIN" && templateForm.agencyId !== undefined) {
          body.agencyId = templateForm.agencyId === "" ? null : templateForm.agencyId;
        }
        await api.post("/onboarding/templates", body);
        toast.success("Template created");
      } else if (editingTemplateId) {
        await api.put(`/onboarding/templates/${editingTemplateId}`, {
          name: templateForm.name.trim(),
          description: templateForm.description.trim() || null,
          isDefault: templateForm.isDefault,
          tasks: tasksPayload,
        });
        toast.success("Template updated");
      }
      setTemplateModalOpen(false);
      fetchManageableTemplates();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to save template");
    } finally {
      setTemplateSaveLoading(false);
    }
  };

  const handleDeleteTemplate = async (t: ManageableTemplate) => {
    if (!window.confirm(`Delete template "${t.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/onboarding/templates/${t.id}`);
      toast.success("Template deleted");
      fetchManageableTemplates();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to delete template");
    }
  };

  const filteredTabs = tabs.filter((tab) =>
    tab.roles.includes(user?.role || "")
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case "profile":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Profile Information
              </h3>
              <form onSubmit={handleProfileSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={profileForm.name}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, name: e.target.value })
                      }
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={profileForm.email}
                      onChange={(e) =>
                        setProfileForm({
                          ...profileForm,
                          email: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  <span>Save Changes</span>
                </button>
              </form>
            </div>

            <div className="border-t border-gray-200 pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Change Password
              </h3>
              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Current Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={profileForm.currentPassword}
                      onChange={(e) =>
                        setProfileForm({
                          ...profileForm,
                          currentPassword: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      New Password
                    </label>
                    <input
                      type="password"
                      value={profileForm.newPassword}
                      onChange={(e) =>
                        setProfileForm({
                          ...profileForm,
                          newPassword: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Confirm Password
                    </label>
                    <input
                      type="password"
                      value={profileForm.confirmPassword}
                      onChange={(e) =>
                        setProfileForm({
                          ...profileForm,
                          confirmPassword: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {passwordLoading ? (
                    <span className="flex items-center space-x-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Updating...</span>
                    </span>
                  ) : (
                    "Update Password"
                  )}
                </button>
              </form>
            </div>
          </div>
        );

      case "agency":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Agency Settings
              </h3>
              {agencyLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
                </div>
              ) : (
                <form onSubmit={handleAgencySubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Agency Name
                    </label>
                    <input
                      type="text"
                      value={agencyForm.name}
                      onChange={(e) =>
                        setAgencyForm({ ...agencyForm, name: e.target.value })
                      }
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Subdomain
                    </label>
                    <div className="flex">
                      <input
                        type="text"
                        value={agencyForm.subdomain}
                        onChange={(e) =>
                          setAgencyForm({
                            ...agencyForm,
                            subdomain: e.target.value,
                          })
                        }
                        className="flex-1 px-4 py-3 border border-gray-300 rounded-l-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                      <span className="bg-gray-50 border border-l-0 border-gray-300 rounded-r-lg px-4 py-3 text-gray-500">
                        .yourseodashboard.com
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Website
                    </label>
                    <input
                      type="url"
                      value={agencyForm.website}
                      onChange={(e) =>
                        setAgencyForm({ ...agencyForm, website: e.target.value })
                      }
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="https://example.com"
                    />
                    <p className="text-sm text-gray-500 mt-1">
                      Note: Website URL is not currently saved to the backend
                    </p>
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    <span>Save Changes</span>
                  </button>
                </form>
              )}
            </div>
          </div>
        );

      case "templates":
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Onboarding Templates</h3>
              <button
                type="button"
                onClick={openCreateTemplate}
                className="inline-flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Create template
              </button>
            </div>
            <p className="text-sm text-gray-500">
              Create and edit onboarding templates. When you add an onboarding task from a client’s Work Log, you choose one of these templates.
            </p>
            {templatesLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No templates yet.</p>
                <p className="text-sm text-gray-500 mt-1">Create one to use when adding onboarding tasks for clients.</p>
                <button
                  type="button"
                  onClick={openCreateTemplate}
                  className="mt-4 inline-flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700"
                >
                  <Plus className="h-4 w-4" />
                  Create template
                </button>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tasks</th>
                      {user?.role === "SUPER_ADMIN" && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scope</th>
                      )}
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {templates.map((t) => (
                      <tr key={t.id}>
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{t.name}</span>
                          {t.isDefault && (
                            <span className="ml-2 text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded">Default</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{t.tasks?.length ?? 0} tasks</td>
                        {user?.role === "SUPER_ADMIN" && (
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {t.agencyId == null ? "Global" : t.agency?.name ?? t.agencyId}
                          </td>
                        )}
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openEditTemplate(t)}
                            className="text-primary-600 hover:text-primary-800 p-1"
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTemplate(t)}
                            className="text-red-600 hover:text-red-800 p-1 ml-2"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );

      case "notifications":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Notification Preferences
              </h3>
              <div className="space-y-4">
                {Object.entries(notificationSettings).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {key
                          .replace(/([A-Z])/g, " $1")
                          .replace(/^./, (str) => str.toUpperCase())}
                      </p>
                      <p className="text-sm text-gray-500">
                        {key === "emailReports" &&
                          "Receive automated email reports"}
                        {key === "rankingAlerts" &&
                          "Get notified of significant ranking changes"}
                        {key === "weeklyDigest" &&
                          "Weekly summary of all projects"}
                        {key === "teamUpdates" &&
                          "Updates about team member activities"}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setNotificationSettings({
                          ...notificationSettings,
                          [key]: !value,
                        });
                        // TODO: Save to backend when endpoint is available
                        toast.success("Notification preference updated");
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${value ? "bg-primary-600" : "bg-gray-200"
                        }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value ? "translate-x-6" : "translate-x-1"
                          }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      case "security":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Security Settings
              </h3>
              <div className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        Two-Factor Authentication
                      </p>
                      <p className="text-sm text-gray-500">
                        Add an extra layer of security to your account
                      </p>
                    </div>
                    <button
                      onClick={() => toast("2FA feature coming soon", { icon: "ℹ️" })}
                      className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors"
                    >
                      Enable
                    </button>
                  </div>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        API Keys
                      </p>
                      <p className="text-sm text-gray-500">
                        Manage API access for integrations
                      </p>
                    </div>
                    <button
                      onClick={() => toast("API Keys feature coming soon", { icon: "ℹ️" })}
                      className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300 transition-colors"
                    >
                      Manage
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case "billing":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Billing Information
              </h3>
              <div className="bg-primary-50 border border-primary-200 p-4 rounded-lg mb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-primary-900">
                      Professional Plan
                    </p>
                    <p className="text-sm text-primary-700">
                      $299/month • Next billing: Feb 15, 2024
                    </p>
                  </div>
                  <button
                    onClick={() => toast("Billing feature coming soon", { icon: "ℹ️" })}
                    className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    Upgrade
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        Payment Method
                      </p>
                      <p className="text-sm text-gray-500">
                        •••• •••• •••• 4242
                      </p>
                    </div>
                    <button
                      onClick={() => toast("Payment method update coming soon", { icon: "ℹ️" })}
                      className="text-primary-600 hover:text-primary-700 text-sm font-medium"
                    >
                      Update
                    </button>
                  </div>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        Billing History
                      </p>
                      <p className="text-sm text-gray-500">
                        View past invoices and payments
                      </p>
                    </div>
                    <button
                      onClick={() => toast("Billing history coming soon", { icon: "ℹ️" })}
                      className="text-primary-600 hover:text-primary-700 text-sm font-medium"
                    >
                      View History
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-2">
          Manage your account and preferences
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar */}
        <div className="lg:col-span-1">
          <nav className="space-y-2">
            {filteredTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-left transition-colors ${activeTab === tab.id
                    ? "bg-primary-50 text-primary-700 border border-primary-200"
                    : "text-gray-700 hover:bg-gray-50"
                    }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="font-medium">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-xl border border-gray-200 p-8">
            {renderTabContent()}
          </div>
        </div>
      </div>

      {/* Create/Edit Template Modal */}
      {templateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setTemplateModalOpen(false)} />
          <div className="relative bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {templateModalMode === "create" ? "Create template" : "Edit template"}
              </h3>
              <button type="button" onClick={() => setTemplateModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveTemplate} className="flex flex-col flex-1 min-h-0">
              <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="e.g. Standard SEO Onboarding"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                  <input
                    type="text"
                    value={templateForm.description}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, description: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="Short description of this template"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="template-default"
                    checked={templateForm.isDefault}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, isDefault: e.target.checked }))}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="template-default" className="text-sm text-gray-700">Set as default template</label>
                </div>
                {user?.role === "SUPER_ADMIN" && templateModalMode === "create" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Scope</label>
                    <select
                      value={templateForm.agencyId ?? ""}
                      onChange={(e) => setTemplateForm((f) => ({ ...f, agencyId: e.target.value || null }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="">Global (all agencies)</option>
                      {agenciesList.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">Tasks</label>
                    <button type="button" onClick={addTemplateTask} className="text-sm text-primary-600 hover:text-primary-800 flex items-center gap-1">
                      <Plus className="h-4 w-4" /> Add task
                    </button>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-2">
                    {templateForm.tasks.length === 0 ? (
                      <p className="text-sm text-gray-500 py-4 text-center">No tasks. Click &quot;Add task&quot; to add one.</p>
                    ) : (
                      templateForm.tasks.map((task, index) => (
                        <div key={index} className="flex gap-2 items-start p-2 bg-gray-50 rounded-lg border border-gray-200">
                          <span className="text-gray-400 mt-2 flex-shrink-0" title="Order"><GripVertical className="h-4 w-4" /></span>
                          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
                            <input
                              type="text"
                              value={task.title}
                              onChange={(e) => updateTemplateTask(index, "title", e.target.value)}
                              placeholder="Task title"
                              className="border border-gray-300 rounded px-2 py-1.5 text-sm"
                            />
                            <input
                              type="text"
                              value={task.description}
                              onChange={(e) => updateTemplateTask(index, "description", e.target.value)}
                              placeholder="Description (optional)"
                              className="border border-gray-300 rounded px-2 py-1.5 text-sm"
                            />
                            <input
                              type="text"
                              value={task.category}
                              onChange={(e) => updateTemplateTask(index, "category", e.target.value)}
                              placeholder="Category (e.g. Onboarding)"
                              className="border border-gray-300 rounded px-2 py-1.5 text-sm"
                            />
                            <div className="flex gap-2">
                              <select
                                value={task.priority}
                                onChange={(e) => updateTemplateTask(index, "priority", e.target.value)}
                                className="border border-gray-300 rounded px-2 py-1.5 text-sm flex-1"
                              >
                                <option value="">Priority</option>
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                              </select>
                              <input
                                type="number"
                                min={0}
                                step={0.5}
                                value={task.estimatedHours}
                                onChange={(e) => updateTemplateTask(index, "estimatedHours", e.target.value)}
                                placeholder="Hrs"
                                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-20"
                              />
                            </div>
                          </div>
                          <button type="button" onClick={() => removeTemplateTask(index)} className="text-red-600 hover:text-red-800 p-1 flex-shrink-0 mt-1" title="Remove task">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
                <button type="button" onClick={() => setTemplateModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={templateSaveLoading} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2">
                  {templateSaveLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {templateModalMode === "create" ? "Create" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
