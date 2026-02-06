import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Loader2, PersonStanding } from "lucide-react";
import { Link } from "react-router-dom";

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
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="p-8">
      <p className="text-gray-600 mb-6">
        Clients you have tasks for (read-only). You receive tasks; you cannot create or edit clients.
      </p>
      {clients.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
          <PersonStanding className="h-12 w-12 mx-auto mb-4 text-gray-300" />
          <p className="font-medium">No clients yet</p>
          <p className="text-sm mt-1">When tasks are assigned to you, the related clients will appear here.</p>
          <Link
            to="/specialist/tasks"
            className="inline-block mt-4 text-primary-600 hover:text-primary-700 font-medium text-sm"
          >
            View your tasks →
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Domain</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Your tasks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {clients.map((client) => (
                <tr key={client.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{client.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{client.domain}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    <Link
                      to={`/specialist/tasks?clientId=${client.id}`}
                      className="text-primary-600 hover:text-primary-700"
                    >
                      {client.taskCount} task{client.taskCount !== 1 ? "s" : ""} →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default SpecialistClientsPage;
