import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { RootState } from "@/store";

import {
    Plus,
    Edit,
    Trash2,
    Table,
    Kanban,
    Filter,
    Search,
    ListTodo,
    Repeat,
    Play,
    StopCircle,
    CheckCircle,
    CheckCheck,
    Globe,
    Key,
    Eye,
    EyeOff,
    Clock,
    AlertTriangle,
    Calendar,
    User,
    Image as ImageIcon,
    Video as VideoIcon,
    Link as LinkIcon,
    ExternalLink
} from "lucide-react";

import "react-datepicker/dist/react-datepicker.css";

import { getStatusBadge } from "@/utils";
import KanbanBoard from "./KanbanBoard";
import TaskModal from "@/components/TaskModal";
import OnboardingTemplateModal from "@/components/OnboardingTemplateModal";
import RecurringTaskModal from "@/components/RecurringTaskModal";
import { fetchTasks, patchTaskStatus, deleteTask, updateTask } from "@/store/slices/taskSlice";
import { fetchClients } from "@/store/slices/clientSlice";
import { ROLE, Task } from "@/utils/types";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog";
import api, { getUploadFileUrl } from "@/lib/api";

const TasksPage = () => {
    const dispatch = useDispatch();
    const [searchParams] = useSearchParams();
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<Number>(0);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [enabled, setEnabled] = useState(false);
    const [showCredentials, setShowCredentials] = useState<Record<string, boolean>>({});
    const [filterStatus, setFilterStatus] = useState<string>("all");
    const [filterClientId, setFilterClientId] = useState<string>("all");
    const [filterAssigneeId, setFilterAssigneeId] = useState<string>("all");
    const [taskListTab, setTaskListTab] = useState<"upcoming" | "completed">("upcoming");
    const [showOnboardingModal, setShowOnboardingModal] = useState(false);
    const [showRecurringModal, setShowRecurringModal] = useState(false);
    const [recurringRules, setRecurringRules] = useState<Array<{
      id: string;
      title: string;
      description?: string | null;
      category?: string | null;
      status?: string;
      priority?: string | null;
      estimatedHours?: number | null;
      assigneeId?: string | null;
      clientId?: string | null;
      frequency: string;
      nextRunAt: string;
      isActive: boolean;
      proof?: unknown;
    }>>([]);
    const [recurringRulesOpen, setRecurringRulesOpen] = useState(false);
    const [editingRecurringRule, setEditingRecurringRule] = useState<typeof recurringRules[0] | null>(null);
    const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
    const [assignableUsers, setAssignableUsers] = useState<Array<{ id: string; name: string | null; email: string; role?: string }>>([]);
    const [assignSelectedOpen, setAssignSelectedOpen] = useState(false);
    const [assignSelectedSpecialistId, setAssignSelectedSpecialistId] = useState<string>("");
    const [bulkAssigning, setBulkAssigning] = useState(false);
    const { tasks } = useSelector((state: RootState) => state.task);
    const { user } = useSelector((state: RootState) => state.auth);
    const { clients } = useSelector((state: RootState) => state.client);

    useEffect(() => {
        const clientId = searchParams.get("clientId");
        if (clientId) setFilterClientId(clientId);
    }, [searchParams]);

    // Only non-specialists can create and bulk-assign
    const canCreate = (user?.role as ROLE | undefined) !== "SPECIALIST";
    const canFilterByClient = (user?.role as ROLE | undefined) !== "USER";

    const assigneeRoleLabel = (role: string | undefined) => {
        if (role === "SUPER_ADMIN") return "Super Admin";
        if (role === "ADMIN") return "Admin";
        return "Specialist";
    };

    useEffect(() => {
        if (!canCreate) return;
        const isSuperAdmin = user?.role === "SUPER_ADMIN";
        if (isSuperAdmin) {
            api.get("/tasks/assignable-users")
                .then((res) => setAssignableUsers(res.data || []))
                .catch(() => setAssignableUsers([]));
        } else {
            api.get("/auth/specialists")
                .then((res) => {
                    const list = res.data || [];
                    setAssignableUsers(list.map((u: { id: string; name: string | null; email: string }) => ({ ...u, role: "SPECIALIST" })));
                })
                .catch(() => setAssignableUsers([]));
        }
    }, [canCreate, user?.role]);

    const toggleTaskSelection = (taskId: string) => {
        setSelectedTaskIds((prev) =>
            prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
        );
    };
    const selectAllFiltered = () => {
        const ids = displayedTasks.map((t) => t.id);
        setSelectedTaskIds((prev) => (prev.length === ids.length ? [] : ids));
    };
    const clearSelection = () => setSelectedTaskIds([]);

    const handleBulkAssign = async () => {
        if (selectedTaskIds.length === 0) return;
        setBulkAssigning(true);
        try {
            const assigneeId = assignSelectedSpecialistId || null;
            for (const id of selectedTaskIds) {
                await dispatch(updateTask({ id, assigneeId }) as any);
            }
            toast.success(`${selectedTaskIds.length} task(s) assigned successfully.`);
            clearSelection();
            setAssignSelectedOpen(false);
            setAssignSelectedSpecialistId("");
            dispatch(fetchTasks() as any);
        } catch (e: any) {
            toast.error(e?.message || "Failed to assign tasks");
        } finally {
            setBulkAssigning(false);
        }
    };

    const handleCreateClick = () => {
        setSelectedTask(null);
        setMode(0);
        setOpen(true);
    };

    const handleEditClick = (task: Task) => {
        setSelectedTask(task);
        setMode(1);
        setOpen(true);
    };

  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; taskId: string | null }>({
    isOpen: false,
    taskId: null,
  });

  const handleDeleteTask = async (id: string) => {
    setDeleteConfirm({ isOpen: true, taskId: id });
  };

  const confirmDeleteTask = async () => {
    if (!deleteConfirm.taskId) return;
    try {
      await dispatch(deleteTask(deleteConfirm.taskId) as any);
      toast.success("Task deleted successfully!");
      setDeleteConfirm({ isOpen: false, taskId: null });
    } catch (error: any) {
      console.error("Failed to delete task:", error);
      setDeleteConfirm({ isOpen: false, taskId: null });
    }
  };

    const toggleCredentials = (id: string) => {
        setShowCredentials(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    const isOverdue = (dueDate: string | null | undefined) => {
        if (!dueDate) return false;
        return new Date(dueDate) < new Date();
    };

    const overdueCount = useMemo(
        () => tasks.filter((t) => t.status !== "DONE" && isOverdue(t.dueDate)).length,
        [tasks]
    );

    const upcomingCount = useMemo(
        () => tasks.filter((t) => t.status !== "DONE").length,
        [tasks]
    );

    const clientOptions = useMemo(() => {
        const map = new Map<string, { id: string; name: string }>();
        for (const t of tasks) {
            if (t.client?.id && t.client?.name) {
                map.set(t.client.id, { id: t.client.id, name: t.client.name });
            }
        }
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [tasks]);

    const filtered = tasks.filter((t) => {
        const q = searchTerm.toLowerCase();
        const matchesSearch = (
            t.title.toLowerCase().includes(q) ||
            (t.description ?? "").toLowerCase().includes(q) ||
            (t.category ?? "").toLowerCase().includes(q) ||
            (t.assignee?.name ?? "").toLowerCase().includes(q) ||
            (t.client?.name ?? "").toLowerCase().includes(q)
        );
        
        const matchesStatus =
            filterStatus === "all" ||
            (filterStatus === "upcoming" && t.status !== "DONE") ||
            (filterStatus === "overdue" && t.status !== "DONE" && isOverdue(t.dueDate)) ||
            t.status.toLowerCase() === filterStatus.toLowerCase();

        const matchesClient =
            filterClientId === "all" || (t.client?.id ? t.client.id === filterClientId : false);

        const matchesAssignee =
            filterAssigneeId === "all" ||
            (filterAssigneeId === "unassigned" && !t.assignee?.id) ||
            (t.assignee?.id === filterAssigneeId);

        return matchesSearch && matchesStatus && matchesClient && matchesAssignee;
    });

    const isSuperAdmin = user?.role === "SUPER_ADMIN";

    // For Super Admin: split into Upcoming (sorted by next due) and Completed
    const upcomingTasks = useMemo(() => {
        const list = filtered.filter((t) => t.status !== "DONE");
        return [...list].sort((a, b) => {
            const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
            const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
            return aDue - bDue;
        });
    }, [filtered]);

    const completedTasks = useMemo(() => {
        const list = filtered.filter((t) => t.status === "DONE");
        return [...list].sort((a, b) => {
            const aDue = a.dueDate ? new Date(a.dueDate).getTime() : 0;
            const bDue = b.dueDate ? new Date(b.dueDate).getTime() : 0;
            return bDue - aDue;
        });
    }, [filtered]);

    const filteredSortedByDueDate = useMemo(() => {
        return [...filtered].sort((a, b) => {
            const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
            const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
            return aDue - bDue;
        });
    }, [filtered]);

    const displayedTasks = isSuperAdmin
        ? taskListTab === "upcoming"
            ? upcomingTasks
            : completedTasks
        : filteredSortedByDueDate;

    useEffect(() => { dispatch(fetchTasks() as any); }, [dispatch]);

    const fetchRecurringRules = () => {
        if (!canCreate) return;
        api.get("/tasks/recurring")
            .then((res) => setRecurringRules(Array.isArray(res.data) ? res.data : []))
            .catch(() => setRecurringRules([]));
    };
    useEffect(() => {
        if (canCreate) fetchRecurringRules();
    }, [canCreate]);
    useEffect(() => {
        if (recurringRulesOpen && canCreate && clients.length === 0) {
            dispatch(fetchClients() as any);
        }
    }, [recurringRulesOpen, canCreate, clients.length, dispatch]);

    const handleStopRecurrence = async (id: string) => {
        try {
            await api.patch(`/tasks/recurring/${id}/stop`);
            toast.success("Recurrence stopped.");
            fetchRecurringRules();
        } catch (e: any) {
            toast.error(e?.response?.data?.message || "Failed to stop recurrence");
        }
    };

    const handleResumeRecurrence = async (id: string) => {
        try {
            await api.patch(`/tasks/recurring/${id}/resume`);
            toast.success("Recurrence resumed.");
            fetchRecurringRules();
        } catch (e: any) {
            toast.error(e?.response?.data?.message || "Failed to resume recurrence");
        }
    };

    const [removeRecurringConfirm, setRemoveRecurringConfirm] = useState<{ isOpen: boolean; ruleId: string | null }>({
        isOpen: false,
        ruleId: null,
    });
    const handleRemoveRecurrence = (id: string) => setRemoveRecurringConfirm({ isOpen: true, ruleId: id });
    const confirmRemoveRecurrence = async () => {
        if (!removeRecurringConfirm.ruleId) return;
        try {
            await api.delete(`/tasks/recurring/${removeRecurringConfirm.ruleId}`);
            toast.success("Recurring task removed.");
            fetchRecurringRules();
            setRemoveRecurringConfirm({ isOpen: false, ruleId: null });
        } catch (e: any) {
            toast.error(e?.response?.data?.message || "Failed to remove recurring task");
            setRemoveRecurringConfirm({ isOpen: false, ruleId: null });
        }
    };

    const frequencyLabel = (f: string) => {
        if (f === "WEEKLY") return "Weekly";
        if (f === "MONTHLY") return "Monthly";
        if (f === "QUARTERLY") return "Quarterly";
        if (f === "SEMIANNUAL") return "Every 6 months";
        return f;
    };

    return (
        <div className="p-8">
            {/* Header */}
            <div className="flex justify-between items-end mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Tasks</h1>
                    <p className="text-gray-600 mt-2">
                        Manage all tasks and assign to the specialists
                    </p>
                    {overdueCount > 0 && (
                        <div className="mt-2 flex items-center text-red-600">
                            <AlertTriangle className="h-4 w-4 mr-1" />
                            <span className="text-sm font-medium">
                                {overdueCount} overdue task{overdueCount !== 1 ? 's' : ''}
                            </span>
                        </div>
                    )}
                </div>
                {canCreate && (
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            onClick={() => setShowOnboardingModal(true)}
                            className="bg-gray-100 text-gray-700 px-4 py-3 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-2"
                        >
                            <ListTodo className="h-5 w-5" />
                            <span>Onboarding Tasks</span>
                        </button>
                        <button
                            onClick={() => { setEditingRecurringRule(null); setShowRecurringModal(true); }}
                            className="bg-gray-100 text-gray-700 px-4 py-3 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-2"
                        >
                            <Repeat className="h-5 w-5" />
                            <span>Add Recurring Task</span>
                        </button>
                        <button
                            onClick={handleCreateClick}
                            className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2"
                        >
                            <Plus className="h-5 w-5" />
                            <span>Create Task</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Task metrics: click to filter table by status */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 mb-8">
                <button
                    type="button"
                    onClick={() => setFilterStatus("upcoming")}
                    className={`bg-white p-6 rounded-xl border text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${filterStatus === "upcoming" ? "border-primary-500 ring-2 ring-primary-200" : "border-gray-200"}`}
                >
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600">Total Upcoming Tasks</p>
                            <p className="text-2xl font-bold text-gray-900">{upcomingCount}</p>
                        </div>
                        <ListTodo className="h-8 w-8 text-primary-600" />
                    </div>
                </button>
                <button
                    type="button"
                    onClick={() => setFilterStatus("TODO")}
                    className={`bg-white p-6 rounded-xl border text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${filterStatus === "TODO" ? "border-primary-500 ring-2 ring-primary-200" : "border-gray-200"}`}
                >
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600">TODO</p>
                            <p className="text-2xl font-bold text-gray-400">
                                {tasks.filter((m) => m.status === "TODO").length}
                            </p>
                        </div>
                        <ListTodo className="h-8 w-8 text-gray-400" />
                    </div>
                </button>
                <button
                    type="button"
                    onClick={() => setFilterStatus("IN_PROGRESS")}
                    className={`bg-white p-6 rounded-xl border text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${filterStatus === "IN_PROGRESS" ? "border-primary-500 ring-2 ring-primary-200" : "border-gray-200"}`}
                >
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600">IN_PROGRESS</p>
                            <p className="text-2xl font-bold text-blue-400">
                                {tasks.filter((m) => m.status === "IN_PROGRESS").length}
                            </p>
                        </div>
                        <Edit className="h-8 w-8 text-blue-400" />
                    </div>
                </button>
                <button
                    type="button"
                    onClick={() => setFilterStatus("REVIEW")}
                    className={`bg-white p-6 rounded-xl border text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${filterStatus === "REVIEW" ? "border-primary-500 ring-2 ring-primary-200" : "border-gray-200"}`}
                >
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600">REVIEW</p>
                            <p className="text-2xl font-bold text-orange-400">
                                {tasks.filter((m) => m.status === "REVIEW").length}
                            </p>
                        </div>
                        <CheckCircle className="h-8 w-8 text-orange-400" />
                    </div>
                </button>
                <button
                    type="button"
                    onClick={() => setFilterStatus("overdue")}
                    className={`bg-white p-6 rounded-xl border text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${filterStatus === "overdue" ? "border-primary-500 ring-2 ring-primary-200" : "border-gray-200"}`}
                >
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600">OVERDUE</p>
                            <p className="text-2xl font-bold text-rose-500">{overdueCount}</p>
                        </div>
                        <AlertTriangle className="h-8 w-8 text-rose-500" />
                    </div>
                </button>
                <button
                    type="button"
                    onClick={() => setFilterStatus("DONE")}
                    className={`bg-white p-6 rounded-xl border text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${filterStatus === "DONE" ? "border-primary-500 ring-2 ring-primary-200" : "border-gray-200"}`}
                >
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600">DONE</p>
                            <p className="text-2xl font-bold text-secondary-600">
                                {tasks.filter((m) => m.status === "DONE").length}
                            </p>
                        </div>
                        <CheckCheck className="h-8 w-8 text-secondary-600" />
                    </div>
                </button>
            </div>

            {/* Filters */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 mb-8">
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1">
                        <div className="relative">
                            <Search className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                            <input
                                type="text"
                                placeholder="Search tasks..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            />
                        </div>
                    </div>
                    
                    {/* Client Filter */}
                    {canFilterByClient && (
                        <div className="flex items-center space-x-2">
                            <Globe className="h-5 w-5 text-gray-400" />
                            <select
                                value={filterClientId}
                                onChange={(e) => setFilterClientId(e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            >
                                <option value="all">All Clients</option>
                                {clientOptions.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Status Filter */}
                    <div className="flex items-center space-x-2">
                        <Filter className="h-5 w-5 text-gray-400" />
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        >
                            <option value="all">All Tasks</option>
                            <option value="upcoming">Upcoming</option>
                            <option value="overdue">Overdue</option>
                            <option value="TODO">TODO</option>
                            <option value="IN_PROGRESS">IN_PROGRESS</option>
                            <option value="REVIEW">REVIEW</option>
                            <option value="DONE">DONE</option>
                        </select>
                    </div>

                    {/* Assignee Filter (Specialist / Admin tasks) */}
                    {canCreate && (
                        <div className="flex items-center space-x-2">
                            <User className="h-5 w-5 text-gray-400" />
                            <select
                                value={filterAssigneeId}
                                onChange={(e) => setFilterAssigneeId(e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            >
                                <option value="all">All Assignees</option>
                                <option value="unassigned">Unassigned</option>
                                {assignableUsers.map((u) => (
                                    <option key={u.id} value={u.id}>
                                        {u.name || u.email} ({assigneeRoleLabel(u.role)})
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Select Mode (Table | Kanban) */}
                    <div className="flex flex-row items-center">
                        <button
                            onClick={() => setEnabled((prev) => !prev)}
                            className={`relative w-16 h-9 rounded-full transition-colors duration-300 ${enabled ? "bg-blue-500" : "bg-gray-400"}`}
                        >
                            <span
                                className={`absolute top-1 left-1 w-7 h-7 rounded-full flex items-center justify-center bg-white shadow-md transform transition-transform duration-300 ${enabled ? "translate-x-7" : "translate-x-0"}`}
                            >
                                {enabled ? (
                                    <Kanban className="w-4 h-4 text-yellow-500" />
                                ) : (
                                    <Table className="w-4 h-4 text-indigo-600" />
                                )}
                            </span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Recurring tasks - above task list */}
            {canCreate && (
                <div className="bg-white rounded-xl border border-gray-200 mb-8 overflow-hidden">
                    <button
                        type="button"
                        onClick={() => setRecurringRulesOpen((o) => !o)}
                        className="flex items-center gap-2 text-left w-full px-6 py-4 hover:bg-gray-50 transition-colors"
                    >
                        <Repeat className="h-5 w-5 text-gray-500" />
                        <span className="font-medium text-gray-900">Recurring tasks ({recurringRules.filter((r) => r.isActive).length} active)</span>
                    </button>
                    {recurringRulesOpen && (
                        <div className="border-t border-gray-200 overflow-x-auto">
                            {recurringRules.length === 0 ? (
                                <div className="px-6 py-8 text-sm text-gray-500">No recurring tasks yet. Use “Add Recurring Task” above to create one.</div>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider border-l-4 border-primary-400 first:border-l-0">Task</th>
                                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-emerald-800 uppercase tracking-wider border-l-4 border-emerald-300">Recurrence</th>
                                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-amber-800 uppercase tracking-wider border-l-4 border-amber-300">Client</th>
                                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Status</th>
                                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Assignee</th>
                                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Due Date</th>
                                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {recurringRules.map((r, idx) => (
                                            <tr key={r.id} className={`transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-primary-50/50`}>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col">
                                                        <div className="text-sm font-medium text-gray-900">{r.title}</div>
                                                        <div className="text-xs text-gray-500">{r.category ?? "—"}</div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{frequencyLabel(r.frequency)}</td>
                                                <td className="px-6 py-4">
                                                    {r.clientId ? (
                                                        <div className="flex flex-col">
                                                            <div className="flex items-center space-x-2">
                                                                <Globe className="h-4 w-4 text-gray-400" />
                                                                <span className="text-sm font-medium text-gray-900">{clients.find((c) => c.id === r.clientId)?.name ?? "—"}</span>
                                                            </div>
                                                            <div className="text-xs text-gray-500">{clients.find((c) => c.id === r.clientId)?.domain ?? ""}</div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-sm text-gray-400">No client</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`px-2 py-1 text-xs font-bold rounded-full ${r.isActive ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                                                        {r.isActive ? "Active" : "Stopped"}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                    {r.assigneeId ? (assignableUsers.find((u) => u.id === r.assigneeId)?.name ?? assignableUsers.find((u) => u.id === r.assigneeId)?.email ?? "—") : "Unassigned"}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                    <div className="flex items-center">
                                                        <Calendar className="h-4 w-4 mr-1 text-gray-400" />
                                                        {format(new Date(r.nextRunAt), "MMM dd, yyyy")}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                    <div className="flex items-center gap-1">
                                                        {r.isActive ? (
                                                            <button type="button" onClick={() => handleStopRecurrence(r.id)} className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors" title="Stop recurrence">
                                                                <StopCircle className="h-4 w-4" />
                                                            </button>
                                                        ) : (
                                                            <button type="button" onClick={() => handleResumeRecurrence(r.id)} className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors" title="Resume">
                                                                <Play className="h-4 w-4" />
                                                            </button>
                                                        )}
                                                        <button type="button" onClick={() => { setEditingRecurringRule(r); setShowRecurringModal(true); }} className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors" title="Edit">
                                                            <Edit className="h-4 w-4" />
                                                        </button>
                                                        <button type="button" onClick={() => handleRemoveRecurrence(r.id)} className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors" title="Remove">
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Upcoming / Completed tabs (Super Admin only) */}
            {isSuperAdmin && (
                <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit mb-6">
                    <button
                        type="button"
                        onClick={() => setTaskListTab("upcoming")}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${taskListTab === "upcoming" ? "bg-white text-primary-600 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
                    >
                        Upcoming ({upcomingTasks.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setTaskListTab("completed")}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${taskListTab === "completed" ? "bg-white text-primary-600 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
                    >
                        Completed ({completedTasks.length})
                    </button>
                </div>
            )}

            {/* Task View */}
            {(!enabled) ? (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    {canCreate && selectedTaskIds.length > 0 && (
                        <div className="px-6 py-3 bg-primary-50 border-b border-primary-100 flex flex-wrap items-center gap-3">
                            <span className="text-sm font-medium text-primary-800">
                                {selectedTaskIds.length} task(s) selected
                            </span>
                            <button
                                type="button"
                                onClick={() => setAssignSelectedOpen(true)}
                                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                            >
                                Assign Selected
                            </button>
                            <button
                                type="button"
                                onClick={clearSelection}
                                className="text-sm text-gray-600 hover:text-gray-900"
                            >
                                Clear selection
                            </button>
                            {assignSelectedOpen && (
                                <div className="flex items-center gap-2 ml-2 flex-wrap">
                                    <select
                                        value={assignSelectedSpecialistId}
                                        onChange={(e) => setAssignSelectedSpecialistId(e.target.value)}
                                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                    >
                                        <option value="">Unassigned</option>
                                        {assignableUsers.map((u) => (
                                            <option key={u.id} value={u.id}>
                                                {u.name || u.email} ({assigneeRoleLabel(u.role)})
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        type="button"
                                        onClick={handleBulkAssign}
                                        disabled={bulkAssigning}
                                        className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-50"
                                    >
                                        {bulkAssigning ? "Assigning…" : "Assign"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setAssignSelectedOpen(false)}
                                        className="text-sm text-gray-600 hover:text-gray-900"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                                    {canCreate && (
                                        <th className="px-4 py-3.5 text-left border-l-4 border-transparent">
                                            <input
                                                type="checkbox"
                                                checked={displayedTasks.length > 0 && selectedTaskIds.length === displayedTasks.length}
                                                onChange={selectAllFiltered}
                                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                            />
                                        </th>
                                    )}
                                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider border-l-4 border-primary-400 first:border-l-0">Task</th>
                                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-emerald-800 uppercase tracking-wider border-l-4 border-emerald-300">Client</th>
                                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Status</th>
                                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-amber-800 uppercase tracking-wider border-l-4 border-amber-300">Assignee</th>
                                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Due Date</th>
                                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {displayedTasks.map((task, index) => (
                                    <tr key={task.id} className={`transition-colors ${index % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-primary-50/50 ${isOverdue(task.dueDate) ? 'bg-red-50/50' : ''}`}>
                                        {canCreate && (
                                            <td className="px-4 py-4">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedTaskIds.includes(task.id)}
                                                    onChange={() => toggleTaskSelection(task.id)}
                                                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                                />
                                            </td>
                                        )}
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <div className="text-sm font-medium text-gray-900">{task.title}</div>
                                                <div className="text-xs text-gray-500">{task.category ?? "No category"}</div>
                                                {task.description && (
                                                    <div className="text-xs text-gray-400 mt-1 truncate max-w-xs">
                                                        {task.description}
                                                    </div>
                                                )}
                                                {/* Proof/Attachments (proof can be JSON string or array from API) */}
                                                {(() => {
                                                    const proofList = Array.isArray(task.proof)
                                                        ? task.proof
                                                        : typeof task.proof === "string"
                                                            ? (() => {
                                                                try {
                                                                    const parsed = JSON.parse(task.proof);
                                                                    return Array.isArray(parsed) ? parsed : [];
                                                                } catch {
                                                                    return [];
                                                                }
                                                            })()
                                                            : [];
                                                    if (proofList.length === 0) return null;
                                                    return (
                                                        <div className="mt-2 flex flex-wrap gap-2">
                                                            {proofList.map((item: any, idx: number) => (
                                                            <a
                                                                key={idx}
                                                                href={getUploadFileUrl(item.value)}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="flex items-center space-x-1 text-xs text-primary-600 hover:text-primary-800"
                                                            >
                                                                {item.type === "image" && <ImageIcon className="h-3 w-3" />}
                                                                {item.type === "video" && <VideoIcon className="h-3 w-3" />}
                                                                {item.type === "url" && <LinkIcon className="h-3 w-3" />}
                                                                <span className="truncate max-w-[100px]">
                                                                    {item.name || "Proof"}
                                                                </span>
                                                                <ExternalLink className="h-3 w-3" />
                                                            </a>
                                                            ))}
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {task.client ? (
                                                <div className="flex flex-col">
                                                    <div className="flex items-center space-x-2">
                                                        <Globe className="h-4 w-4 text-gray-400" />
                                                        <span className="text-sm font-medium text-gray-900">{task.client.name}</span>
                                                    </div>
                                                    <div className="text-xs text-gray-500">{task.client.domain}</div>
                                                    
                                                    {/* Login Credentials */}
                                                    {((task.client as any).loginUrl || (task.client as any).username) && (
                                                        <div className="mt-2">
                                                            <button
                                                                onClick={() => toggleCredentials(task.id)}
                                                                className="flex items-center space-x-1 text-xs text-primary-600 hover:text-primary-800"
                                                            >
                                                                <Key className="h-3 w-3" />
                                                                <span>Login Info</span>
                                                                {showCredentials[task.id] ? (
                                                                    <EyeOff className="h-3 w-3" />
                                                                ) : (
                                                                    <Eye className="h-3 w-3" />
                                                                )}
                                                            </button>
                                                            
                                                            {showCredentials[task.id] && (
                                                                <div className="mt-1 p-2 bg-gray-100 rounded text-xs">
                                                                    {(task.client as any).loginUrl && (
                                                                        <div className="mb-1">
                                                                            <span className="font-medium">URL:</span> 
                                                                            <a href={(task.client as any).loginUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-1">
                                                                                {(task.client as any).loginUrl}
                                                                            </a>
                                                                        </div>
                                                                    )}
                                                                    {(task.client as any).username && (
                                                                        <div className="mb-1">
                                                                            <span className="font-medium">Username:</span> 
                                                                            <span className="ml-1">{(task.client as any).username}</span>
                                                                        </div>
                                                                    )}
                                                                    {(task.client as any).password && (
                                                                        <div className="mb-1">
                                                                            <span className="font-medium">Password:</span> 
                                                                            <span className="ml-1 font-mono">{(task.client as any).password}</span>
                                                                        </div>
                                                                    )}
                                                                    {(task.client as any).notes && (
                                                                        <div>
                                                                            <span className="font-medium">Notes:</span> 
                                                                            <span className="ml-1">{(task.client as any).notes}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-sm text-gray-400">No client assigned</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex flex-col items-start">
                                                <span className={`px-2 py-1 text-xs font-bold rounded-full ${getStatusBadge(task.status)}`}>
                                                    {task.status}
                                                </span>
                                                {isOverdue(task.dueDate) && (
                                                    <span className="text-xs text-red-600 mt-1 flex items-center">
                                                        <Clock className="h-3 w-3 mr-1" />
                                                        Overdue
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            {task.assignee?.name ?? "Unassigned"}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                            {task.dueDate ? (
                                                <div className={`flex items-center ${isOverdue(task.dueDate) ? 'text-red-600' : 'text-gray-900'}`}>
                                                    <Calendar className="h-4 w-4 mr-1" />
                                                    {format(new Date(task.dueDate), "MMM dd, yyyy")}
                                                </div>
                                            ) : (
                                                <span className="text-gray-400">No due date</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                            <div className="flex items-center gap-1">
                                                <button
                                                    className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                                                    onClick={() => handleEditClick(task)}
                                                    title="Edit task"
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </button>
                                                <button
                                                    className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                    onClick={() => handleDeleteTask(task.id)}
                                                    title="Delete task"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <KanbanBoard
                    tasks={displayedTasks}
                    onMove={(id, status) => dispatch(patchTaskStatus({ id, status }) as any)}
                    onTaskClick={handleEditClick}
                />
            )}

            {/* Create Task Modal */}
            <TaskModal
                mode={mode}
                title={mode === 0 ? "Create Task" : "Edit Task"}
                open={open}
                setOpen={setOpen}
                task={selectedTask ?? undefined}
            />

            {/* Onboarding Template Modal */}
            <OnboardingTemplateModal
                open={showOnboardingModal}
                setOpen={setShowOnboardingModal}
                onTasksCreated={() => {
                    dispatch(fetchTasks() as any);
                    setShowOnboardingModal(false);
                }}
            />

            {/* Recurring Task Modal */}
            <RecurringTaskModal
                open={showRecurringModal}
                setOpen={(v) => { setShowRecurringModal(v); if (!v) setEditingRecurringRule(null); }}
                onSaved={fetchRecurringRules}
                rule={editingRecurringRule}
            />

            {/* Delete Confirmation Dialog */}
            <ConfirmDialog
                isOpen={deleteConfirm.isOpen}
                onClose={() => setDeleteConfirm({ isOpen: false, taskId: null })}
                onConfirm={confirmDeleteTask}
                title="Delete Task"
                message="Are you sure you want to delete this task? This action cannot be undone and all task data will be permanently removed."
                confirmText="Delete"
                cancelText="Cancel"
                variant="danger"
            />

            {/* Remove Recurring Task Confirmation Dialog */}
            <ConfirmDialog
                isOpen={removeRecurringConfirm.isOpen}
                onClose={() => setRemoveRecurringConfirm({ isOpen: false, ruleId: null })}
                onConfirm={confirmRemoveRecurrence}
                title="Remove Recurring Task"
                message="Are you sure you want to remove this recurring task? It will no longer create new tasks. This cannot be undone."
                confirmText="Remove"
                cancelText="Cancel"
                variant="danger"
            />
        </div>
    );
};

export default TasksPage;
