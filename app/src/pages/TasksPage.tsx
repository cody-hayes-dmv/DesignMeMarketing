import { useEffect, useMemo, useRef, useState } from "react";
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
    ExternalLink,
    MessageSquare,
    ChevronLeft,
    ChevronRight,
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

const TASKS_PAGE_SIZES = [25, 50, 100, 250] as const;

const TasksPage = () => {
    const dispatch = useDispatch();
    const [searchParams, setSearchParams] = useSearchParams();
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<Number>(0);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const lastAutoOpenedTaskIdRef = useRef<string | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [enabled, setEnabled] = useState(false);
    const [showCredentials, setShowCredentials] = useState<Record<string, boolean>>({});
    const [filterStatus, setFilterStatus] = useState<string>("all");
    const [filterClientId, setFilterClientId] = useState<string>("all");
    const [filterAssigneeId, setFilterAssigneeId] = useState<string>("all");
    const [taskListTab, setTaskListTab] = useState<"upcoming" | "completed">("upcoming");
    const [tasksPageSize, setTasksPageSize] = useState<(typeof TASKS_PAGE_SIZES)[number]>(25);
    const [tasksPage, setTasksPage] = useState(1);
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
      assignee?: { id: string; name: string | null; email: string } | null;
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
    const [bulkEditOpen, setBulkEditOpen] = useState(false);
    const [bulkAssigning, setBulkAssigning] = useState(false);
    const [bulkDeleting, setBulkDeleting] = useState(false);
    const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
    const { tasks } = useSelector((state: RootState) => state.task);
    const { user } = useSelector((state: RootState) => state.auth);
    const { clients } = useSelector((state: RootState) => state.client);

    useEffect(() => {
        const clientId = searchParams.get("clientId");
        if (clientId) setFilterClientId(clientId);

        const status = searchParams.get("status");
        const allowedStatuses = new Set([
            "all",
            "upcoming",
            "overdue",
            "TODO",
            "IN_PROGRESS",
            "REVIEW",
            "NEEDS_APPROVAL",
            "DONE",
        ]);
        if (status && allowedStatuses.has(status)) setFilterStatus(status);

        const assigneeMe = searchParams.get("assigneeMe");
        if ((assigneeMe === "true" || assigneeMe === "1") && user?.id) {
            setFilterAssigneeId(user.id);
        }
    }, [searchParams, user?.id]);

    // Auto-open task modal from notification link (?taskId=xxx).
    // Fetch directly by id with a cache-busting param so we never open stale task content.
    useEffect(() => {
        const taskId = searchParams.get("taskId");
        if (!taskId) {
            lastAutoOpenedTaskIdRef.current = null;
            return;
        }
        if (lastAutoOpenedTaskIdRef.current === taskId) return;
        lastAutoOpenedTaskIdRef.current = taskId;

        // Refresh list in background so modal/task list converge to latest server state.
        void dispatch(fetchTasks() as any);

        const localTask = tasks.find((t) => t.id === taskId);
        if (localTask) {
            setSelectedTask(localTask);
            setMode(1);
            setOpen(true);
        }

        let cancelled = false;
        api
            .get(`/tasks/${taskId}`, {
                _silent: true,
                params: { _ts: Date.now() },
            } as any)
            .then((res) => {
                if (cancelled) return;
                if (res?.data?.id) {
                    setSelectedTask(res.data);
                    setMode(1);
                    setOpen(true);
                    // Keep list/table in sync with the task opened from notification.
                    void dispatch(fetchTasks() as any);
                }
            })
            .catch(() => {
                // If direct fetch fails but local task exists, modal already opened above.
            });

        return () => {
            cancelled = true;
        };
    }, [searchParams, tasks, dispatch]);

    // Keep an opened client task modal synced with freshest task entity from store.
    useEffect(() => {
        if (!open || user?.role !== "USER" || !selectedTask?.id) return;
        const latest = tasks.find((t) => t.id === selectedTask.id);
        if (!latest) return;
        const stale =
            latest.status !== selectedTask.status ||
            (latest.updatedAt ?? null) !== (selectedTask.updatedAt ?? null) ||
            (latest.description ?? null) !== (selectedTask.description ?? null) ||
            (latest.title ?? null) !== (selectedTask.title ?? null);
        if (stale) {
            setSelectedTask(latest);
        }
    }, [open, user?.role, selectedTask, tasks]);

    // Fetch unread activity counts per task from notifications feed.
    // This avoids depending on /tasks/unread-counts, which may not exist on older production backends.
    const fetchUnreadCounts = () => {
        const role = user?.role;
        const notificationsUrl =
            role === "SUPER_ADMIN" || role === "ADMIN"
                ? "/seo/super-admin/notifications"
                : role === "AGENCY" || role === "SPECIALIST"
                    ? "/agencies/me/notifications"
                    : null;

        if (!notificationsUrl) {
            setUnreadCounts({});
            return;
        }

        api.get(notificationsUrl, { _silent: true } as any)
            .then((res: any) => {
                const items = Array.isArray(res?.data?.items) ? res.data.items : [];
                const counts: Record<string, number> = {};
                items.forEach((n: any) => {
                    if (n?.read) return;
                    const link = String(n?.link || "");
                    const match = link.match(/[?&]taskId=([a-zA-Z0-9_-]+)/);
                    if (!match?.[1]) return;
                    counts[match[1]] = (counts[match[1]] || 0) + 1;
                });
                setUnreadCounts(counts);
            })
            .catch(() => setUnreadCounts({}));
    };
    useEffect(() => {
        fetchUnreadCounts();
        const interval = setInterval(fetchUnreadCounts, 30000);
        return () => clearInterval(interval);
    }, [user?.role]);

    // Only agency/admin/super-admin can create, bulk-assign, and manage tasks
    const isClientUser = user?.role === "USER";
    const canCreate = !isClientUser && (user?.role as ROLE | undefined) !== "SPECIALIST";
    const canFilterByClient = true;

    const assigneeRoleLabel = (role: string | undefined) => {
        if (role === "SUPER_ADMIN") return "Super Admin";
        if (role === "ADMIN") return "Admin";
        if (role === "AGENCY") return "Agency";
        return "Specialist";
    };

    const canBulkManageTask = (task: Task) => {
        const actorRole = String(user?.role || "").toUpperCase();
        const creatorRole = String(task.createdBy?.role || "").toUpperCase();
        if (actorRole === "SUPER_ADMIN") return true;
        if (actorRole === "ADMIN") return creatorRole === "ADMIN";
        if (actorRole === "AGENCY") return creatorRole === "AGENCY";
        return false;
    };

    useEffect(() => {
        if (!canCreate) return;
        const isAdminView = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";
        if (isAdminView) {
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
        const task = tasks.find((t) => t.id === taskId);
        if (!task || !canBulkManageTask(task)) return;
        setSelectedTaskIds((prev) =>
            prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
        );
    };
    const selectAllFiltered = () => {
        const ids = paginatedDisplayedTasks.rows.filter(canBulkManageTask).map((t) => t.id);
        if (ids.length === 0) return;
        setSelectedTaskIds((prev) => {
            const visibleSet = new Set(ids);
            const selectedVisibleCount = prev.filter((id) => visibleSet.has(id)).length;
            if (selectedVisibleCount === ids.length) {
                return prev.filter((id) => !visibleSet.has(id));
            }
            const merged = new Set([...prev, ...ids]);
            return Array.from(merged);
        });
    };
    const clearSelection = () => {
        setSelectedTaskIds([]);
        setBulkEditOpen(false);
        setAssignSelectedOpen(false);
        setAssignSelectedSpecialistId("");
    };

    const handleBulkAssign = async () => {
        const selectedEligibleIds = selectedTaskIds.filter((id) => {
            const t = tasks.find((task) => task.id === id);
            return Boolean(t && canBulkManageTask(t));
        });
        if (selectedEligibleIds.length === 0) {
            toast.error("No eligible tasks selected for bulk assign.");
            return;
        }
        setBulkAssigning(true);
        try {
            const assigneeId = assignSelectedSpecialistId || null;
            for (const id of selectedEligibleIds) {
                await dispatch(updateTask({ id, assigneeId }) as any);
            }
            toast.success(`${selectedEligibleIds.length} task(s) assigned successfully.`);
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

  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; taskId: string | null; taskIds: string[] }>({
    isOpen: false,
    taskId: null,
    taskIds: [],
  });

  const handleDeleteTask = async (id: string) => {
    setDeleteConfirm({ isOpen: true, taskId: id, taskIds: [] });
  };

  const handleBulkDeleteSelected = () => {
    if (selectedTaskIds.length === 0) return;
    setDeleteConfirm({ isOpen: true, taskId: null, taskIds: [...selectedTaskIds] });
  };

  const confirmDeleteTask = async () => {
    const requestedTaskIds = deleteConfirm.taskIds.length > 0
      ? deleteConfirm.taskIds
      : deleteConfirm.taskId
        ? [deleteConfirm.taskId]
        : [];
    if (requestedTaskIds.length === 0) return;
    const taskIdsToDelete = requestedTaskIds.filter((id) => {
      const t = tasks.find((task) => task.id === id);
      return Boolean(t && canBulkManageTask(t));
    });
    if (taskIdsToDelete.length === 0) {
      toast.error("No eligible tasks selected for bulk delete.");
      setDeleteConfirm({ isOpen: false, taskId: null, taskIds: [] });
      return;
    }
    try {
      if (taskIdsToDelete.length > 1) setBulkDeleting(true);
      const results = await Promise.all(
        taskIdsToDelete.map((taskId) => dispatch(deleteTask(taskId) as any))
      );
      let successCount = 0;
      let failedCount = 0;
      results.forEach((action: any) => {
        if (action?.meta?.requestStatus === "fulfilled") successCount += 1;
        else failedCount += 1;
      });

      if (successCount > 0) {
        toast.success(successCount === 1 ? "Task deleted successfully!" : `${successCount} tasks deleted successfully!`);
      }
      if (failedCount > 0) {
        toast.error(failedCount === 1 ? "1 task failed to delete." : `${failedCount} tasks failed to delete.`);
      }
      setDeleteConfirm({ isOpen: false, taskId: null, taskIds: [] });
      if (deleteConfirm.taskIds.length > 0) {
        clearSelection();
      }
      dispatch(fetchTasks() as any);
    } catch (error: any) {
      console.error("Failed to delete task:", error);
      setDeleteConfirm({ isOpen: false, taskId: null, taskIds: [] });
    } finally {
      setBulkDeleting(false);
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

    const assigneeFilterOptions = useMemo(() => {
        if (canCreate) {
            return assignableUsers.map((u) => ({
                id: u.id,
                label: `${u.name || u.email} (${assigneeRoleLabel(u.role)})`,
            }));
        }
        const map = new Map<string, { id: string; label: string }>();
        for (const t of tasks) {
            if (t.assignee?.id) {
                map.set(t.assignee.id, {
                    id: t.assignee.id,
                    label: t.assignee.name || t.assignee.email || "Unknown",
                });
            }
        }
        return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
    }, [canCreate, assignableUsers, tasks]);

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

    const paginatedDisplayedTasks = useMemo(() => {
        const totalRows = displayedTasks.length;
        const totalPages = Math.max(1, Math.ceil(totalRows / tasksPageSize));
        const page = Math.min(Math.max(1, tasksPage), totalPages);
        const startIdx = (page - 1) * tasksPageSize;
        const endIdx = Math.min(totalRows, startIdx + tasksPageSize);
        const from = totalRows === 0 ? 0 : startIdx + 1;
        const to = endIdx;
        const rows = displayedTasks.slice(startIdx, endIdx);
        return { totalRows, totalPages, page, from, to, rows };
    }, [displayedTasks, tasksPage, tasksPageSize]);

    useEffect(() => {
        setTasksPage(1);
    }, [tasksPageSize]);

    useEffect(() => {
        setTasksPage(1);
    }, [taskListTab]);

    useEffect(() => {
        setTasksPage((p) => Math.min(p, paginatedDisplayedTasks.totalPages));
    }, [paginatedDisplayedTasks.totalPages]);

    useEffect(() => {
        setSelectedTaskIds((prev) =>
            prev.filter((id) => {
                const t = tasks.find((task) => task.id === id);
                return Boolean(t && canBulkManageTask(t));
            })
        );
    }, [tasks, user?.role]);

    useEffect(() => { dispatch(fetchTasks() as any); }, [dispatch]);

    const canViewRecurring = ["SUPER_ADMIN", "ADMIN", "AGENCY", "SPECIALIST", "USER"].includes(
        String(user?.role || "")
    );
    const canChangeRecurringStatus = ["SUPER_ADMIN", "ADMIN", "AGENCY"].includes(
        String(user?.role || "")
    );
    const fetchRecurringRules = () => {
        if (!canViewRecurring) return;
        api.get("/tasks/recurring")
            .then((res) => setRecurringRules(Array.isArray(res.data) ? res.data : []))
            .catch(() => setRecurringRules([]));
    };
    useEffect(() => {
        if (canViewRecurring) fetchRecurringRules();
    }, [canViewRecurring]);
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

    const handleTaskModalOpenChange = (isOpen: boolean) => {
        setOpen(isOpen);
        if (!isOpen) {
            lastAutoOpenedTaskIdRef.current = null;
            const next = new URLSearchParams(searchParams);
            if (next.has("taskId")) {
                next.delete("taskId");
                setSearchParams(next, { replace: true });
            }
            fetchUnreadCounts();
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-violet-50/30 p-8">
            {/* Header */}
            <div className="relative mb-10 overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-500 p-8 shadow-lg">
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNnKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-50" />
                <div className="relative flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-white md:text-3xl">Tasks</h1>
                        <p className="mt-2 text-violet-100 text-sm md:text-base">
                            Manage all tasks and assign to the specialists
                        </p>
                        {overdueCount > 0 && (
                            <div className="mt-2 flex items-center text-rose-200">
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
                                className="flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
                            >
                                <ListTodo className="h-5 w-5" />
                                <span>Onboarding Tasks</span>
                            </button>
                            <button
                                onClick={() => { setEditingRecurringRule(null); setShowRecurringModal(true); }}
                                className="flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
                            >
                                <Repeat className="h-5 w-5" />
                                <span>Add Recurring Task</span>
                            </button>
                            <button
                                onClick={handleCreateClick}
                            className="flex items-center gap-2 rounded-lg bg-white/20 px-5 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
                        >
                            <Plus className="h-5 w-5" />
                            <span>Create Task</span>
                        </button>
                    </div>
                )}
                </div>
            </div>

            {/* Task metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 mb-10">
                <button
                    type="button"
                    onClick={() => setFilterStatus("upcoming")}
                    className={`group relative overflow-hidden bg-white p-6 rounded-2xl border text-left transition-all hover:-translate-y-0.5 hover:shadow-lg focus:outline-none ${filterStatus === "upcoming" ? "border-primary-300 ring-2 ring-primary-100 shadow-md shadow-primary-100/50" : "border-primary-100 hover:shadow-primary-100/50"}`}
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
                    className={`group relative overflow-hidden bg-white p-6 rounded-2xl border text-left transition-all hover:-translate-y-0.5 hover:shadow-lg focus:outline-none ${filterStatus === "TODO" ? "border-gray-400 ring-2 ring-gray-200 shadow-md shadow-gray-100/50" : "border-gray-200 hover:shadow-gray-100/50"}`}
                >
                    <div className="absolute right-0 top-0 h-20 w-20 translate-x-4 -translate-y-4 rounded-full bg-gradient-to-br from-gray-300/20 to-gray-500/20 transition-transform group-hover:scale-150" />
                    <div className="relative flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-500">Todo</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">
                                {tasks.filter((m) => m.status === "TODO").length}
                            </p>
                        </div>
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-gray-400 to-gray-600 shadow-lg shadow-gray-200">
                            <ListTodo className="h-5 w-5 text-white" />
                        </div>
                    </div>
                </button>
                <button
                    type="button"
                    onClick={() => setFilterStatus("IN_PROGRESS")}
                    className={`group relative overflow-hidden bg-white p-6 rounded-2xl border text-left transition-all hover:-translate-y-0.5 hover:shadow-lg focus:outline-none ${filterStatus === "IN_PROGRESS" ? "border-blue-300 ring-2 ring-blue-100 shadow-md shadow-blue-100/50" : "border-blue-100 hover:shadow-blue-100/50"}`}
                >
                    <div className="absolute right-0 top-0 h-20 w-20 translate-x-4 -translate-y-4 rounded-full bg-gradient-to-br from-blue-400/20 to-blue-600/20 transition-transform group-hover:scale-150" />
                    <div className="relative flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-500">In Progress</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">
                                {tasks.filter((m) => m.status === "IN_PROGRESS").length}
                            </p>
                        </div>
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg shadow-blue-200">
                            <Edit className="h-5 w-5 text-white" />
                        </div>
                    </div>
                </button>
                <button
                    type="button"
                    onClick={() => setFilterStatus("REVIEW")}
                    className={`group relative overflow-hidden bg-white p-6 rounded-2xl border text-left transition-all hover:-translate-y-0.5 hover:shadow-lg focus:outline-none ${filterStatus === "REVIEW" ? "border-orange-300 ring-2 ring-orange-100 shadow-md shadow-orange-100/50" : "border-orange-100 hover:shadow-orange-100/50"}`}
                >
                    <div className="absolute right-0 top-0 h-20 w-20 translate-x-4 -translate-y-4 rounded-full bg-gradient-to-br from-orange-400/20 to-orange-600/20 transition-transform group-hover:scale-150" />
                    <div className="relative flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-500">Review</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">
                                {tasks.filter((m) => m.status === "REVIEW").length}
                            </p>
                        </div>
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-orange-700 shadow-lg shadow-orange-200">
                            <CheckCircle className="h-5 w-5 text-white" />
                        </div>
                    </div>
                </button>
                <button
                    type="button"
                    onClick={() => setFilterStatus("overdue")}
                    className={`group relative overflow-hidden bg-white p-6 rounded-2xl border text-left transition-all hover:-translate-y-0.5 hover:shadow-lg focus:outline-none ${filterStatus === "overdue" ? "border-rose-300 ring-2 ring-rose-100 shadow-md shadow-rose-100/50" : "border-rose-100 hover:shadow-rose-100/50"}`}
                >
                    <div className="absolute right-0 top-0 h-20 w-20 translate-x-4 -translate-y-4 rounded-full bg-gradient-to-br from-rose-400/20 to-rose-600/20 transition-transform group-hover:scale-150" />
                    <div className="relative flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-500">Overdue</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">{overdueCount}</p>
                        </div>
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-rose-700 shadow-lg shadow-rose-200">
                            <AlertTriangle className="h-5 w-5 text-white" />
                        </div>
                    </div>
                </button>
                <button
                    type="button"
                    onClick={() => setFilterStatus("DONE")}
                    className={`group relative overflow-hidden bg-white p-6 rounded-2xl border text-left transition-all hover:-translate-y-0.5 hover:shadow-lg focus:outline-none ${filterStatus === "DONE" ? "border-secondary-300 ring-2 ring-secondary-100 shadow-md shadow-secondary-100/50" : "border-secondary-100 hover:shadow-secondary-100/50"}`}
                >
                    <div className="absolute right-0 top-0 h-20 w-20 translate-x-4 -translate-y-4 rounded-full bg-gradient-to-br from-secondary-400/20 to-secondary-600/20 transition-transform group-hover:scale-150" />
                    <div className="relative flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-500">Done</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">
                                {tasks.filter((m) => m.status === "DONE").length}
                            </p>
                        </div>
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-secondary-500 to-secondary-700 shadow-lg shadow-secondary-200">
                            <CheckCheck className="h-5 w-5 text-white" />
                        </div>
                    </div>
                </button>
            </div>

            {/* Filters */}
            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm mb-8">
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
                            <option value="NEEDS_APPROVAL">NEEDS_APPROVAL</option>
                            <option value="DONE">DONE</option>
                        </select>
                    </div>

                    {/* Assignee Filter */}
                    <div className="flex items-center space-x-2">
                        <User className="h-5 w-5 text-gray-400" />
                        <select
                            value={filterAssigneeId}
                            onChange={(e) => setFilterAssigneeId(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        >
                            <option value="all">All Assignee</option>
                            <option value="unassigned">Unassigned</option>
                            {assigneeFilterOptions.map((u) => (
                                <option key={u.id} value={u.id}>
                                    {u.label}
                                </option>
                            ))}
                        </select>
                    </div>

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
            {canViewRecurring && (
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
                            {recurringRules.length === 0 ? (isClientUser || !canCreate ? (
                                <div className="px-6 py-8 text-sm text-gray-500">No recurring tasks yet.</div>
                            ) :
                                <div className="px-6 py-8 text-sm text-gray-500">No recurring tasks yet. Use “Add Recurring Task” above to create one.</div>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider border-l-4 border-primary-400 first:border-l-0">Task</th>
                                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-emerald-800 uppercase tracking-wider border-l-4 border-emerald-300">Recurrence</th>
                                            {!isClientUser && <th className="px-6 py-3.5 text-left text-xs font-semibold text-amber-800 uppercase tracking-wider border-l-4 border-amber-300">Client</th>}
                                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Status</th>
                                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Assignee</th>
                                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Due Date</th>
                                            {canChangeRecurringStatus && <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Actions</th>}
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
                                                {!isClientUser && (
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
                                                )}
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`px-2 py-1 text-xs font-bold rounded-full ${r.isActive ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                                                        {r.isActive ? "Active" : "Stopped"}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                    {r.assignee ? (r.assignee.name ?? r.assignee.email) : r.assigneeId ? (assignableUsers.find((u) => u.id === r.assigneeId)?.name ?? assignableUsers.find((u) => u.id === r.assigneeId)?.email ?? "—") : "Unassigned"}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                    <div className="flex items-center">
                                                        <Calendar className="h-4 w-4 mr-1 text-gray-400" />
                                                        {format(new Date(r.nextRunAt), "MMM dd, yyyy")}
                                                    </div>
                                                </td>
                                                {canChangeRecurringStatus && (
                                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                    {(user?.role === "SUPER_ADMIN" || (r as any).createdBy?.id === user?.id) ? (
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
                                                    ) : (
                                                        <span className="text-xs text-gray-400">—</span>
                                                    )}
                                                </td>
                                                )}
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
                                onClick={() => setBulkEditOpen((prev) => !prev)}
                                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                            >
                                <Edit className="h-4 w-4" />
                                Edit
                            </button>
                            <button
                                type="button"
                                onClick={clearSelection}
                                className="text-sm text-gray-600 hover:text-gray-900"
                            >
                                Clear selection
                            </button>
                            {bulkEditOpen && !assignSelectedOpen && (
                                <div className="flex items-center gap-2 ml-2 flex-wrap">
                                    <button
                                        type="button"
                                        onClick={() => setAssignSelectedOpen(true)}
                                        className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700"
                                    >
                                        Assign
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleBulkDeleteSelected}
                                        disabled={bulkDeleting}
                                        className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                                    >
                                        {bulkDeleting ? "Deleting…" : "Delete"}
                                    </button>
                                </div>
                            )}
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
                                        Back
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
                                                checked={
                                                    paginatedDisplayedTasks.rows.filter(canBulkManageTask).length > 0 &&
                                                    paginatedDisplayedTasks.rows.filter(canBulkManageTask).every((t) => selectedTaskIds.includes(t.id))
                                                }
                                                onChange={selectAllFiltered}
                                                disabled={paginatedDisplayedTasks.rows.filter(canBulkManageTask).length === 0}
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
                                {paginatedDisplayedTasks.rows.map((task, index) => (
                                    <tr key={task.id} className={`transition-colors ${index % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-primary-50/50 ${isOverdue(task.dueDate) ? 'bg-red-50/50' : ''}`}>
                                        {canCreate && (
                                            <td className="px-4 py-4">
                                                {canBulkManageTask(task) ? (
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedTaskIds.includes(task.id)}
                                                        onChange={() => toggleTaskSelection(task.id)}
                                                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                                    />
                                                ) : (
                                                    <span className="text-xs text-gray-400">-</span>
                                                )}
                                            </td>
                                        )}
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium text-gray-900">{task.title}</span>
                                                    {(unreadCounts[task.id] ?? 0) > 0 && (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold">
                                                            <MessageSquare className="h-3 w-3" />
                                                            {unreadCounts[task.id]}
                                                        </span>
                                                    )}
                                                </div>
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
                                                    title={isClientUser ? "View task" : "Edit task"}
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </button>
                                                {canCreate && (user?.role === "SUPER_ADMIN" || task.createdBy?.id === user?.id) && (
                                                <button
                                                    className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                    onClick={() => handleDeleteTask(task.id)}
                                                    title="Delete task"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {paginatedDisplayedTasks.totalRows > 0 && (
                        <div className="border-t border-gray-200 px-6 py-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                                    <span>Rows per page</span>
                                    <select
                                        value={tasksPageSize}
                                        onChange={(e) =>
                                            setTasksPageSize(Number(e.target.value) as (typeof TASKS_PAGE_SIZES)[number])
                                        }
                                        className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                    >
                                        {TASKS_PAGE_SIZES.map((size) => (
                                            <option key={size} value={size}>
                                                {size}
                                            </option>
                                        ))}
                                    </select>
                                    <span className="text-xs text-gray-500">
                                        Showing {paginatedDisplayedTasks.from}-{paginatedDisplayedTasks.to} of {paginatedDisplayedTasks.totalRows}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setTasksPage((p) => Math.max(1, p - 1))}
                                        disabled={paginatedDisplayedTasks.page <= 1}
                                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                        Prev
                                    </button>
                                    <span className="text-sm text-gray-600">
                                        Page {paginatedDisplayedTasks.page} of {paginatedDisplayedTasks.totalPages}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setTasksPage((p) => Math.min(paginatedDisplayedTasks.totalPages, p + 1))}
                                        disabled={paginatedDisplayedTasks.page >= paginatedDisplayedTasks.totalPages}
                                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Next
                                        <ChevronRight className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
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
                setOpen={handleTaskModalOpenChange}
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
                onClose={() => setDeleteConfirm({ isOpen: false, taskId: null, taskIds: [] })}
                onConfirm={confirmDeleteTask}
                title={deleteConfirm.taskIds.length > 0 ? "Delete Tasks" : "Delete Task"}
                message={
                  deleteConfirm.taskIds.length > 0
                    ? `Are you sure you want to delete ${deleteConfirm.taskIds.length} selected tasks? This action cannot be undone and all task data will be permanently removed.`
                    : "Are you sure you want to delete this task? This action cannot be undone and all task data will be permanently removed."
                }
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
