import React, { useState, useEffect } from "react";
import {
  Users,
  Plus,
  Building2,
  Globe,
  Edit,
  Trash2,
  X,
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
      await api.post("/team/invite", {
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
      toast.success("Invitation sent successfully!");
      fetchTeamMembers();
    } catch (error: any) {
      console.error("Failed to invite specialist:", error);
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
    });
    setShowEditModal(true);
  };

  const handleUpdateTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMember) return;

    try {
      await api.put(`/team/${selectedMember.id}`, editForm);
      toast.success("Team member updated successfully!");
      setShowEditModal(false);
      setSelectedMember(null);
      // Refresh team members
      fetchTeamMembers();
    } catch (error: any) {
      console.error("Failed to update team member:", error);
      // Toast is already shown by API interceptor
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
    const status = member.verified ? "Active" : member.invited ? "Invited" : "Inactive";
    const styles = {
      Active: "bg-green-100 text-green-800",
      Invited: "bg-yellow-100 text-yellow-800",
      Inactive: "bg-gray-100 text-gray-800",
    };
    return styles[status as keyof typeof styles] || "bg-gray-100 text-gray-800";
  };

  const getStatusText = (member: TeamMember) => {
    return member.verified ? "Active" : member.invited ? "Invited" : "Inactive";
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
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Team</h1>
          <p className="text-gray-600 mt-2">
            Manage your team members and their access
          </p>
        </div>
        {(user?.role === "ADMIN" || user?.role === "SUPER_ADMIN" || user?.role === "AGENCY") && (
          <button
            onClick={() => setShowInviteModal(true)}
            className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2"
          >
            <Plus className="h-5 w-5" />
            <span>Invite Specialist</span>
          </button>
        )}
      </div>

      {/* Team Views */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <button
          type="button"
          onClick={() => setActiveView("myTeam")}
          className={`bg-white p-6 rounded-xl border shadow-sm text-left transition-all ${
            activeView === "myTeam" ? "border-primary-500 ring-2 ring-primary-100" : "border-gray-200 hover:shadow-md"
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
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Team Members</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Member
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Clients / Tasks
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Active
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {isTableLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                    Loading team members...
                  </td>
                </tr>
              ) : visibleMembers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                    No team members found
                  </td>
                </tr>
              ) : (
                visibleMembers.map((member) => (
                  <tr key={member.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-primary-700">
                            {getInitials(member.name)}
                          </span>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {member.name}
                          </div>
                          <div className="text-sm text-gray-500">
                            {member.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full ${getRoleBadge(
                          member.role
                        )}`}
                      >
                        {member.role}
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
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-600">
                        {member.clientCount !== undefined
                          ? `${member.clientCount} client${member.clientCount !== 1 ? "s" : ""}`
                          : "-"}
                      </div>
                      {member.taskCount !== undefined && member.taskCount > 0 && (
                        <div className="text-xs text-gray-500">
                          {member.taskCount} task{member.taskCount !== 1 ? "s" : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-600">
                        {member.lastActive
                          ? new Date(member.lastActive).toLocaleDateString()
                          : "Never"}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2">
                        {(user?.role === "ADMIN" || user?.role === "SUPER_ADMIN" || user?.role === "AGENCY") && (
                          <>
                            <button
                              onClick={() => handleEditTeamMember(member)}
                              className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                              title="Edit member"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            {member.role !== "SUPER_ADMIN" && (
                              <button
                                onClick={() => handleDeleteTeamMember(member.id)}
                                className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                                title="Delete member"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-6">
              Invite New Specialist
            </h2>
            <form onSubmit={handleInviteTeamMember} className="space-y-4">
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
              <div>
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
              <div className="flex space-x-4 pt-4">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  disabled={submittingInvite}
                  className="flex-1 bg-gray-200 text-gray-800 py-3 px-6 rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingInvite}
                  className="flex-1 bg-primary-600 text-white py-3 px-6 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
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
