import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Loader2, PersonStanding, Info, Plus, Users, ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { RootState } from "@/store";
import ClientAccountFormModal, { EMPTY_CLIENT_FORM } from "@/components/ClientAccountFormModal";
import AddBacklinkModal from "@/components/AddBacklinkModal";
import { clientToFormState } from "@/lib/clientAccountForm";
import type { Client } from "@/store/slices/clientSlice";

interface TaskWithClient {
  id: string;
  clientId?: string | null;
  client?: {
    id: string;
    name: string;
    domain: string;
  } | null;
}

interface ClientRow {
  id: string;
  name: string;
  domain: string;
  taskCount: number;
}

const SpecialistClientsPage = () => {
  const user = useSelector((s: RootState) => s.auth.user);
  const canAddBacklinks = (user?.specialties ?? []).includes("LINK_BUILDING");
  const [tasks, setTasks] = useState<TaskWithClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientsById, setClientsById] = useState<Record<string, Client>>({});
  const [companyInfoClientId, setCompanyInfoClientId] = useState<string | null>(null);
  const [companyInfoClient, setCompanyInfoClient] = useState<Client | null>(null);
  const [loadingCompanyInfo, setLoadingCompanyInfo] = useState(false);
  const [addBacklinkClient, setAddBacklinkClient] = useState<{ id: string; domain: string } | null>(null);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await api.get<TaskWithClient[]>("/tasks");
        setTasks(Array.isArray(res.data) ? res.data : []);
      } catch {
        setTasks([]);
      } finally {
        setLoading(false);
      }
    };
    fetchTasks();
  }, []);

  useEffect(() => {
    const fetchClients = async () => {
      try {
        const res = await api.get<Client[]>("/clients");
        const list = Array.isArray(res.data) ? res.data : [];
        const map: Record<string, Client> = {};
        for (const c of list) map[c.id] = c;
        setClientsById(map);
      } catch {
        setClientsById({});
      }
    };
    fetchClients();
  }, []);

  const companyInfoForm = useMemo(() => {
    if (!companyInfoClient) return EMPTY_CLIENT_FORM;
    return clientToFormState(companyInfoClient);
  }, [companyInfoClient]);

  const clients: ClientRow[] = useMemo(() => {
    const byId = new Map<string, ClientRow>();
    for (const task of tasks) {
      const c = task.client;
      if (!c?.id) continue;
      const existing = byId.get(c.id);
      if (existing) {
        existing.taskCount += 1;
      } else {
        byId.set(c.id, {
          id: c.id,
          name: c.name,
          domain: c.domain,
          taskCount: 1,
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="rounded-xl border-l-4 border-primary-500 bg-primary-50/60 px-8 py-6 flex items-center gap-3 shadow-sm">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          <span className="text-sm font-medium text-primary-800">Loading your clients…</span>
        </div>
      </div>
    );
  }

  const totalTasks = clients.reduce((sum, c) => sum + c.taskCount, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-violet-50/30 p-8">
      {/* Header Banner */}
      <div className="relative rounded-2xl bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-500 p-8 shadow-lg overflow-hidden mb-8">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEuNSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4xIi8+PC9zdmc+')] opacity-50" />
        <div className="relative">
          <h1 className="text-3xl font-bold text-white">My Clients</h1>
          <p className="text-violet-100 mt-2">
            Clients you have tasks for (read-only). You receive tasks; you cannot create or edit clients.
          </p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-violet-100 shadow-sm hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-100/50 transition-all duration-200 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-violet-400/20 to-violet-600/20 rounded-full -mr-8 -mt-8 group-hover:scale-150 transition-transform duration-500" />
          <div className="flex items-center justify-between relative">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Total Clients</p>
              <p className="text-3xl font-extrabold text-gray-900">{clients.length}</p>
            </div>
            <div className="bg-gradient-to-br from-violet-500 to-violet-700 p-3 rounded-xl shadow-lg shadow-violet-200">
              <Users className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-purple-100 shadow-sm hover:-translate-y-0.5 hover:shadow-lg hover:shadow-purple-100/50 transition-all duration-200 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-purple-400/20 to-purple-600/20 rounded-full -mr-8 -mt-8 group-hover:scale-150 transition-transform duration-500" />
          <div className="flex items-center justify-between relative">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Active Tasks</p>
              <p className="text-3xl font-extrabold text-gray-900">{totalTasks}</p>
            </div>
            <div className="bg-gradient-to-br from-purple-500 to-purple-700 p-3 rounded-xl shadow-lg shadow-purple-200">
              <ClipboardList className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>
      </div>
      {clients.length === 0 ? (
        <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50/60 p-12 text-center shadow-sm">
          <PersonStanding className="h-12 w-12 mx-auto mb-4 text-amber-600" />
          <p className="font-semibold text-amber-900">No clients yet</p>
          <p className="text-sm mt-1 text-amber-800/90">When tasks are assigned to you, the related clients will appear here.</p>
          <Link
            to="/specialist/tasks"
            className="inline-block mt-4 px-4 py-2 rounded-xl bg-amber-600 text-white font-medium text-sm hover:bg-amber-700 transition-colors"
          >
            View your tasks →
          </Link>
        </div>
      ) : (
        <div className="rounded-xl bg-white shadow-sm ring-1 ring-gray-200/80 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-500 text-white">
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Client</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Domain</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Your tasks</th>
                {canAddBacklinks && (
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Backlinks</th>
                )}
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Company Info</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {clients.map((client, index) => (
                <tr
                  key={client.id}
                  className={`transition-colors ${index % 2 === 0 ? "hover:bg-violet-50/50" : "bg-gray-50/60 hover:bg-violet-50/50"}`}
                >
                  <td className="px-6 py-4 text-sm font-semibold text-gray-900">{client.name}</td>
                  <td className="px-6 py-4 text-sm text-primary-800/90">{client.domain}</td>
                  <td className="px-6 py-4 text-sm">
                    <Link
                      to={`/specialist/tasks?clientId=${client.id}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 font-medium hover:bg-emerald-200 transition-colors"
                    >
                      {client.taskCount} task{client.taskCount !== 1 ? "s" : ""} →
                    </Link>
                  </td>
                  {canAddBacklinks && (
                    <td className="px-6 py-4 text-sm">
                      <button
                        type="button"
                        onClick={() => setAddBacklinkClient({ id: client.id, domain: client.domain })}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 text-violet-800 font-medium hover:bg-violet-100 transition-colors"
                      >
                        <Plus className="h-4 w-4" />
                        Add
                      </button>
                    </td>
                  )}
                  <td className="px-6 py-4 text-sm">
                    <button
                      type="button"
                      onClick={async () => {
                        setCompanyInfoClientId(client.id);
                        setLoadingCompanyInfo(true);
                        setCompanyInfoClient(null);
                        try {
                          const res = await api.get<Client>(`/clients/${client.id}`);
                          setCompanyInfoClient(res.data);
                        } catch {
                          const fallback = clientsById[client.id];
                          setCompanyInfoClient(fallback || null);
                        } finally {
                          setLoadingCompanyInfo(false);
                        }
                      }}
                      disabled={loadingCompanyInfo}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-800 font-medium hover:bg-indigo-100 transition-colors disabled:opacity-60"
                    >
                      {loadingCompanyInfo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Info className="h-4 w-4" />}
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {companyInfoClientId && (
        <ClientAccountFormModal
          open={true}
          title="Company Information"
          subtitle={
            loadingCompanyInfo
              ? "Loading…"
              : companyInfoClient
                ? `${companyInfoClient.name} – Account information (read-only)`
                : "Account information (read-only)"
          }
          form={companyInfoForm}
          setForm={() => {}}
          canEdit={false}
          showStatus={false}
          onClose={() => {
            setCompanyInfoClientId(null);
            setCompanyInfoClient(null);
          }}
        />
      )}

      {addBacklinkClient && (
        <AddBacklinkModal
          open={!!addBacklinkClient}
          onClose={() => setAddBacklinkClient(null)}
          clientId={addBacklinkClient.id}
          defaultTargetUrl={
            addBacklinkClient.domain?.trim()
              ? /^https?:\/\//i.test(addBacklinkClient.domain)
                ? addBacklinkClient.domain
                : `https://${addBacklinkClient.domain}`
              : ""
          }
        />
      )}
    </div>
  );
};

export default SpecialistClientsPage;
