import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
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
    CheckCircle,
    CheckCheck,
    Globe,
    Key,
    Eye,
    EyeOff,
    Clock,
    AlertTriangle,
    Calendar,
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
import { fetchTasks, patchTaskStatus, deleteTask } from "@/store/slices/taskSlice";
import { ROLE, Task } from "@/utils/types";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog";

const TasksPage = () => {
    const dispatch = useDispatch();
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<Number>(0);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [enabled, setEnabled] = useState(false);
    const [showCredentials, setShowCredentials] = useState<Record<string, boolean>>({});
    const [filterStatus, setFilterStatus] = useState<string>("all");
    const [filterClientId, setFilterClientId] = useState<string>("all");
    const [showOnboardingModal, setShowOnboardingModal] = useState(false);
    const { tasks } = useSelector((state: RootState) => state.task)
    const { user } = useSelector((state: RootState) => state.auth);

    // Only non-specialists can create
    const canCreate = (user?.role as ROLE | undefined) !== "SPECIALIST";
    const canFilterByClient = (user?.role as ROLE | undefined) !== "USER";

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

    const getOverdueCount = () => {
        return tasks.filter(task => isOverdue(task.dueDate)).length;
    };

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
        
        const matchesStatus = filterStatus === "all" || 
            (filterStatus === "overdue" && isOverdue(t.dueDate)) ||
            t.status.toLowerCase() === filterStatus.toLowerCase();

        const matchesClient =
            filterClientId === "all" || (t.client?.id ? t.client.id === filterClientId : false);
        
        return matchesSearch && matchesStatus && matchesClient;
    });

    useEffect(() => { dispatch(fetchTasks() as any); }, [dispatch]);

    return (
        <div className="p-8">
            {/* Header */}
            <div className="flex justify-between items-end mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Tasks</h1>
                    <p className="text-gray-600 mt-2">
                        Manage all tasks and assign to the specialists
                    </p>
                    {getOverdueCount() > 0 && (
                        <div className="mt-2 flex items-center text-red-600">
                            <AlertTriangle className="h-4 w-4 mr-1" />
                            <span className="text-sm font-medium">
                                {getOverdueCount()} overdue task{getOverdueCount() !== 1 ? 's' : ''}
                            </span>
                        </div>
                    )}
                </div>
                {canCreate && (
                    <div className="flex items-center space-x-3">
                        <button
                            onClick={() => setShowOnboardingModal(true)}
                            className="bg-gray-100 text-gray-700 px-4 py-3 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-2"
                        >
                            <ListTodo className="h-5 w-5" />
                            <span>Onboarding Tasks</span>
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

            {/* Task */}
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 mb-8">
                <div className="bg-white p-6 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600">Total Tasks</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {tasks.length}
                            </p>
                        </div>
                        <ListTodo className="h-8 w-8 text-primary-600" />
                    </div>
                </div>
                <div className="bg-white p-6 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600">TODO</p>
                            <p className="text-2xl font-bold text-gray-400">
                                {tasks.filter((m) => m.status === "TODO").length}
                            </p>
                        </div>
                        <ListTodo className="h-8 w-8 text-gray-400" />
                    </div>
                </div>
                <div className="bg-white p-6 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600">IN_PROGRESS</p>
                            <p className="text-2xl font-bold text-blue-400">
                                {tasks.filter((m) => m.status === "IN_PROGRESS").length}
                            </p>
                        </div>
                        <Edit className="h-8 w-8 text-blue-400" />
                    </div>
                </div>
                <div className="bg-white p-6 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600">REVIEW</p>
                            <p className="text-2xl font-bold text-orange-400">
                                {tasks.filter((m) => m.status === "REVIEW").length}
                            </p>
                        </div>
                        <CheckCircle className="h-8 w-8 text-orange-400" />
                    </div>
                </div>
                <div className="bg-white p-6 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600">DONE</p>
                            <p className="text-2xl font-bold text-secondary-600">
                                {tasks.filter((m) => m.status === "DONE").length}
                            </p>
                        </div>
                        <CheckCheck className="h-8 w-8 text-secondary-600" />
                    </div>
                </div>
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
                            <option value="overdue">Overdue</option>
                            <option value="TODO">TODO</option>
                            <option value="IN_PROGRESS">IN_PROGRESS</option>
                            <option value="REVIEW">REVIEW</option>
                            <option value="DONE">DONE</option>
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

            {/* Task View */}
            {(!enabled) ? (
                <div className="bg-white rounded-xl border border-gray-200">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Task</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assignee</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Due Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {filtered.map((task) => (
                                    <tr key={task.id} className={`hover:bg-gray-50 ${isOverdue(task.dueDate) ? 'bg-red-50' : ''}`}>
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
                                                                href={item.value}
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
                                            <div className="flex items-center space-x-2">
                                                <button
                                                    className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                                                    onClick={() => handleEditClick(task)}
                                                    title="Edit task"
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </button>
                                                <button
                                                    className="p-1 text-gray-400 hover:text-red-600 transition-colors"
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
                    tasks={filtered}
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
        </div>
    );
};

export default TasksPage;
