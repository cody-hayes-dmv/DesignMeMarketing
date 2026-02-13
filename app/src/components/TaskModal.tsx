import { createTask, updateTask, ProofItem, fetchTasks } from "@/store/slices/taskSlice";
import { Task, TaskStatus } from "@/utils/types";
import React, { useState, useEffect, useMemo } from "react";
import DatePicker from "react-datepicker";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { Upload, X, Image, Video, Link as LinkIcon, Plus, Trash2, Send, Loader2, Download, CheckSquare } from "lucide-react";
import api from "@/lib/api";
import { fetchClients, Client } from "@/store/slices/clientSlice";
import toast from "react-hot-toast";
import ConfirmDialog from "@/components/ConfirmDialog";

function getUploadFileUrl(url: string | undefined): string {
    if (!url || typeof url !== "string") return url || "#";
    const match = url.match(/\/uploads\/([^/?]+)/);
    if (!match) return url;
    const filename = match[1];
    const apiBase = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "");
    if (!apiBase) return url;
    try {
        const base = new URL(apiBase);
        return `${base.origin}/api/upload/${encodeURIComponent(filename)}`;
    } catch {
        return url;
    }
}

interface TaskModalProps {
    title: string;
    open: boolean;
    setOpen: (value: boolean) => void;
    mode: Number;
    task?: Task;
}

type TaskComment = {
    id: string;
    body: string;
    createdAt: string;
    updatedAt: string;
    author: { id: string; name: string | null; email: string };
};

