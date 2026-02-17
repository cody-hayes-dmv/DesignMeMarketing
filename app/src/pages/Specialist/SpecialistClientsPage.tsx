import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Loader2, PersonStanding, Info } from "lucide-react";
import { Link } from "react-router-dom";
import ClientAccountFormModal, { EMPTY_CLIENT_FORM } from "@/components/ClientAccountFormModal";
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
  const [tasks, setTasks] = useState<TaskWithClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientsById, setClientsById] = useState<Record<string, Client>>({});
  const [companyInfoClientId, setCompanyInfoClientId] = useState<string | null>(null);

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
    if (!companyInfoClientId) return EMPTY_CLIENT_FORM;
    const client = clientsById[companyInfoClientId];
    return client ? clientToFormState(client) : EMPTY_CLIENT_FORM;
  }, [companyInfoClientId, clientsById]);

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

  return (
    <div className="p-8">
      <div className="rounded-xl border-l-4 border-primary-500 bg-gradient-to-r from-primary-50/80 via-blue-50/60 to-indigo-50/50 px-5 py-4 mb-6 shadow-sm">
        <p className="text-primary-900 font-medium">
          Clients you have tasks for (read-only). You receive tasks; you cannot create or edit clients.
        </p>
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
        <div className="rounded-xl border-l-4 border-primary-500 bg-white shadow-sm ring-1 ring-gray-200/80 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-600 text-white">
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Client</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Domain</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Your tasks</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">Company Info</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {clients.map((client, index) => (
                <tr
                  key={client.id}
                  className={index % 2 === 0 ? "hover:bg-blue-50/60" : "bg-slate-50/50 hover:bg-blue-50/60"}
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
                  <td className="px-6 py-4 text-sm">
                    <button
                      type="button"
                      onClick={() => setCompanyInfoClientId(client.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-800 font-medium hover:bg-indigo-100 transition-colors"
                    >
                      <Info className="h-4 w-4" />
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ClientAccountFormModal
        open={companyInfoClientId !== null}
        title="Company Information"
        subtitle="Account information (read-only)"
        form={companyInfoForm}
        setForm={() => {}}
        canEdit={false}
        showStatus={false}
        onClose={() => setCompanyInfoClientId(null)}
      />
    </div>
  );
};

export default SpecialistClientsPage;
