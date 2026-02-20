import React, { useState, useEffect } from "react";
import {
  Users,
  UserPlus,
  Plus,
  Building2,
  Globe,
  Edit,
  Trash2,
  X,
  Mail,
} from "lucide-react";
import api from "../lib/api";
import { useSelector } from "react-redux";
import { RootState } from "../store";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  verified: boolean;
  invited: boolean;
  lastActive: string | null;
  createdAt: string;
  agencies: Array<{ id: string; name: string; role: string }>;
  clientCount?: number;
  taskCount?: number;
}

const TeamPage = () => {
  const { user } = useSelector((state: RootState) => state.auth);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const SPECIALTY_OPTIONS = [
    { value: "ON_PAGE_SEO", label: "On-Page SEO" },
    { value: "LINK_BUILDING", label: "Link Building" },
    { value: "CONTENT_WRITING", label: "Content Writing" },
    { value: "TECHNICAL_SEO", label: "Technical SEO" },
  ] as const;
  const [inviteForm, setInviteForm] = useState({
    email: "",
    name: "",
    role: "SPECIALIST" as "SPECIALIST" | "ADMIN",
    specialties: [] as string[],
    sendInvitationEmail: true,
  });
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAllUsers, setLoadingAllUsers] = useState(false);
  const [allUsers, setAllUsers] = useState<TeamMember[] | null>(null);
  const [activeView, setActiveView] = useState<"myTeam" | "agencyAccess" | "totalUsers">("myTeam");
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [submittingInvite, setSubmittingInvite] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    role: "SPECIALIST" as "SPECIALIST" | "AGENCY" | "ADMIN",
    newPassword: "",
    confirmPassword: "",
  });

  useEffect(() => {
    fetchTeamMembers();
  }, []);

  // Refetch team when an agency is created so the new agency owner appears in the list
  useEffect(() => {
    const onAgencyCreated = () => fetchTeamMembers();
    window.addEventListener("agency-created", onAgencyCreated);
    return () => window.removeEventListener("agency-created", onAgencyCreated);
  }, []);

  // Refetch team when an agency is deleted so the agency disappears from members' lists
  useEffect(() => {
    const onAgencyDeleted = () => fetchTeamMembers();
    window.addEventListener("agency-deleted", onAgencyDeleted);
    return () => window.removeEventListener("agency-deleted", onAgencyDeleted);
  }, []);

  const fetchTeamMembers = async () => {
    try {
      setLoading(true);
      const response = await api.get("/team");
      setTeamMembers(response.data);
      setError(null);
    } catch (error: any) {
      console.error("Failed to fetch team members:", error);
      setError(error.response?.data?.message || "Failed to fetch team members");
    } finally {
      setLoading(false);
    }
  };

  const fetchAllUsers = async () => {
    if (!(user?.role === "SUPER_ADMIN" || user?.role === "ADMIN")) return;
    try {
      setLoadingAllUsers(true);
      const response = await api.get("/team", { params: { scope: "all" } });
      setAllUsers(response.data);
    } catch (error: any) {
      console.error("Failed to fetch all users:", error);
    } finally {
      setLoadingAllUsers(false);
    }
  };

  useEffect(() => {
    if (activeView === "totalUsers" && allUsers === null) {
      fetchAllUsers();
    }
  }, [activeView, allUsers]);

  const handleInviteTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingInvite(true);
    try {
      const res = await api.post("/team/invite", {
        email: inviteForm.email.trim(),
        name: inviteForm.name.trim(),
        role: inviteForm.role,
        specialties: inviteForm.specialties,
        sendInvitationEmail: inviteForm.sendInvitationEmail,
      });
      setInviteForm({
        email: "",
        name: "",
        role: "SPECIALIST",
        specialties: [],
        sendInvitationEmail: true,
      });
      setShowInviteModal(false);
      const emailSent = res.data?.emailSent !== false;
      if (emailSent) {
        toast.success("Invitation sent successfully!");
      } else {
        toast.success("Team member created. Invitation email could not be sent—use Resend from the list.", { duration: 6000 });
      }
      fetchTeamMembers();
    } catch (error: any) {
      console.error("Failed to invite specialist:", error);
      toast.error(error?.response?.data?.message || "Failed to send invitation");
    } finally {
      setSubmittingInvite(false);
    }
  };

  const toggleSpecialty = (value: string) => {
    setInviteForm((prev) => ({
      ...prev,
      specialties: prev.specialties.includes(value)
        ? prev.specialties.filter((s) => s !== value)
        : [...prev.specialties, value],
    }));
  };

  const handleEditTeamMember = (member: TeamMember) => {
    setSelectedMember(member);
    setEditForm({
      name: member.name,
      role: member.role as "SPECIALIST" | "AGENCY" | "ADMIN",
      newPassword: "",
      confirmPassword: "",
    });
    setShowEditModal(true);
  };

  const handleUpdateTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMember) return;

    if (editForm.newPassword) {
      if (editForm.newPassword !== editForm.confirmPassword) {
        toast.error("Passwords do not match");
        return;
      }
      if (editForm.newPassword.length < 6) {
        toast.error("Password must be at least 6 characters");
        return;
      }
    }

    try {
      const payload: { name: string; role: string; newPassword?: string } = {
        name: editForm.name,
        role: editForm.role,
      };
      if (editForm.newPassword) payload.newPassword = editForm.newPassword;

      const res = await api.put(`/team/${selectedMember.id}`, payload);
      const passwordSet = res.data?.newPassword;
      if (passwordSet) {
        toast.success(`Password updated. New password: ${passwordSet}`, { duration: 10000 });
      } else {
        toast.success("Team member updated successfully!");
      }
      setShowEditModal(false);
      setSelectedMember(null);
      fetchTeamMembers();
    } catch (error: any) {
      console.error("Failed to update team member:", error);
    }
  };

  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; memberId: string | null }>({
    isOpen: false,
    memberId: null,
  });

  const handleDeleteTeamMember = async (id: string) => {
    setDeleteConfirm({ isOpen: true, memberId: id });
  };

  const confirmDeleteTeamMember = async () => {
    if (!deleteConfirm.memberId) return;
    try {
      await api.delete(`/team/${deleteConfirm.memberId}`);
      toast.success("Team member removed successfully!");
      fetchTeamMembers();
      setDeleteConfirm({ isOpen: false, memberId: null });
    } catch (error: any) {
      console.error("Failed to delete team member:", error);
      setDeleteConfirm({ isOpen: false, memberId: null });
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getRoleBadge = (role: string) => {
    const styles = {
      AGENCY: "bg-primary-100 text-primary-800",
      SPECIALIST: "bg-secondary-100 text-secondary-800",
      ADMIN: "bg-accent-100 text-accent-800",
    };
    return styles[role as keyof typeof styles] || "bg-gray-100 text-gray-800";
  };

  const getStatusBadge = (member: TeamMember) => {
    const status = getStatusText(member);
    const styles = {
      Active: "bg-green-100 text-green-800",
      Pending: "bg-yellow-100 text-yellow-800",
      Inactive: "bg-gray-100 text-gray-800",
    };
    return styles[status as keyof typeof styles] || "bg-gray-100 text-gray-800";
  };

  const getStatusText = (member: TeamMember) => {
    if (member.verified) return "Active";
    if (member.invited) return "Pending";
    return "Inactive";
  };

  const handleResendInvite = async (member: TeamMember) => {
    if (!member.invited || member.verified) return;
    try {
      const res = await api.post(`/team/${member.id}/resend-invite`);
      const emailSent = res.data?.emailSent !== false;
      if (emailSent) {
        toast.success(`Invitation resent to ${member.email}`);
      } else {
        toast.error("Resend failed. Check SMTP configuration and try again.");
      }
      fetchTeamMembers();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to resend invitation");
    }
  };

  const myTeamMembers = teamMembers.filter((member) =>
    ["ADMIN", "SUPER_ADMIN", "SPECIALIST"].includes(member.role)
  );
  const agencyAdmins = teamMembers.filter((member) => member.role === "AGENCY");
  const totalUsers = allUsers ?? teamMembers;
  const isTableLoading = loading || (activeView === "totalUsers" && loadingAllUsers);

  const visibleMembers =
    activeView === "myTeam"
      ? myTeamMembers
      : activeView === "agencyAccess"
        ? agencyAdmins
        : totalUsers;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-fuchsia-50/30 p-8">
      {/* Header */}
      <div className="relative mb-10 overflow-hidden rounded-2xl bg-gradient-to-r from-fuchsia-600 via-pink-600 to-rose-500 p-8 shadow-lg">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNnKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white md:text-3xl">Team</h1>
            <p className="mt-2 text-fuchsia-100 text-sm md:text-base">
              Manage your team members and their access
            </p>
          </div>
          {(user?.role === "SUPER_ADMIN" || user?.role === "ADMIN") && (
            <button
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-2 rounded-lg bg-white/20 px-5 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
            >
              <Plus className="h-5 w-5" />
              <span>Invite Specialist</span>
            </button>
          )}
        </div>
      </div>

      {/* Team Views */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <button
          type="button"
          onClick={() => setActiveView("myTeam")}
          className={`group relative overflow-hidden bg-white p-6 rounded-2xl border shadow-sm text-left transition-all hover:-translate-y-0.5 hover:shadow-lg ${
            activeView === "myTeam" ? "border-fuchsia-300 ring-2 ring-fuchsia-100 shadow-fuchsia-100/50" : "border-gray-200 hover:shadow-gray-100/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">My Team</p>
              <p className="text-2xl font-bold text-primary-600 mt-1">
                {loading ? "..." : myTeamMembers.length}
              </p>
              <p className="text-xs text-gray-500 mt-1">Admins + Specialists</p>
            </div>
            <Users className="h-8 w-8 text-primary-600" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveView("agencyAccess")}
          className={`bg-white p-6 rounded-xl border shadow-sm text-left transition-all ${
            activeView === "agencyAccess" ? "border-primary-500 ring-2 ring-primary-100" : "border-gray-200 hover:shadow-md"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Agency Access</p>
              <p className="text-2xl font-bold text-blue-600 mt-1">
                {loading ? "..." : agencyAdmins.length}
              </p>
              <p className="text-xs text-gray-500 mt-1">Agency admin logins</p>
            </div>
            <Building2 className="h-8 w-8 text-blue-600" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveView("totalUsers")}
          className={`bg-white p-6 rounded-xl border shadow-sm text-left transition-all ${
            activeView === "totalUsers" ? "border-primary-500 ring-2 ring-primary-100" : "border-gray-200 hover:shadow-md"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Users</p>
              <p className="text-2xl font-bold text-emerald-600 mt-1">
                {isTableLoading ? "..." : totalUsers.length}
              </p>
              <p className="text-xs text-gray-500 mt-1">All platform users</p>
            </div>
            <Globe className="h-8 w-8 text-emerald-600" />
          </div>
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-8">
          {error}
        </div>
      )}

      {/* Team Members Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {activeView === "myTeam" ? "My Team (Admins + Specialists)" : activeView === "agencyAccess" ? "Agency Access" : "All Users"}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider border-l-4 border-primary-400 first:border-l-0">Photo</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider border-l-4 border-primary-300">Full Name</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-emerald-800 uppercase tracking-wider border-l-4 border-emerald-300">Email</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-amber-800 uppercase tracking-wider border-l-4 border-amber-300">Role</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Status</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Date Added</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isTableLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500 bg-gray-50/50">
                    Loading team members...
                  </td>
                </tr>
              ) : visibleMembers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500 bg-amber-50/50">
                    No team members found
                  </td>
                </tr>
              ) : (
                visibleMembers.map((member, index) => (
                  <tr key={member.id} className={`transition-colors ${index % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-primary-50/50`}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium text-primary-700">
                          {getInitials(member.name)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {member.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {member.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full ${getRoleBadge(
                          member.role
                        )}`}
                      >
                        {member.role === "SUPER_ADMIN" ? "Super Admin" : member.role === "ADMIN" ? "Admin" : member.role === "SPECIALIST" ? "Specialist" : member.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(
                          member
                        )}`}
                      >
                        {getStatusText(member)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                      {member.createdAt ? new Date(member.createdAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {(user?.role === "ADMIN" || user?.role === "SUPER_ADMIN") && (
                          <>
                            {member.invited && !member.verified && (
                              <button
                                onClick={() => handleResendInvite(member)}
                                className="p-2 rounded-lg text-gray-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                                title="Resend invitation"
                              >
                                <Mail className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleEditTeamMember(member)}
                              className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                              title="Edit member"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            {member.role !== "SUPER_ADMIN" && (
                              <button
                                onClick={() => handleDeleteTeamMember(member.id)}
                                className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                                title="Delete member"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </>
                        )}
                        {user?.role === "AGENCY" && (member.role === "AGENCY" || member.agencies?.length) && (
                          <>
                            <button
                              onClick={() => handleEditTeamMember(member)}
                              className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                              title="Edit member"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteTeamMember(member.id)}
                              className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Remove from agency"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite New Specialist Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl ring-1 ring-gray-200/80 max-w-md w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="shrink-0 px-6 py-5 flex items-center justify-between bg-gradient-to-r from-primary-600 via-primary-500 to-blue-600 text-white rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20">
                  <UserPlus className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-bold">Invite New Specialist</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleInviteTeamMember} className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50 space-y-5">
                <div className="rounded-xl border-l-4 border-blue-500 bg-blue-50/50 p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    Contact
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Full Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={inviteForm.name}
                        onChange={(e) =>
                          setInviteForm({ ...inviteForm, name: e.target.value })
                        }
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
                        required
                        disabled={submittingInvite}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Email <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        value={inviteForm.email}
                        onChange={(e) =>
                          setInviteForm({ ...inviteForm, email: e.target.value })
                        }
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
                        required
                        disabled={submittingInvite}
                      />
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/50 p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-emerald-900 mb-3 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Role & Specialty
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Role <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={inviteForm.role}
                        onChange={(e) =>
                          setInviteForm({
                            ...inviteForm,
                            role: e.target.value as "SPECIALIST" | "ADMIN",
                          })
                        }
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        disabled={submittingInvite}
                        required
                      >
                        <option value="SPECIALIST">Specialist</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Specialty <span className="text-gray-400 font-normal">(optional)</span>
                      </label>
                      <div className="space-y-2">
                        {SPECIALTY_OPTIONS.map((opt) => (
                          <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={inviteForm.specialties.includes(opt.value)}
                              onChange={() => toggleSpecialty(opt.value)}
                              disabled={submittingInvite}
                              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                            <span className="text-gray-700">{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50/50 p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-amber-900 mb-3 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    Options
                  </h3>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inviteForm.sendInvitationEmail}
                      onChange={(e) =>
                        setInviteForm({
                          ...inviteForm,
                          sendInvitationEmail: e.target.checked,
                        })
                      }
                      disabled={submittingInvite}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700">Send invitation email</span>
                  </label>
                </div>
              </div>
              <div className="shrink-0 flex gap-3 p-6 border-t border-gray-200 bg-gray-100/80 rounded-b-2xl">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  disabled={submittingInvite}
                  className="flex-1 py-3 px-6 rounded-xl border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingInvite}
                  className="flex-1 py-3 px-6 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-md hover:shadow-lg disabled:opacity-50 transition-all"
                >
                  {submittingInvite ? "Sending…" : "Send Invitation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Team Member Modal */}
      {showEditModal && selectedMember && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-900">
                Edit Team Member
              </h2>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setSelectedMember(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateTeamMember} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, name: e.target.value })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Role
                </label>
                <select
                  value={editForm.role}
                  onChange={(e) =>
                    setEditForm({ ...editForm, role: e.target.value as "SPECIALIST" | "AGENCY" | "ADMIN" })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="SPECIALIST">Specialist</option>
                  <option value="AGENCY">Agency Admin</option>
                  {(user?.role === "ADMIN" || user?.role === "SUPER_ADMIN") && (
                    <option value="ADMIN">Admin</option>
                  )}
                </select>
              </div>
              {user?.role === "SUPER_ADMIN" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Set new password (optional)
                    </label>
                    <input
                      type="text"
                      value={editForm.newPassword}
                      onChange={(e) =>
                        setEditForm({ ...editForm, newPassword: e.target.value })
                      }
                      placeholder="Leave blank to keep current"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Confirm password
                    </label>
                    <input
                      type="text"
                      value={editForm.confirmPassword}
                      onChange={(e) =>
                        setEditForm({ ...editForm, confirmPassword: e.target.value })
                      }
                      placeholder="Re-enter to confirm"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                </>
              )}
              <div className="flex space-x-4 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setSelectedMember(null);
                  }}
                  className="flex-1 bg-gray-200 text-gray-800 py-3 px-6 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-primary-600 text-white py-3 px-6 rounded-lg hover:bg-primary-700 transition-colors"
                >
                  Update Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, memberId: null })}
        onConfirm={confirmDeleteTeamMember}
        title="Remove Team Member"
        message="Are you sure you want to remove this team member? This action cannot be undone and they will lose access to the system."
        confirmText="Remove"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
};

export default TeamPage;
