import React, { useState, useEffect } from "react";
import {
  Users,
  Plus,
  Mail,
  MoreVertical,
  Shield,
  UserCheck,
  UserX,
  Edit,
  Trash2,
} from "lucide-react";
import api from "../lib/api";
import { useSelector } from "react-redux";
import { RootState } from "../store";
import toast from "react-hot-toast";

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
  const [inviteForm, setInviteForm] = useState({
    email: "",
    name: "",
    role: "WORKER" as "WORKER" | "AGENCY" | "ADMIN",
  });
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTeamMembers();
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

  const handleInviteTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/team/invite", inviteForm);
      setInviteForm({ email: "", name: "", role: "WORKER" });
      setShowInviteModal(false);
      toast.success("Team member invited successfully!");
      // Refresh team members
      fetchTeamMembers();
    } catch (error: any) {
      console.error("Failed to invite team member:", error);
      // Toast is already shown by API interceptor
    }
  };

  const handleDeleteTeamMember = async (id: string) => {
    if (!window.confirm("Are you sure you want to remove this team member? This action cannot be undone.")) {
      return;
    }
    try {
      await api.delete(`/team/${id}`);
      toast.success("Team member removed successfully!");
      // Refresh team members
      fetchTeamMembers();
    } catch (error: any) {
      console.error("Failed to delete team member:", error);
      // Toast is already shown by API interceptor
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
      WORKER: "bg-secondary-100 text-secondary-800",
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
            <span>Invite Member</span>
          </button>
        )}
      </div>

      {/* Team Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Members</p>
              <p className="text-2xl font-bold text-primary-600">
                {loading ? "..." : teamMembers.length}
              </p>
            </div>
            <Users className="h-8 w-8 text-primary-600" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active</p>
              <p className="text-2xl font-bold text-secondary-600">
                {loading ? "..." : teamMembers.filter((m) => m.verified).length}
              </p>
            </div>
            <UserCheck className="h-8 w-8 text-secondary-600" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Pending</p>
              <p className="text-2xl font-bold text-accent-600">
                {loading ? "..." : teamMembers.filter((m) => m.invited && !m.verified).length}
              </p>
            </div>
            <Mail className="h-8 w-8 text-accent-600" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Admins</p>
              <p className="text-2xl font-bold text-gray-900">
                {loading ? "..." : teamMembers.filter((m) => m.role === "AGENCY" || m.role === "ADMIN" || m.role === "SUPER_ADMIN").length}
              </p>
            </div>
            <Shield className="h-8 w-8 text-gray-600" />
          </div>
        </div>
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
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                    Loading team members...
                  </td>
                </tr>
              ) : teamMembers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                    No team members found
                  </td>
                </tr>
              ) : (
                teamMembers.map((member) => (
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
                            <button className="p-1 text-gray-400 hover:text-primary-600 transition-colors">
                              <Edit className="h-4 w-4" />
                            </button>
                            {member.role !== "SUPER_ADMIN" && (
                              <button
                                onClick={() => handleDeleteTeamMember(member.id)}
                                className="p-1 text-gray-400 hover:text-red-600 transition-colors"
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

      {/* Invite Team Member Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-6">
              Invite Team Member
            </h2>
            <form onSubmit={handleInviteTeamMember} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  value={inviteForm.name}
                  onChange={(e) =>
                    setInviteForm({ ...inviteForm, name: e.target.value })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) =>
                    setInviteForm({ ...inviteForm, email: e.target.value })
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
                  value={inviteForm.role}
                  onChange={(e) =>
                    setInviteForm({ ...inviteForm, role: e.target.value })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="WORKER">Worker</option>
                  <option value="AGENCY">Agency Admin</option>
                </select>
              </div>
              <div className="flex space-x-4 pt-4">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="flex-1 bg-gray-200 text-gray-800 py-3 px-6 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-primary-600 text-white py-3 px-6 rounded-lg hover:bg-primary-700 transition-colors"
                >
                  Send Invite
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeamPage;
