import React, { useEffect, useMemo, useState } from "react";
import { Plus, Users, Mail, UserCheck, Trash2, X } from "lucide-react";
import ConfirmDialog from "../components/ConfirmDialog";
import api from "../lib/api";
import { useSelector } from "react-redux";
import { RootState } from "../store";
import toast from "react-hot-toast";

interface WorkerMember {
  id: string;
  name: string;
  email: string;
  role: string;
  verified: boolean;
  invited: boolean;
  lastActive: string | null;
  createdAt: string;
  taskCount?: number;
  agencies?: Array<{ id: string; name: string; role: string }>;
}

const WorkersPage: React.FC = () => {
  const { user } = useSelector((state: RootState) => state.auth);
  const [workers, setWorkers] = useState<WorkerMember[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    name: "",
  });
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [submittingInvite, setSubmittingInvite] = useState(false);

  useEffect(() => {
    if (user && ["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      fetchWorkers();
    }
  }, [user]);

  const fetchWorkers = async () => {
    try {
      setLoading(true);
      const response = await api.get("/team");
      const workerOnly = (response.data as WorkerMember[]).filter(
        (member) => member.role === "WORKER"
      );
      setWorkers(workerOnly);
      setError(null);
    } catch (err: any) {
      console.error("Failed to fetch workers", err);
      setError(err.response?.data?.message || "Failed to fetch workers");
    } finally {
      setLoading(false);
    }
  };

  const activeCount = useMemo(
    () => workers.filter((member) => member.verified).length,
    [workers]
  );

  const pendingCount = useMemo(
    () => workers.filter((member) => member.invited && !member.verified).length,
    [workers]
  );

  const validateInviteForm = () => {
    if (!inviteForm.name.trim()) {
      setInviteError("Name is required");
      return false;
    }

    const email = inviteForm.email.trim().toLowerCase();
    if (!email) {
      setInviteError("Email is required");
      return false;
    }

    if (!email.endsWith("@gmail.com")) {
      setInviteError("Please enter a Gmail address ending with @gmail.com");
      return false;
    }

    setInviteError(null);
    return true;
  };

  const handleInviteSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validateInviteForm()) return;

    try {
      setSubmittingInvite(true);
      await api.post("/team/invite", {
        email: inviteForm.email.trim().toLowerCase(),
        name: inviteForm.name.trim(),
        role: "WORKER",
      });
      setInviteForm({ email: "", name: "" });
      setShowInviteModal(false);
      toast.success("Worker invited successfully!");
      fetchWorkers();
    } catch (err: any) {
      console.error("Failed to invite worker", err);
      setInviteError(err.response?.data?.message || "Failed to invite worker");
      // Toast is already shown by API interceptor
    } finally {
      setSubmittingInvite(false);
    }
  };

  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; workerId: string | null }>({
    isOpen: false,
    workerId: null,
  });

  const handleRemoveWorker = async (id: string) => {
    setDeleteConfirm({ isOpen: true, workerId: id });
  };

  const confirmRemoveWorker = async () => {
    if (!deleteConfirm.workerId) return;
    try {
      await api.delete(`/team/${deleteConfirm.workerId}`);
      toast.success("Worker removed successfully!");
      fetchWorkers();
      setDeleteConfirm({ isOpen: false, workerId: null });
    } catch (err: any) {
      console.error("Failed to remove worker", err);
      setDeleteConfirm({ isOpen: false, workerId: null });
    }
  };

  if (!user || !["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return (
      <div className="p-8">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
          You do not have permission to manage workers.
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Workers</h1>
          <p className="text-gray-600 mt-2">
            Invite, review, and manage workers across all agencies.
          </p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2"
        >
          <Plus className="h-5 w-5" />
          <span>Invite Worker</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Workers</p>
              <p className="text-2xl font-bold text-primary-600">
                {loading ? "..." : workers.length}
              </p>
            </div>
            <Users className="h-8 w-8 text-primary-600" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active</p>
              <p className="text-2xl font-bold text-green-600">
                {loading ? "..." : activeCount}
              </p>
            </div>
            <UserCheck className="h-8 w-8 text-green-600" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Pending Invitations</p>
              <p className="text-2xl font-bold text-accent-600">
                {loading ? "..." : pendingCount}
              </p>
            </div>
            <Mail className="h-8 w-8 text-accent-600" />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-8">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Worker Directory</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Worker
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tasks
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Active
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    Loading workers...
                  </td>
                </tr>
              ) : workers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    No workers yet. Invite your first worker using the button above.
                  </td>
                </tr>
              ) : (
                workers.map((member) => (
                  <tr key={member.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-semibold">
                          {member.name ? member.name.charAt(0).toUpperCase() : member.email.charAt(0).toUpperCase()}
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {member.name || "Unnamed"}
                          </div>
                          <div className="text-sm text-gray-500">{member.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-3 py-1 text-xs font-medium rounded-full ${
                          member.verified
                            ? "bg-green-100 text-green-800"
                            : member.invited
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {member.verified ? "Active" : member.invited ? "Invited" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {member.taskCount ?? 0}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {member.lastActive
                        ? new Date(member.lastActive).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleRemoveWorker(member.id)}
                        className="text-red-600 hover:text-red-900 inline-flex items-center space-x-1"
                        title="Remove worker"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>Remove</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 px-4">
          <div className="bg-white w-full max-w-md rounded-xl shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Invite Worker</h3>
                <p className="text-sm text-gray-500">Invite a worker using their Gmail address.</p>
              </div>
              <button
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteError(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleInviteSubmit} className="px-6 py-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                <input
                  type="text"
                  value={inviteForm.name}
                  onChange={(e) => setInviteForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Jane Doe"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Gmail Address</label>
                <input
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((prev) => ({ ...prev, email: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="name@gmail.com"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">Only Gmail addresses are accepted.</p>
              </div>

              {inviteError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">
                  {inviteError}
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowInviteModal(false);
                    setInviteError(null);
                  }}
                  className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingInvite}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submittingInvite ? "Sending..." : "Send Invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, workerId: null })}
        onConfirm={confirmRemoveWorker}
        title="Remove Worker"
        message="Are you sure you want to remove this worker? This action cannot be undone and they will lose access to the system."
        confirmText="Remove"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
};

export default WorkersPage;

