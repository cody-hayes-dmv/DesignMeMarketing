import { useEffect, useMemo, useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import {
  fetchTasks,
  patchTaskStatus,
  Task,
  TaskStatus,
} from "@/store/slices/taskSlice";
import api from "@/lib/api";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CheckCheck,
  ClipboardCheck,
  Clock3,
  Loader2,
  Mail,
  TrendingUp,
  Users,
} from "lucide-react";
import { differenceInCalendarDays, format, isBefore, parseISO } from "date-fns";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  verified?: boolean;
  invited?: boolean;
  lastActive?: string | null;
}

const parseDate = (value?: string | null) => {
  if (!value) return null;
  try {
    return parseISO(value);
  } catch {
    return null;
  }
};

const statusOrder: TaskStatus[] = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"];

const getNextStatus = (status: TaskStatus): TaskStatus | null => {
  const currentIndex = statusOrder.indexOf(status);
  if (currentIndex === -1 || currentIndex === statusOrder.length - 1) {
    return null;
  }
  return statusOrder[currentIndex + 1];
};

const getStatusBadgeClasses = (status: TaskStatus) => {
  switch (status) {
    case "TODO":
      return "bg-gray-100 text-gray-700";
    case "IN_PROGRESS":
      return "bg-blue-100 text-blue-700";
    case "REVIEW":
      return "bg-amber-100 text-amber-700";
    case "DONE":
      return "bg-emerald-100 text-emerald-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
};

const WorkerDashboardPage = () => {
  const dispatch = useDispatch();
  const { tasks, loading } = useSelector((state: RootState) => state.task);
  const { user } = useSelector((state: RootState) => state.auth);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [updatingTaskIds, setUpdatingTaskIds] = useState<string[]>([]);

  useEffect(() => {
    dispatch(fetchTasks() as any);
  }, [dispatch]);

  useEffect(() => {
    const fetchTeamMembers = async () => {
      try {
        setTeamLoading(true);
        const res = await api.get("/team");
        setTeamMembers(res.data || []);
        setTeamError(null);
      } catch (error: any) {
        console.error("Failed to load team members", error);
        setTeamError(error?.response?.data?.message || "Unable to load team members");
      } finally {
        setTeamLoading(false);
      }
    };

    fetchTeamMembers();
  }, []);

  const myTasks: Task[] = useMemo(() => {
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    if (!user?.id) return safeTasks;
    return safeTasks.filter(
      (task) => task.assignee?.id === user.id || task.assignee?.email === user.email
    );
  }, [tasks, user?.id, user?.email]);

  const activeTasks = useMemo(
    () => myTasks.filter((task) => task.status !== "DONE"),
    [myTasks]
  );

  const overdueTasks = useMemo(
    () =>
      activeTasks.filter((task) => {
        const due = parseDate(task.dueDate ?? undefined);
        if (!due) return false;
        const now = new Date();
        return isBefore(due, now);
      }),
    [activeTasks]
  );

  const dueSoonTasks = useMemo(
    () =>
      activeTasks
        .filter((task) => {
          const due = parseDate(task.dueDate ?? undefined);
          if (!due) return false;
          const daysDiff = differenceInCalendarDays(due, new Date());
          return daysDiff >= 0 && daysDiff <= 5;
        })
        .sort((a, b) => {
          const dueA = parseDate(a.dueDate ?? undefined)?.getTime() ?? Infinity;
          const dueB = parseDate(b.dueDate ?? undefined)?.getTime() ?? Infinity;
          return dueA - dueB;
        }),
    [activeTasks]
  );

  const completedThisWeek = useMemo(() => {
    const now = new Date();
    return myTasks.filter((task) => {
      if (task.status !== "DONE") return false;
      const completionDate =
        parseDate(task.dueDate ?? undefined) ?? parseDate(task.createdAt ?? undefined);
      if (!completionDate) return false;
      return differenceInCalendarDays(now, completionDate) <= 7;
    });
  }, [myTasks]);

  const handleAdvanceStatus = useCallback(
    async (task: Task) => {
      const nextStatus = getNextStatus(task.status);
      if (!nextStatus) return;

      try {
        setUpdatingTaskIds((prev) => [...prev, task.id]);
        await dispatch(
          patchTaskStatus({ id: task.id, status: nextStatus }) as any
        ).unwrap();
        toast.success("Task status updated successfully!");
      } catch (error: any) {
        console.error("Failed to advance task status", error);
        // Toast is already shown by API interceptor
      } finally {
        setUpdatingTaskIds((prev) => prev.filter((id) => id !== task.id));
      }
    },
    [dispatch]
  );

  const stats = [
    {
      label: "Assigned Tasks",
      value: myTasks.length,
      icon: Users,
      color: "text-primary-600",
      bg: "bg-primary-50",
    },
    {
      label: "Active",
      value: activeTasks.length,
      icon: ClipboardCheck,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Due Soon",
      value: dueSoonTasks.length,
      icon: CalendarClock,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      label: "Completed (7d)",
      value: completedThisWeek.length,
      icon: CheckCheck,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
  ];

  const renderStatusBadge = (status: TaskStatus) => (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClasses(
        status
      )}`}
    >
      {status.replace("_", " ")}
    </span>
  );

  const renderDueDate = (task: Task) => {
    if (!task.dueDate) return <span className="text-gray-400">No due date</span>;
    const due = parseDate(task.dueDate);
    if (!due) return <span className="text-gray-400">Invalid date</span>;

    const daysDiff = differenceInCalendarDays(due, new Date());
    const formatted = format(due, "MMM d, yyyy");

    if (daysDiff < 0) {
      return (
        <span className="text-rose-600 font-medium">
          Overdue • {formatted}
        </span>
      );
    }

    if (daysDiff === 0) {
      return <span className="text-amber-600 font-medium">Due today • {formatted}</span>;
    }

    if (daysDiff <= 5) {
      return (
        <span className="text-amber-600">
          Due in {daysDiff} day{daysDiff === 1 ? "" : "s"} • {formatted}
        </span>
      );
    }

    return <span className="text-gray-500">{formatted}</span>;
  };

  const teamSnapshot = useMemo(() => teamMembers.slice(0, 4), [teamMembers]);

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Welcome back{user?.name ? `, ${user.name}` : ""}</h1>
          <p className="text-gray-600 mt-1">
            Here's what is happening with your tasks today.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/worker/tasks"
            className="inline-flex items-center space-x-2 rounded-lg border border-primary-200 px-4 py-2 text-sm font-medium text-primary-600 hover:bg-primary-50"
          >
            <span>Go to task board</span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col justify-between"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{stat.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{stat.value}</p>
              </div>
              <div className={`p-3 rounded-full ${stat.bg}`}>
                <stat.icon className={`h-6 w-6 ${stat.color}`} />
              </div>
            </div>
            {stat.label === "Completed (7d)" && completedThisWeek.length > 0 && (
              <p className="text-xs text-gray-500 mt-4 flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-emerald-500" />
                Great work! Keep the momentum going.
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-3 gap-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6 2xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">My Active Tasks</h2>
              <p className="text-sm text-gray-500">
                Tasks assigned to you that still need action.
              </p>
            </div>
            <Link
              to="/worker/tasks"
              className="text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              View all
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Task
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Client
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Due
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      <span className="inline-flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                        Loading tasks...
                      </span>
                    </td>
                  </tr>
                ) : activeTasks.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      All caught up! You have no active tasks right now.
                    </td>
                  </tr>
                ) : (
                  activeTasks.slice(0, 8).map((task) => {
                    const nextStatus = getNextStatus(task.status);
                    const isUpdating = updatingTaskIds.includes(task.id);
                    return (
                      <tr key={task.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4">
                          <p className="text-sm font-medium text-gray-900">{task.title}</p>
                          {task.description && (
                            <p className="mt-1 text-xs text-gray-500 line-clamp-2">{task.description}</p>
                          )}
                        </td>
                        <td className="px-4 py-4">{renderStatusBadge(task.status)}</td>
                        <td className="px-4 py-4">
                          <p className="text-sm text-gray-700">
                            {task.client?.name || "Unassigned"}
                          </p>
                          {task.client?.domain && (
                            <p className="text-xs text-gray-400">{task.client.domain}</p>
                          )}
                        </td>
                        <td className="px-4 py-4 text-sm">{renderDueDate(task)}</td>
                        <td className="px-4 py-4">
                          {nextStatus ? (
                            <button
                              onClick={() => handleAdvanceStatus(task)}
                              disabled={isUpdating}
                              className="inline-flex items-center gap-2 rounded-lg border border-primary-200 px-3 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isUpdating ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              )}
                              <span>Move to {nextStatus.replace("_", " ")}</span>
                            </button>
                          ) : (
                            <span className="text-xs text-emerald-500 font-medium">
                              Completed
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Due Soon</h2>
              <CalendarClock className="h-5 w-5 text-amber-500" />
            </div>
            {dueSoonTasks.length === 0 ? (
              <p className="text-sm text-gray-500">No due tasks in the next 5 days.</p>
            ) : (
              <div className="space-y-4">
                {dueSoonTasks.slice(0, 5).map((task) => (
                  <div key={task.id} className="border border-amber-100 rounded-lg p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{task.title}</p>
                        <p className="text-xs text-gray-500">
                          {task.client?.name || "Internal task"}
                        </p>
                      </div>
                      <Clock3 className="h-4 w-4 text-amber-500" />
                    </div>
                    <div className="mt-2 text-xs text-amber-600">{renderDueDate(task)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Overdue</h2>
              <AlertTriangle className="h-5 w-5 text-rose-500" />
            </div>
            {overdueTasks.length === 0 ? (
              <p className="text-sm text-gray-500">You have no overdue tasks. Great job staying on track!</p>
            ) : (
              <div className="space-y-4">
                {overdueTasks.slice(0, 5).map((task) => (
                  <div key={task.id} className="border border-rose-100 rounded-lg p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{task.title}</p>
                        <p className="text-xs text-gray-500">
                          {task.client?.name || "Internal task"}
                        </p>
                      </div>
                      <AlertTriangle className="h-4 w-4 text-rose-500" />
                    </div>
                    <div className="mt-2 text-xs text-rose-600">{renderDueDate(task)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Team Snapshot</h2>
              <Link
                to="/worker/team"
                className="text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                View team
              </Link>
            </div>
            {teamLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                Loading teammates...
              </div>
            ) : teamError ? (
              <p className="text-sm text-rose-500">{teamError}</p>
            ) : teamSnapshot.length === 0 ? (
              <p className="text-sm text-gray-500">No team members found.</p>
            ) : (
              <ul className="space-y-4">
                {teamSnapshot.map((member) => (
                  <li key={member.id} className="flex items-start space-x-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-600">
                      {member.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{member.name}</p>
                      <p className="text-xs text-gray-500">{member.email}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                          {member.role}
                        </span>
                        <span className="inline-flex items-center text-[11px] text-gray-400 gap-1">
                          <Mail className="h-3 w-3" />
                          {member.verified ? "Verified" : "Pending"}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkerDashboardPage;
