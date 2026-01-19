import { createTask, updateTask, ProofItem, fetchTasks } from "@/store/slices/taskSlice";
import { Task, TaskStatus } from "@/utils/types";
import React, { useState, useEffect } from "react";
import DatePicker from "react-datepicker";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { Upload, X, Image, Video, Link as LinkIcon, Plus, Trash2, Send } from "lucide-react";
import api from "@/lib/api";
import { fetchClients, Client } from "@/store/slices/clientSlice";
import toast from "react-hot-toast";
import ConfirmDialog from "@/components/ConfirmDialog";

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
    const { user } = useSelector((state: RootState) => state.auth);
    const [workers, setWorkers] = useState<Array<{ id: string; name: string; email: string }>>([]);
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
        if (open) {
            // Fetch clients if not already loaded
            if (clients.length === 0) {
                dispatch(fetchClients() as any);
            }
            // Fetch workers
            fetchWorkers();
        }
    }, [open]);

    const fetchWorkers = async () => {
        try {
            const response = await api.get("/auth/workers");
            setWorkers(response.data);
        } catch (error) {
            console.error("Error fetching workers:", error);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setUploading(true);
        try {
            const formData = new FormData();
            for (let i = 0; i < files.length; i++) {
                formData.append("files", files[i]);
            }

            // Content-Type will be set automatically by browser for FormData
            const response = await api.post("/upload/multiple", formData);
            
            // Ensure response data is an array
            const uploadedFiles = Array.isArray(response.data) ? response.data : [response.data];

            setProof((prev) => [...prev, ...uploadedFiles]);
            toast.success("Files uploaded successfully!");
        } catch (error: any) {
            console.error("Upload error:", error);
            // Toast is already shown by API interceptor
        } finally {
            setUploading(false);
            e.target.value = ""; // Reset input
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
            proof: proof.length > 0 ? proof : undefined,
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
                setForm({
                    title: task.title ?? "",
                    description: task.description ?? "",
                    category: task.category ?? "",
                    status: task.status,
                    dueDate: task.dueDate ? new Date(task.dueDate) : null,
                    assigneeId: task.assignee?.id ?? "",
                    clientId: task.client?.id ?? "",
                    priority: (task as any).priority ?? "",
                    estimatedHours: (task as any).estimatedHours?.toString() ?? "",
                });
                setProof((task.proof as ProofItem[]) || []);
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
            }
            setUrlInput("");
            setUrlType("url");
        }
    }, [open, mode, task]);

    const canComment = Boolean(user) && user?.role !== "CLIENT";

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
        <div className="fixed inset-0 z-50 bg-black/50 overflow-y-auto">
            <div className="min-h-full flex items-center justify-center p-4">
                <div className="bg-white w-full max-w-3xl rounded-xl border border-gray-200 shadow-lg max-h-[calc(100vh-2rem)] flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                        <h2 className="text-lg sm:text-xl font-bold text-gray-900">{title}</h2>
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                            aria-label="Close"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto px-5 py-4">
                        <form onSubmit={handleSubmit} className="space-y-4">
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

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Assignee</label>
                            <select
                                value={form.assigneeId}
                                onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            >
                                <option value="">Unassigned</option>
                                {workers.map((worker) => (
                                    <option key={worker.id} value={worker.id}>
                                        {worker.name || worker.email}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Client</label>
                        <select
                            value={form.clientId}
                            onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        >
                            <option value="">No client</option>
                            {clients.map((client) => (
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

                    {/* Proof/Attachments Section */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Proof / Attachments
                        </label>
                        
                        {/* File Upload */}
                        <div className="mb-4">
                            <label className="flex items-center justify-center w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-500 transition-colors">
                                <div className="flex flex-col items-center">
                                    <Upload className="h-6 w-6 text-gray-400 mb-2" />
                                    <span className="text-sm text-gray-600">
                                        {uploading ? "Uploading..." : "Click to upload images or videos"}
                                    </span>
                                    <span className="text-xs text-gray-500 mt-1">
                                        PNG, JPG, GIF, MP4, WebM (max 50MB)
                                    </span>
                                </div>
                                <input
                                    type="file"
                                    className="hidden"
                                    accept="image/*,video/*"
                                    multiple
                                    onChange={handleFileUpload}
                                    disabled={uploading}
                                />
                            </label>
                        </div>

                        {/* URL Input */}
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
                                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center justify-center space-x-1 sm:w-auto"
                            >
                                <Plus className="h-4 w-4" />
                                <span>Add</span>
                            </button>
                        </div>

                        {/* Proof Items Display */}
                        {proof.length > 0 && (
                            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                {proof.map((item, index) => (
                                    <div
                                        key={index}
                                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                                    >
                                        <div className="flex items-center space-x-3 flex-1 min-w-0">
                                            {item.type === "image" && <Image className="h-5 w-5 text-blue-600 flex-shrink-0" />}
                                            {item.type === "video" && <Video className="h-5 w-5 text-purple-600 flex-shrink-0" />}
                                            {item.type === "url" && <LinkIcon className="h-5 w-5 text-green-600 flex-shrink-0" />}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium text-gray-900 truncate">
                                                    {item.name || item.value}
                                                </div>
                                                <div className="text-xs text-gray-500 truncate">{item.value}</div>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveProof(index)}
                                            className="ml-2 p-1 text-red-600 hover:text-red-800 transition-colors flex-shrink-0"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Comments Section */}
                    <div className="pt-2">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-gray-900">Comments</h3>
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
                        <div className="sticky bottom-0 bg-white pt-4 pb-1">
                            <div className="flex flex-col sm:flex-row gap-3">
                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    className="w-full sm:flex-1 bg-gray-100 text-gray-800 py-3 px-6 rounded-lg hover:bg-gray-200 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="w-full sm:flex-1 bg-primary-600 text-white py-3 px-6 rounded-lg hover:bg-primary-700 transition-colors"
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