const TaskModal: React.FC<TaskModalProps> = ({ open, setOpen, title, mode, task }) => {
    const dispatch = useDispatch();
    const { clients } = useSelector((state: RootState) => state.client);
    const sortedClients = useMemo(
        () =>
            [...clients].sort((a, b) =>
                (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
            ),
        [clients]
    );
    const { user } = useSelector((state: RootState) => state.auth);
    const isSpecialistView = user?.role === "SPECIALIST";
    const [assignableUsers, setAssignableUsers] = useState<Array<{ id: string; name: string | null; email: string; role: string }>>([]);
    const [assignableLoading, setAssignableLoading] = useState(false);
    const [assignableSearch, setAssignableSearch] = useState("");
    const [assignToOpen, setAssignToOpen] = useState(false);
    const [assigneeDisplay, setAssigneeDisplay] = useState("");
    const assignToRef = React.useRef<HTMLDivElement>(null);
    const [form, setForm] = useState({
        title: "",
        description: "",
        category: "",
        status: "TODO" as TaskStatus,
        dueDate: null as Date | null,
        assigneeId: "",
        clientId: "",
        priority: "",
        estimatedHours: "",
    });
    const [proof, setProof] = useState<ProofItem[]>([]);
    const [uploading, setUploading] = useState(false);
    const [urlInput, setUrlInput] = useState("");
    const [urlType, setUrlType] = useState<"image" | "video" | "url">("url");
    const [comments, setComments] = useState<TaskComment[]>([]);
    const [commentsLoading, setCommentsLoading] = useState(false);
    const [commentsError, setCommentsError] = useState<string | null>(null);
    const [newComment, setNewComment] = useState("");
    const [postingComment, setPostingComment] = useState(false);
    const [commentDeleteConfirm, setCommentDeleteConfirm] = useState<{ isOpen: boolean; commentId: string | null }>({
        isOpen: false,
        commentId: null,
    });

    useEffect(() => {
        if (open && clients.length === 0) {
            dispatch(fetchClients() as any);
        }
    }, [open, clients.length, dispatch]);

    // Fetch assignable users (Super Admin, Admin, Specialist) when modal is open
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setAssignableLoading(true);
        const q = assignableSearch.trim();
        api.get("/tasks/assignable-users", { params: q ? { search: q } : {} })
            .then((res) => {
                if (!cancelled && Array.isArray(res.data)) setAssignableUsers(res.data);
            })
            .catch(() => {
                if (!cancelled) setAssignableUsers([]);
            })
            .finally(() => {
                if (!cancelled) setAssignableLoading(false);
            });
        return () => { cancelled = true; };
    }, [open, assignableSearch]);

    // Close Assign to dropdown on outside click
    useEffect(() => {
        if (!assignToOpen) return;
        const onDocClick = (e: MouseEvent) => {
            if (assignToRef.current && !assignToRef.current.contains(e.target as Node)) setAssignToOpen(false);
        };
        document.addEventListener("click", onDocClick);
        return () => document.removeEventListener("click", onDocClick);
    }, [assignToOpen]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setUploading(true);
        try {
            const formData = new FormData();
            for (let i = 0; i < files.length; i++) {
                formData.append("files", files[i]);
            }
            const response = await api.post("/upload/worklog", formData);
            const uploadedFiles = Array.isArray(response.data) ? response.data : [response.data];
            const items: ProofItem[] = (uploadedFiles as { type?: string; value: string; name?: string }[])
                .filter((raw) => raw && typeof raw.value === "string")
                .map((raw) => ({ type: (raw.type as "image" | "video" | "url") || "url", value: raw.value, name: raw.name }));

            if (items.length > 0) {
                setProof((prev) => [...prev, ...items]);
                toast.success(items.length === 1 ? "File uploaded successfully!" : "Files uploaded successfully!");
            }
        } catch (error: any) {
            console.error("Upload error:", error);
        } finally {
            setUploading(false);
            e.target.value = "";
        }
    };

    const handleAddUrl = () => {
        if (!urlInput.trim()) return;

        // Validate URL
        try {
            new URL(urlInput);
            setProof((prev) => [
                ...prev,
                {
                    type: urlType,
                    value: urlInput.trim(),
                    name: urlInput.trim(),
                },
            ]);
            setUrlInput("");
            toast.success("URL added successfully!");
        } catch {
            toast.error("Please enter a valid URL");
        }
    };

    const handleRemoveProof = (index: number) => {
        setProof((prev) => prev.filter((_, i) => i !== index));
    };

    const handleSubmit: React.FormEventHandler = async (e) => {
        e.preventDefault();

        const payload = {
            title: form.title.trim(),
            description: form.description || undefined,
            category: form.category || undefined,
            status: form.status,
            dueDate: form.dueDate ? form.dueDate.toISOString() : undefined,
            assigneeId: form.assigneeId || undefined,
            clientId: form.clientId || undefined,
            priority: form.priority || undefined,
            estimatedHours: form.estimatedHours ? parseInt(form.estimatedHours) : undefined,
            // Always send current proof so removals are saved (empty array clears proof on server)
            proof: proof.length > 0 ? proof : [],
        };

        try {
            if (mode === 0) {
                await dispatch(createTask(payload) as any);
            } else if (mode === 1 && task) {
                await dispatch(updateTask({ id: task.id, ...payload }) as any);
            }

            // Refresh tasks list
            dispatch(fetchTasks() as any);
            toast.success(mode === 0 ? "Task created successfully!" : "Task updated successfully!");
            setOpen(false);
        } catch (error: any) {
            console.error("Failed to save task:", error);
            // Toast is already shown by API interceptor
        }
    };

    const handleCancel = () => setOpen(false);

    React.useEffect(() => {
        if (open) {
            if (mode === 1 && task) {
                const assignee = task.assignee;
                setForm({
                    title: task.title ?? "",
                    description: task.description ?? "",
                    category: task.category ?? "",
                    status: task.status,
                    dueDate: task.dueDate ? new Date(task.dueDate) : null,
                    assigneeId: assignee?.id ?? "",
                    clientId: task.client?.id ?? "",
                    priority: (task as any).priority ?? "",
                    estimatedHours: (task as any).estimatedHours?.toString() ?? "",
                });
                setAssigneeDisplay(assignee ? (assignee.name || assignee.email || "") : "");
                setAssignableSearch("");
                setAssignToOpen(false);
                setProof((() => {
                    const p = task.proof;
                    if (Array.isArray(p)) return p as ProofItem[];
                    if (typeof p === "string") {
                        try {
                            const parsed = JSON.parse(p);
                            return Array.isArray(parsed) ? (parsed as ProofItem[]) : [];
                        } catch {
                            return [];
                        }
                    }
                    return [];
                })());
            } else {
                setForm({
                    title: "",
                    description: "",
                    category: "",
                    status: "TODO",
                    dueDate: null,
                    assigneeId: "",
                    clientId: "",
                    priority: "",
                    estimatedHours: "",
                });
                setProof([]);
                setAssigneeDisplay("");
                setAssignableSearch("");
                setAssignToOpen(false);
            }
            setUrlInput("");
            setUrlType("url");
        }
    }, [open, mode, task]);

    const canComment = Boolean(user) && user?.role !== "USER";

    const fetchComments = async (taskId: string) => {
        try {
            setCommentsLoading(true);
            const res = await api.get(`/tasks/${taskId}/comments`, { timeout: 30000 });
            setComments(Array.isArray(res.data) ? (res.data as TaskComment[]) : []);
            setCommentsError(null);
        } catch (e: any) {
            console.error("Failed to fetch task comments", e);
            setComments([]);
            setCommentsError(e?.response?.data?.message || "Failed to load comments");
        } finally {
            setCommentsLoading(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        if (mode !== 1 || !task?.id) {
            setComments([]);
            setCommentsError(null);
            setNewComment("");
            return;
        }
        void fetchComments(task.id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, mode, task?.id]);

    const handlePostComment = async () => {
        if (!task?.id) return;
        const body = newComment.trim();
        if (!body) return;
        try {
            setPostingComment(true);
            const res = await api.post(`/tasks/${task.id}/comments`, { body }, { timeout: 30000 });
            const created = res.data as TaskComment;
            setComments((prev) => [...prev, created]);
            setNewComment("");
            setCommentsError(null);
        } catch (e: any) {
            console.error("Failed to post comment", e);
            toast.error(e?.response?.data?.message || "Failed to post comment");
        } finally {
            setPostingComment(false);
        }
    };

    const requestDeleteComment = (commentId: string) => {
        setCommentDeleteConfirm({ isOpen: true, commentId });
    };

    const confirmDeleteComment = async () => {
        if (!task?.id || !commentDeleteConfirm.commentId) return;
        const commentId = commentDeleteConfirm.commentId;
        try {
            await api.delete(`/tasks/${task.id}/comments/${commentId}`, { timeout: 30000 });
            setComments((prev) => prev.filter((c) => c.id !== commentId));
            setCommentDeleteConfirm({ isOpen: false, commentId: null });
        } catch (e: any) {
            console.error("Failed to delete comment", e);
            toast.error(e?.response?.data?.message || "Failed to delete comment");
            setCommentDeleteConfirm({ isOpen: false, commentId: null });
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm overflow-y-auto">
            <div className="min-h-full flex items-center justify-center p-4">
                <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl ring-1 ring-gray-200/80 max-h-[calc(100vh-2rem)] flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-5 bg-gradient-to-r from-primary-600 via-primary-500 to-blue-600 text-white rounded-t-2xl">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20">
                                <CheckSquare className="h-5 w-5" />
                            </div>
                            <h2 className="text-lg sm:text-xl font-bold">{title}</h2>
                        </div>
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors"
                            aria-label="Close"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto px-5 py-4 bg-gray-50/50">
                        <form onSubmit={handleSubmit} className="space-y-5">
                    <section className="rounded-xl border-l-4 border-blue-500 bg-blue-50/50 p-4 sm:p-5">
                        <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            Task Details
                        </h3>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
                        <input
                            type="text"
                            value={form.title}
                            onChange={(e) => setForm({ ...form, title: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                        <textarea
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            rows={3}
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                            <input
                                type="text"
                                value={form.category}
                                onChange={(e) => setForm({ ...form, category: e.target.value })}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                placeholder="e.g. On-Page SEO, Link Building"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                            <select
                                value={form.status}
                                onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}
                                className="border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            >
                                <option value="TODO">TODO</option>
                                <option value="IN_PROGRESS">IN_PROGRESS</option>
                                <option value="REVIEW">REVIEW</option>
                                <option value="DONE">DONE</option>
                            </select>
                        </div>
                    </div>
                    </section>
                    <section className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/50 p-4 sm:p-5">
                        <h3 className="text-sm font-semibold text-emerald-900 mb-3 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Schedule & Assign
                        </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Due Date</label>
                            <DatePicker
                                selected={form.dueDate}
                                onChange={(date) => date && setForm({ ...form, dueDate: date })}
                                minDate={new Date()}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                placeholderText="Select date"
                            />
                        </div>

                        <div ref={assignToRef} className="relative">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Assign to</label>
                            <div className="flex items-stretch gap-2">
                                <input
                                    type="text"
                                    value={form.assigneeId ? assigneeDisplay : assignableSearch}
                                    onChange={(e) => {
                                        setAssignableSearch(e.target.value);
                                        setAssignToOpen(true);
                                        if (form.assigneeId && e.target.value !== assigneeDisplay) {
                                            setForm((p) => ({ ...p, assigneeId: "" }));
                                            setAssigneeDisplay("");
                                        }
                                    }}
                                    onFocus={() => setAssignToOpen(true)}
                                    placeholder="Search by name or email (Super Admin, Admin, Specialist)"
                                    className="flex-1 border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                />
                                {form.assigneeId && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setForm((p) => ({ ...p, assigneeId: "" }));
                                            setAssigneeDisplay("");
                                            setAssignableSearch("");
                                            setAssignToOpen(true);
                                        }}
                                        className="shrink-0 px-3 py-3 text-sm text-gray-500 hover:text-gray-700 rounded-lg border border-transparent hover:bg-gray-100"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                            {assignToOpen && (
                                <ul className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1">
                                    {assignableLoading ? (
                                        <li className="px-3 py-2 text-sm text-gray-500">Loading…</li>
                                    ) : assignableUsers.length === 0 ? (
                                        <li className="px-3 py-2 text-sm text-gray-500">No users found. Try a different search.</li>
                                    ) : (
                                        assignableUsers.map((u) => (
                                            <li key={u.id}>
                                                <button
                                                    type="button"
                                                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 flex items-center justify-between"
                                                    onClick={() => {
                                                        setForm((p) => ({ ...p, assigneeId: u.id }));
                                                        setAssigneeDisplay(u.name || u.email);
                                                        setAssignableSearch("");
                                                        setAssignToOpen(false);
                                                    }}
                                                >
                                                    <span>{u.name || u.email}</span>
                                                    <span className="text-xs text-gray-500 ml-2">{u.role.replace("_", " ")}</span>
                                                </button>
                                            </li>
                                        ))
                                    )}
                                </ul>
                            )}
                        </div>
                    </div>
                    </section>
                    <section className="rounded-xl border-l-4 border-amber-500 bg-amber-50/50 p-4 sm:p-5">
                        <h3 className="text-sm font-semibold text-amber-900 mb-3 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            Client & Priority
                        </h3>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Client</label>
                        <select
                            value={form.clientId}
                            onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        >
                            <option value="">No client</option>
                            {sortedClients.map((client) => (
                                <option key={client.id} value={client.id}>
                                    {client.name} ({client.domain})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
                            <select
                                value={form.priority}
                                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            >
                                <option value="">None</option>
                                <option value="high">High</option>
                                <option value="medium">Medium</option>
                                <option value="low">Low</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Estimated Hours</label>
                            <input
                                type="number"
                                value={form.estimatedHours}
                                onChange={(e) => setForm({ ...form, estimatedHours: e.target.value })}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                placeholder="(optional)"
                                min="0"
                            />
                        </div>
                    </div>
                    </section>
                    {/* Proof/Attachments Section (same as Work Log) */}
                    <section className="rounded-xl border-l-4 border-violet-500 bg-violet-50/50 p-4 sm:p-5">
                        <h3 className="text-sm font-semibold text-violet-900 mb-3 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                            Proof / Attachments
                        </h3>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Proof / Attachments</label>
                        {!isSpecialistView && (
                            <>
                                <input
                                    id="task-proof-file-input"
                                    type="file"
                                    multiple
                                    accept=".pdf,.doc,.docx,.xls,.xlsx,image/*,video/*,.txt,.csv"
                                    className="sr-only"
                                    aria-label="Upload task attachment"
                                    onChange={handleFileUpload}
                                />
                                <div className="mb-4">
                                    <label
                                        htmlFor="task-proof-file-input"
                                        className="flex items-center justify-center w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-500 transition-colors"
                                    >
                                        <div className="flex flex-col items-center">
                                            {uploading ? (
                                                <Loader2 className="h-6 w-6 text-gray-400 mb-2 animate-spin" />
                                            ) : (
                                                <Upload className="h-6 w-6 text-gray-400 mb-2" />
                                            )}
                                            <span className="text-sm text-gray-600">
                                                {uploading ? "Uploading…" : "Click to upload files (PDF, Word, Excel, images, etc.)"}
                                            </span>
                                            <span className="text-xs text-gray-500 mt-1">max 25MB per file</span>
                                        </div>
                                    </label>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2 mb-4">
                                    <select
                                        value={urlType}
                                        onChange={(e) => setUrlType(e.target.value as "image" | "video" | "url")}
                                        className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent sm:w-40"
                                    >
                                        <option value="url">URL</option>
                                        <option value="image">Image URL</option>
                                        <option value="video">Video URL</option>
                                    </select>
                                    <input
                                        type="url"
                                        value={urlInput}
                                        onChange={(e) => setUrlInput(e.target.value)}
                                        placeholder="Enter URL (e.g., https://example.com/image.png)"
                                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddUrl}
                                        className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center justify-center gap-1 sm:w-auto"
                                    >
                                        <Plus className="h-4 w-4" />
                                        <span>Add</span>
                                    </button>
                                </div>
                            </>
                        )}
                        {proof.length > 0 ? (
                            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                {proof.map((item, index) => (
                                    <div
                                        key={index}
                                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                                    >
                                        <div className="flex items-center space-x-3 flex-1 min-w-0">
                                            {item.type === "image" && <Image className="h-5 w-5 text-blue-600 flex-shrink-0" />}
                                            {item.type === "video" && <Video className="h-5 w-5 text-purple-600 flex-shrink-0" />}
                                            {(item.type === "url" || !item.type) && <LinkIcon className="h-5 w-5 text-green-600 flex-shrink-0" />}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium text-gray-900 truncate">
                                                    {item.name || item.value || "Attachment"}
                                                </div>
                                                <a
                                                    href={getUploadFileUrl(item.value)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    download={isSpecialistView ? (item.name || "attachment") : undefined}
                                                    className="text-xs text-primary-600 hover:text-primary-800 truncate block inline-flex items-center gap-1"
                                                >
                                                    {isSpecialistView && <Download className="h-3.5 w-3.5 flex-shrink-0" />}
                                                    {item.name || item.value}
                                                </a>
                                            </div>
                                        </div>
                                        {!isSpecialistView && (
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveProof(index)}
                                                className="ml-2 p-1 text-red-600 hover:text-red-800 flex-shrink-0"
                                                title="Remove"
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500">No attachments</p>
                        )}
                    </div>
                    </section>
                    {/* Comments Section */}
                    <div className="rounded-xl border-l-4 border-teal-500 bg-teal-50/50 p-4 sm:p-5">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-teal-900 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                                Comments
                            </h3>
                            {mode === 1 && task?.id && (
                                <button
                                    type="button"
                                    onClick={() => void fetchComments(task.id)}
                                    className="text-xs text-gray-500 hover:text-gray-700"
                                >
                                    Refresh
                                </button>
                            )}
                        </div>

                        {mode !== 1 || !task?.id ? (
                            <p className="mt-2 text-sm text-gray-500">Save the task to start a comment thread.</p>
                        ) : (
                            <div className="mt-3 rounded-lg border border-gray-200">
                                <div className="max-h-64 overflow-y-auto p-3 space-y-3">
                                    {commentsLoading ? (
                                        <p className="text-sm text-gray-500">Loading comments...</p>
                                    ) : commentsError ? (
                                        <p className="text-sm text-rose-600">{commentsError}</p>
                                    ) : comments.length === 0 ? (
                                        <p className="text-sm text-gray-500">No comments yet.</p>
                                    ) : (
                                        comments.map((c) => {
                                            const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
                                            const isAuthor = user?.id && c.author?.id === user.id;
                                            const canDelete = canComment && (isAdmin || isAuthor);
                                            const when = (() => {
                                                try {
                                                    return new Date(c.createdAt).toLocaleString();
                                                } catch {
                                                    return "";
                                                }
                                            })();
                                            return (
                                                <div key={c.id} className="flex gap-3">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-medium text-gray-900 truncate">
                                                                    {c.author?.name || c.author?.email || "Unknown"}
                                                                </p>
                                                                <p className="text-xs text-gray-500">{when}</p>
                                                            </div>
                                                            {canDelete && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => requestDeleteComment(c.id)}
                                                                    className="p-1 text-red-600 hover:text-red-800"
                                                                    title="Delete comment"
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </button>
                                                            )}
                                                        </div>
                                                        <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap break-words">
                                                            {c.body}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>

                                <div className="border-t border-gray-200 p-3">
                                    {!canComment ? (
                                        <p className="text-sm text-gray-500">Comments are not available for this role.</p>
                                    ) : (
                                        <div className="flex flex-col sm:flex-row gap-2">
                                            <textarea
                                                value={newComment}
                                                onChange={(e) => setNewComment(e.target.value)}
                                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                                rows={2}
                                                placeholder="Write a comment..."
                                            />
                                            <button
                                                type="button"
                                                disabled={postingComment || newComment.trim().length === 0}
                                                onClick={() => void handlePostComment()}
                                                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
                                            >
                                                <Send className="h-4 w-4" />
                                                Post
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                        {/* Footer */}
                        <div className="sticky bottom-0 bg-gray-100/80 pt-4 pb-1 -mx-5 -mb-4 px-5 py-4 rounded-b-2xl">
                            <div className="flex flex-col sm:flex-row gap-3">
                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    className="w-full sm:flex-1 border border-gray-300 bg-white text-gray-700 py-3 px-6 rounded-xl hover:bg-gray-50 font-medium transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="w-full sm:flex-1 py-3 px-6 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-md hover:shadow-lg transition-all"
                                >
                                    {mode === 0 ? "Create" : "Save"}
                                </button>
                            </div>
                        </div>
                        </form>
                    </div>
                </div>
            </div>

            <ConfirmDialog
                isOpen={commentDeleteConfirm.isOpen}
                onClose={() => setCommentDeleteConfirm({ isOpen: false, commentId: null })}
                onConfirm={() => void confirmDeleteComment()}
                title="Delete comment"
                message="Are you sure you want to delete this comment? This action cannot be undone."
                confirmText="Delete"
                cancelText="Cancel"
                variant="danger"
            />
        </div>
    );
};

export default TaskModal;
