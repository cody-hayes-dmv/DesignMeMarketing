import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import {
  Loader2,
  Mail,
  Shield,
  UserCheck,
  Users,
} from "lucide-react";
import toast from "react-hot-toast";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  verified: boolean;
  invited: boolean;
  lastActive: string | null;
  createdAt: string;
}

const WorkerTeamPage = () => {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTeam = async () => {
      try {
        setLoading(true);
        const res = await api.get("/team");
        setTeamMembers(Array.isArray(res.data) ? res.data : []);
        setError(null);
      } catch (err: any) {
        console.error("Failed to fetch team", err);
        const errorMsg = err?.response?.data?.message || "Unable to load team members";
        setError(errorMsg);
        // Toast is already shown by API interceptor
      } finally {
        setLoading(false);
      }
    };

    fetchTeam();
  }, []);

  const stats = useMemo(() => {
    const total = teamMembers.length;
    const active = teamMembers.filter((member) => member.verified).length;
    const pending = teamMembers.filter((member) => member.invited && !member.verified).length;
    const leaders = teamMembers.filter((member) =>
      ["ADMIN", "SUPER_ADMIN", "AGENCY"].includes(member.role)
    ).length;

    return { total, active, pending, leaders };
  }, [teamMembers]);

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Team</h1>
        <p className="text-gray-600 mt-2">
          Meet the people collaborating with you across clients and projects.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Team members</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {loading ? "…" : stats.total}
              </p>
            </div>
            <div className="p-3 rounded-full bg-primary-50">
              <Users className="h-6 w-6 text-primary-600" />
            </div>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Active</p>
              <p className="text-3xl font-bold text-emerald-600 mt-2">
                {loading ? "…" : stats.active}
              </p>
            </div>
            <div className="p-3 rounded-full bg-emerald-50">
              <UserCheck className="h-6 w-6 text-emerald-600" />
            </div>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Pending invites</p>
              <p className="text-3xl font-bold text-amber-500 mt-2">
                {loading ? "…" : stats.pending}
              </p>
            </div>
            <div className="p-3 rounded-full bg-amber-50">
              <Mail className="h-6 w-6 text-amber-500" />
            </div>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Leadership</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {loading ? "…" : stats.leaders}
              </p>
            </div>
            <div className="p-3 rounded-full bg-indigo-50">
              <Shield className="h-6 w-6 text-indigo-500" />
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Team directory</h2>
            <p className="text-sm text-gray-500">
              Contact information and status for everyone on your team.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Member
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Role
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Email
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Last active
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    <span className="inline-flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                      Loading team members…
                    </span>
                  </td>
                </tr>
              ) : teamMembers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500 text-sm">
                    No team members to show yet.
                  </td>
                </tr>
              ) : (
                teamMembers.map((member) => (
                  <tr key={member.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center space-x-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-primary-600 text-sm font-semibold">
                          {member.name
                            .split(" ")
                            .map((part) => part[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{member.name}</p>
                          <p className="text-xs text-gray-500">
                            Joined{" "}
                            {member.createdAt
                              ? new Date(member.createdAt).toLocaleDateString()
                              : "—"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                        {member.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {member.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                          member.verified
                            ? "bg-emerald-100 text-emerald-700"
                            : member.invited
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {member.verified ? "Active" : member.invited ? "Invited" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {member.lastActive
                        ? new Date(member.lastActive).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default WorkerTeamPage;

