import { useEffect, useMemo, useState, useCallback, useRef } from "react";
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
  ChevronDown,
  ChevronRight,
  Clock3,
  Loader2,
  Mail,
  TrendingUp,
} from "lucide-react";
import {
  differenceInCalendarDays,
  format,
  isBefore,
  isSameDay,
  parseISO,
  isWithinInterval,
  startOfMonth,
  endOfMonth,
} from "date-fns";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import TaskModal from "@/components/TaskModal";

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

const statusOrder: TaskStatus[] = ["TODO", "IN_PROGRESS", "REVIEW", "NEEDS_APPROVAL", "DONE"];

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
    case "NEEDS_APPROVAL":
      return "bg-amber-100 text-amber-700";
    case "DONE":
      return "bg-emerald-100 text-emerald-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
};

const SpecialistDashboardPage = () => {
  const dispatch = useDispatch();
  const { tasks, loading } = useSelector((state: RootState) => state.task);
  const { user } = useSelector((state: RootState) => state.auth);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [updatingTaskIds, setUpdatingTaskIds] = useState<string[]>([]);
  const [collapsedClientIds, setCollapsedClientIds] = useState<Set<string>>(new Set());
  const didInitUpcomingCollapsed = useRef(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [completeModalTask, setCompleteModalTask] = useState<Task | null>(null);
  const [completionNotes, setCompletionNotes] = useState("");
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

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

  const now = useMemo(() => new Date(), []);
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const overdueTasks = useMemo(
    () =>
      activeTasks
        .filter((task) => {
          const due = parseDate(task.dueDate ?? undefined);
          if (!due) return false;
          return isBefore(due, now);
        })
        .sort((a, b) => {
          const dueA = parseDate(a.dueDate ?? undefined)?.getTime() ?? 0;
          const dueB = parseDate(b.dueDate ?? undefined)?.getTime() ?? 0;
          return dueA - dueB;
        }),
    [activeTasks, now]
  );

  const tasksDueToday = useMemo(
    () =>
      activeTasks.filter((task) => {
        const due = parseDate(task.dueDate ?? undefined);
        if (!due) return false;
        return isSameDay(due, now);
      }),
    [activeTasks, now]
  );

  const tasksDueThisWeek = useMemo(
    () =>
      activeTasks.filter((task) => {
        const due = parseDate(task.dueDate ?? undefined);
        if (!due) return false;
        const daysDiff = differenceInCalendarDays(due, now);
        return daysDiff >= 0 && daysDiff <= 7;
      }),
    [activeTasks, now]
  );

  const dueWithin7Days = useMemo(
    () =>
      [...activeTasks]
        .filter((task) => {
          const due = parseDate(task.dueDate ?? undefined);
          if (!due) return false;
          const daysDiff = differenceInCalendarDays(due, now);
          return daysDiff >= 0 && daysDiff <= 7;
        })
        .sort((a, b) => {
          const dueA = parseDate(a.dueDate ?? undefined)?.getTime() ?? Infinity;
          const dueB = parseDate(b.dueDate ?? undefined)?.getTime() ?? Infinity;
          return dueA - dueB;
        }),
    [activeTasks, now]
  );

  const completedThisMonth = useMemo(() => {
    return myTasks.filter((task) => {
      if (task.status !== "DONE") return false;
      const date = parseDate(task.updatedAt ?? undefined) ?? parseDate(task.dueDate ?? undefined) ?? parseDate(task.createdAt ?? undefined);
      if (!date) return false;
      return isWithinInterval(date, { start: monthStart, end: monthEnd });
    });
  }, [myTasks, monthStart, monthEnd]);

  type ClientGroup = { clientId: string; clientName: string; tasks: Task[] };
  const upcomingByClient = useMemo((): ClientGroup[] => {
    const map = new Map<string, { name: string; tasks: Task[] }>();
    for (const task of activeTasks) {
      const cid = task.client?.id ?? "_none";
      const name = task.client?.name ?? "Unassigned";
      if (!map.has(cid)) map.set(cid, { name, tasks: [] });
      map.get(cid)!.tasks.push(task);
    }
    for (const g of map.values()) {
      g.tasks.sort((a, b) => {
        const dueA = parseDate(a.dueDate ?? undefined)?.getTime() ?? Infinity;
        const dueB = parseDate(b.dueDate ?? undefined)?.getTime() ?? Infinity;
        return dueA - dueB;
      });
    }
    const groups: ClientGroup[] = Array.from(map.entries()).map(([clientId, { name, tasks }]) => ({
      clientId,
      clientName: name,
      tasks,
    }));
    groups.sort((a, b) => {
      const minA = Math.min(...a.tasks.map((t) => parseDate(t.dueDate ?? undefined)?.getTime() ?? Infinity));
      const minB = Math.min(...b.tasks.map((t) => parseDate(t.dueDate ?? undefined)?.getTime() ?? Infinity));
      return minA - minB;
    });
    return groups;
  }, [activeTasks]);

  // Default: all Upcoming Tasks client sections start collapsed (shorter list)
  useEffect(() => {
    if (upcomingByClient.length > 0 && !didInitUpcomingCollapsed.current) {
      setCollapsedClientIds(new Set(upcomingByClient.map((g) => g.clientId)));
      didInitUpcomingCollapsed.current = true;
    }
  }, [upcomingByClient]);

  const handleAdvanceStatus = useCallback(
    async (task: Task) => {
      const nextStatus = getNextStatus(task.status);
      if (!nextStatus) return;

      // When advancing to DONE, open completion modal instead of completing immediately
      if (nextStatus === "DONE") {
        setCompleteModalTask(task);
        setCompletionNotes("");
        return;
      }

      try {
        setUpdatingTaskIds((prev) => [...prev, task.id]);
        await dispatch(
          patchTaskStatus({ id: task.id, status: nextStatus }) as any
        ).unwrap();
        toast.success("Task status updated successfully!");
      } catch (error: any) {
        console.error("Failed to advance task status", error);
      } finally {
        setUpdatingTaskIds((prev) => prev.filter((id) => id !== task.id));
      }
    },
    [dispatch]
  );

  const handleCloseCompleteModal = useCallback(() => {
    setCompleteModalTask(null);
    setCompletionNotes("");
    setCompletingTaskId(null);
  }, []);

  const handleMarkCompleteSubmit = useCallback(
    async () => {
      const task = completeModalTask;
      if (!task) return;

      try {
        setCompletingTaskId(task.id);
        await dispatch(
          patchTaskStatus({ id: task.id, status: "DONE" }) as any
        ).unwrap();

        if (completionNotes.trim()) {
          await api.post(`/tasks/${task.id}/comments`, {
            body: completionNotes.trim(),
          });
        }

        dispatch(fetchTasks() as any);
        toast.success("Task completed! ✓");
        handleCloseCompleteModal();
      } catch (error: any) {
        console.error("Failed to complete task", error);
        setCompletingTaskId(null);
      }
    },
    [completeModalTask, completionNotes, dispatch, handleCloseCompleteModal]
  );

  const hasOverdue = overdueTasks.length > 0;
  const stats = [
    {
      label: "Overdue Tasks",
      value: overdueTasks.length,
      description: "Past due",
      icon: AlertTriangle,
      color: "text-rose-600",
      bg: "bg-rose-50",
      border: hasOverdue ? "border-rose-200" : "border-gray-200",
    },
    {
      label: "Tasks Due Today",
      value: tasksDueToday.length,
      description: "Due by end of day",
      icon: CalendarClock,
      color: "text-rose-600",
      bg: "bg-rose-50",
      border: hasOverdue ? "border-rose-200" : "border-gray-200",
    },
    {
      label: "Tasks Due This Week",
      value: tasksDueThisWeek.length,
      description: "Due within 7 days",
      icon: ClipboardCheck,
      color: "text-amber-600",
      bg: "bg-amber-50",
      border: "border-amber-200",
    },
    {
      label: "Completed This Month",
      value: completedThisMonth.length,
      description: "Tasks finished",
      icon: CheckCheck,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      border: "border-emerald-200",
    },
  ];

  const toggleClientCollapse = (clientId: string) => {
    setCollapsedClientIds((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  };

  const openTaskDetails = (task: Task) => {
    setSelectedTask(task);
    setTaskModalOpen(true);
  };

  const tasksLinkWithClient = (clientId: string) =>
    clientId === "_none" ? "/specialist/tasks" : `/specialist/tasks?clientId=${clientId}`;

  const renderStatusBadge = (status: TaskStatus) => (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClasses(
        status
      )}`}
    >
      {status.replace("_", " ")}
    </span>
  );

  const getPriorityBadgeClasses = (priority?: string | null) => {
    const p = (priority ?? "").toLowerCase();
    if (p === "high") return "bg-rose-100 text-rose-700";
    if (p === "medium") return "bg-amber-100 text-amber-700";
    if (p === "low") return "bg-gray-100 text-gray-700";
    return "bg-gray-100 text-gray-600";
  };

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
            to="/specialist/tasks"
            className="inline-flex items-center space-x-2 rounded-lg border border-primary-200 px-4 py-2 text-sm font-medium text-primary-600 hover:bg-primary-50"
          >
            <span>Go to task board</span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`bg-white rounded-xl border ${stat.border} p-6 flex flex-col justify-between`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{stat.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{stat.value}</p>
                <p className="text-xs text-gray-500 mt-1">{stat.description}</p>
              </div>
              <div className={`p-3 rounded-full ${stat.bg}`}>
                <stat.icon className={`h-6 w-6 ${stat.color}`} />
              </div>
            </div>
            {stat.label === "Completed This Month" && completedThisMonth.length > 0 && (
              <p className="text-xs text-gray-500 mt-4 flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-emerald-500" />
                Great work! Keep the momentum going.
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-4 gap-6">
        <div className="2xl:col-span-3 bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Your Upcoming Tasks</h2>
              <p className="text-sm text-gray-500">
                Grouped by client so you can focus on one client at a time.
              </p>
            </div>
            <Link
              to="/specialist/tasks"
              className="text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              View all
            </Link>
          </div>

          {loading ? (
            <div className="py-12 flex justify-center">
              <span className="inline-flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                Loading tasks...
              </span>
            </div>
          ) : upcomingByClient.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              All caught up! You have no active tasks right now.
            </div>
          ) : (
            <div className="space-y-4">
              {upcomingByClient.map(({ clientId, clientName, tasks: clientTasks }) => {
                const isCollapsed = collapsedClientIds.has(clientId);
                return (
                  <div key={clientId} className="border border-gray-200 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleClientCollapse(clientId)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left"
                    >
                      <div className="flex items-center gap-2">
                        {isCollapsed ? (
                          <ChevronRight className="h-5 w-5 text-gray-500" />
                        ) : (
                          <ChevronDown className="h-5 w-5 text-gray-500" />
                        )}
                        <span className="font-medium text-gray-900">{clientName}</span>
                        <span className="text-sm text-gray-500">
                          ({clientTasks.length} task{clientTasks.length !== 1 ? "s" : ""} assigned)
                        </span>
                      </div>
                      <Link
                        to={tasksLinkWithClient(clientId)}
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm font-medium text-primary-600 hover:text-primary-700"
                      >
                        View client tasks
                      </Link>
                    </button>
                    {!isCollapsed && (
                      <ul className="divide-y divide-gray-100">
                        {clientTasks.map((task) => {
                          const nextStatus = getNextStatus(task.status);
                          const isUpdating = updatingTaskIds.includes(task.id);
                          const dueFormatted = task.dueDate
                            ? format(parseDate(task.dueDate)!, "MMM d, yyyy")
                            : "No date";
                          const rawPriority = task.priority || "medium";
                          const priorityLabel = rawPriority.charAt(0).toUpperCase() + rawPriority.slice(1).toLowerCase();
                          return (
                            <li key={task.id} className="px-4 py-3 hover:bg-gray-50/50 flex flex-wrap items-center gap-x-4 gap-y-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-gray-900">{task.title}</p>
                                <p className="text-xs text-gray-500 mt-0.5">
                                  Due: {dueFormatted} · Priority:{" "}
                                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${getPriorityBadgeClasses(task.priority)}`}>
                                    {priorityLabel}
                                  </span>
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {nextStatus ? (
                                  <button
                                    onClick={() => handleAdvanceStatus(task)}
                                    disabled={isUpdating}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 px-2.5 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 disabled:opacity-60"
                                  >
                                    {isUpdating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                    Mark Complete
                                  </button>
                                ) : (
                                  <span className="text-xs text-emerald-600 font-medium">Completed</span>
                                )}
                                <button
                                  onClick={() => openTaskDetails(task)}
                                  className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                >
                                  View Details
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-500" />
              Overdue Tasks ({overdueTasks.length})
            </h2>
            {overdueTasks.length === 0 ? (
              <p className="text-sm text-gray-500">You have no overdue tasks. Great job staying on track!</p>
            ) : (
              <ul className="space-y-3">
                {overdueTasks.map((task) => {
                  const due = parseDate(task.dueDate ?? undefined);
                  const daysOverdue = due ? differenceInCalendarDays(now, due) : 0;
                  return (
                    <li key={task.id} className="border border-rose-100 rounded-lg p-3 bg-rose-50/50">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-rose-500 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900">{task.title}</p>
                          <p className="text-xs text-gray-600">{task.client?.name || "Internal"}</p>
                          <p className="text-xs text-rose-600 mt-1">
                            Due: {due ? format(due, "MMM d") : "—"} · {daysOverdue} day{daysOverdue !== 1 ? "s" : ""} overdue
                          </p>
                        </div>
                        <Link
                          to={tasksLinkWithClient(task.client?.id ?? "_none")}
                          className="flex-shrink-0 text-xs font-medium text-primary-600 hover:text-primary-700"
                        >
                          View Task
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-amber-500" />
              Due Within 7 Days ({dueWithin7Days.length})
            </h2>
            {dueWithin7Days.length === 0 ? (
              <p className="text-sm text-gray-500">No tasks due in the next 7 days.</p>
            ) : (
              <>
                <ul className="space-y-3">
                  {dueWithin7Days.slice(0, 8).map((task) => {
                    const due = parseDate(task.dueDate ?? undefined);
                    const daysLeft = due ? differenceInCalendarDays(due, now) : 0;
                    return (
                      <li key={task.id} className="border border-amber-100 rounded-lg p-3 bg-amber-50/50">
                        <div className="flex items-start gap-2">
                          <Clock3 className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900">{task.title}</p>
                            <p className="text-xs text-gray-600">{task.client?.name || "Internal"}</p>
                            <p className="text-xs text-amber-700 mt-1">
                              Due: {due ? format(due, "MMM d") : "—"} ({daysLeft} day{daysLeft !== 1 ? "s" : ""})
                            </p>
                          </div>
                          <Link
                            to={tasksLinkWithClient(task.client?.id ?? "_none")}
                            className="flex-shrink-0 text-xs font-medium text-primary-600 hover:text-primary-700"
                          >
                            View Task
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {dueWithin7Days.length > 8 && (
                  <Link
                    to="/specialist/tasks"
                    className="mt-3 block text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    View All
                  </Link>
                )}
              </>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Team Snapshot</h2>
              <Link to="/specialist/team" className="text-xs font-medium text-primary-600 hover:text-primary-700">
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
                      {member.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{member.name}</p>
                      <p className="text-xs text-gray-500 truncate">{member.email}</p>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
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

      {selectedTask && (
        <TaskModal
          open={taskModalOpen}
          setOpen={(v) => {
            setTaskModalOpen(v);
            if (!v) {
              setSelectedTask(null);
              dispatch(fetchTasks() as any);
            }
          }}
          title="Task Details"
          mode={1}
          task={selectedTask}
        />
      )}

      {/* Mark Task Complete modal */}
      {completeModalTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={handleCloseCompleteModal}>
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Mark Task Complete</h3>
            <div className="space-y-3 mb-4">
              <div>
                <span className="text-sm text-gray-500">Task:</span>
                <p className="font-medium text-gray-900">{completeModalTask.title}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Client:</span>
                <p className="font-medium text-gray-900">{completeModalTask.client?.name ?? "—"}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Add completion notes (optional)</label>
                <textarea
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  placeholder="e.g. Header tags updated on homepage and contact page."
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={handleCloseCompleteModal}
                className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleMarkCompleteSubmit()}
                disabled={completingTaskId === completeModalTask.id}
                className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium transition-colors inline-flex items-center gap-2"
              >
                {completingTaskId === completeModalTask.id ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Completing…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Mark Complete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpecialistDashboardPage;
