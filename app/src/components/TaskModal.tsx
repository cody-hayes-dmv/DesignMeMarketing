import { createTask, updateTask, patchTaskStatus, ProofItem, fetchTasks } from "@/store/slices/taskSlice";
import { Task, TaskStatus } from "@/utils/types";
import React, { useState, useEffect, useMemo } from "react";
import DatePicker from "react-datepicker";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { Upload, X, Image, Video, Link as LinkIcon, Plus, Trash2, Send, Loader2, Download, CheckSquare, MessageSquare, HelpCircle, CheckCircle2, RotateCcw, ThumbsUp } from "lucide-react";
import api, { getUploadFileUrl } from "@/lib/api";
import { fetchClients } from "@/store/slices/clientSlice";
import toast from "react-hot-toast";
import ConfirmDialog from "@/components/ConfirmDialog";

interface TaskModalProps {
    title: string;
    open: boolean;
    setOpen: (value: boolean) => void;
    mode: Number;
    task?: Task;
}

type ActivityType = "COMMENT" | "QUESTION" | "APPROVAL_REQUEST" | "APPROVAL" | "REVISION_REQUEST";

type TaskComment = {
    id: string;
    body: string;
    type: ActivityType;
    createdAt: string;
    updatedAt: string;
    author: { id: string; name: string | null; email: string; role?: string };
};

type MentionRange = { start: number; end: number };
type CollaboratorMember = { id: string; name: string | null; email: string; role: string | null };

const activityConfig: Record<ActivityType, { icon: React.ReactNode; label: string; color: string; bgColor: string; borderColor: string }> = {
    COMMENT: {
        icon: <MessageSquare className="h-4 w-4" />,
        label: "Comment",
        color: "text-gray-600",
        bgColor: "bg-gray-50",
        borderColor: "border-gray-200",
    },
    QUESTION: {
        icon: <HelpCircle className="h-4 w-4" />,
        label: "Question",
        color: "text-amber-600",
        bgColor: "bg-amber-50",
        borderColor: "border-amber-200",
    },
    APPROVAL_REQUEST: {
        icon: <ThumbsUp className="h-4 w-4" />,
        label: "Approval Request",
        color: "text-blue-600",
        bgColor: "bg-blue-50",
        borderColor: "border-blue-200",
    },
    APPROVAL: {
        icon: <CheckCircle2 className="h-4 w-4" />,
        label: "Approved",
        color: "text-green-600",
        bgColor: "bg-green-50",
        borderColor: "border-green-200",
    },
    REVISION_REQUEST: {
        icon: <RotateCcw className="h-4 w-4" />,
        label: "Revisions Requested",
        color: "text-rose-600",
        bgColor: "bg-rose-50",
        borderColor: "border-rose-200",
    },
};

const normalizeUrlInput = (value: string): string => {
    const raw = value.trim();
    if (!raw) throw new Error("Invalid URL");
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(candidate).toString();
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
    const isClientUser = user?.role === "USER";
    const isAgencyViewingNonAgencyTask =
        user?.role === "AGENCY" &&
        Number(mode) === 1 &&
        task?.createdBy?.role !== "AGENCY";
    const isNotOwner =
        (user?.role === "ADMIN" && Number(mode) === 1 && task?.createdBy?.id !== user?.id) ||
        isAgencyViewingNonAgencyTask;
    const isAdminAssigneeStatusEditor =
        user?.role === "ADMIN" &&
        Number(mode) === 1 &&
        task?.createdBy?.id !== user?.id &&
        task?.assignee?.id === user?.id;
    const formReadOnly = isSpecialistView || isClientUser || isNotOwner;
    const canEditStatus =
        !isClientUser && (!formReadOnly || isSpecialistView || isAdminAssigneeStatusEditor);
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
    const [commentType, setCommentType] = useState<ActivityType>("COMMENT");
    const [commentMentionRange, setCommentMentionRange] = useState<MentionRange | null>(null);
    const [commentMentionQuery, setCommentMentionQuery] = useState("");
    const [commentMentionActiveIndex, setCommentMentionActiveIndex] = useState(0);
    const [commentMentionedUserIds, setCommentMentionedUserIds] = useState<string[]>([]);
    const [collaboratorEditorOpen, setCollaboratorEditorOpen] = useState(false);
    const [collaboratorSearch, setCollaboratorSearch] = useState("");
    const [manualCollaboratorIds, setManualCollaboratorIds] = useState<string[]>([]);
    const [removedCollaboratorIds, setRemovedCollaboratorIds] = useState<string[]>([]);
    const [approving, setApproving] = useState(false);
    const [requestingRevisions, setRequestingRevisions] = useState(false);
    const [revisionComment, setRevisionComment] = useState("");
    const [showRevisionInput, setShowRevisionInput] = useState(false);
    const commentInputRef = React.useRef<HTMLTextAreaElement>(null);

    const hydrateFromTask = React.useCallback((taskData: Task) => {
        const assignee = taskData.assignee;
        setForm({
            title: taskData.title ?? "",
            description: taskData.description ?? "",
            category: taskData.category ?? "",
            status: taskData.status,
            dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
            assigneeId: assignee?.id ?? "",
            clientId: taskData.client?.id ?? "",
            priority: (taskData as any).priority ?? "",
            estimatedHours: (taskData as any).estimatedHours?.toString() ?? "",
        });
        setAssigneeDisplay(assignee ? (assignee.name || assignee.email || "") : "");
        setAssignableSearch("");
        setAssignToOpen(false);
        setProof((() => {
            const p = taskData.proof;
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
    }, []);

    useEffect(() => {
        if (open && clients.length === 0 && user?.role !== "USER" && user?.role !== "SPECIALIST") {
            dispatch(fetchClients() as any);
        }
    }, [open, clients.length, dispatch, user?.role]);

    // Fetch assignable users (Super Admin, Admin, Specialist) when modal is open
    useEffect(() => {
        if (!open || user?.role === "USER" || user?.role === "SPECIALIST") return;
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

        try {
            const normalizedUrl = normalizeUrlInput(urlInput);
            setProof((prev) => [
                ...prev,
                {
                    type: urlType,
                    value: normalizedUrl,
                    name: normalizedUrl,
                },
            ]);
            setUrlInput("");
            toast.success("URL added successfully!");
        } catch {
            toast.error("Please enter a valid URL (e.g. www.example.com or https://example.com)");
        }
    };

    const handleRemoveProof = (index: number) => {
        setProof((prev) => prev.filter((_, i) => i !== index));
    };

    const handleSubmit: React.FormEventHandler = async (e) => {
        e.preventDefault();

        try {
            if (mode === 0) {
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
                    proof: proof.length > 0 ? proof : [],
                };
                await dispatch(createTask(payload) as any);
                toast.success("Task created successfully!");
            } else if (mode === 1 && task) {
                if (isSpecialistView || isAdminAssigneeStatusEditor) {
                    await dispatch(patchTaskStatus({ id: task.id, status: form.status }) as any);
                    toast.success("Status updated successfully!");
                } else {
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
                        proof: proof.length > 0 ? proof : [],
                    };
                    await dispatch(updateTask({ id: task.id, ...payload }) as any);
                    toast.success("Task updated successfully!");
                }
            }

            dispatch(fetchTasks() as any);
            setOpen(false);
        } catch (error: any) {
            console.error("Failed to save task:", error);
        }
    };

    const handleCancel = () => setOpen(false);

    React.useEffect(() => {
        if (open) {
            if (mode === 1 && task) {
                hydrateFromTask(task);
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
            setCommentType("COMMENT");
            setShowRevisionInput(false);
            setRevisionComment("");
        }
    }, [open, mode, task, hydrateFromTask]);

    // Force-load the latest task payload when opening an existing task.
    // This ensures notification deep-links always show server-fresh status/content.
    useEffect(() => {
        if (!open || mode !== 1 || !task?.id) return;
        let cancelled = false;
        api.get(`/tasks/${task.id}`, {
            _silent: true,
            params: { _ts: Date.now() },
        } as any)
            .then((res) => {
                if (cancelled) return;
                if (res?.data?.id) hydrateFromTask(res.data as Task);
            })
            .catch(() => {
                // Keep current task data if refresh fails.
            });
        return () => {
            cancelled = true;
        };
    }, [open, mode, task?.id, hydrateFromTask]);

    const canComment = Boolean(user);
    const canApprove = isClientUser && task?.status === "NEEDS_APPROVAL";
    const availableCommentTypes: ActivityType[] = ["COMMENT"];

    const buildCommentMentionToken = React.useCallback((member: { id: string; name: string | null; email: string }) => {
        const rawHandle = (member.name || member.email || "").trim();
        return (rawHandle
            .replace(/\s+/g, "_")
            .replace(/[^A-Za-z0-9._-]/g, "") || "user").toLowerCase();
    }, []);

    const collaboratorPool = useMemo(() => {
        const byId = new Map<string, CollaboratorMember>();
        const add = (member: CollaboratorMember | null | undefined) => {
            if (!member?.id || !member.email) return;
            if (!byId.has(member.id)) byId.set(member.id, member);
        };

        assignableUsers.forEach((u) => add({ id: u.id, name: u.name ?? null, email: u.email, role: u.role ?? null }));
        if (task?.createdBy?.id && task.createdBy.email) {
            add({
                id: task.createdBy.id,
                name: task.createdBy.name ?? null,
                email: task.createdBy.email,
                role: (task.createdBy as any).role ?? null,
            });
        }
        if (task?.assignee?.id && task.assignee.email) {
            const fallbackRole = assignableUsers.find((u) => u.id === task.assignee?.id)?.role ?? null;
            add({ id: task.assignee.id, name: task.assignee.name ?? null, email: task.assignee.email, role: fallbackRole });
        }
        if (user?.id && user?.email) {
            add({ id: user.id, name: user.name ?? null, email: user.email, role: user.role ?? null });
        }
        comments.forEach((c) => {
            if (!c.author?.id || !c.author?.email) return;
            add({ id: c.author.id, name: c.author.name ?? null, email: c.author.email, role: c.author.role ?? null });
        });

        return Array.from(byId.values()).sort((a, b) => {
            const aLabel = (a.name || a.email).toLowerCase();
            const bLabel = (b.name || b.email).toLowerCase();
            return aLabel.localeCompare(bLabel);
        });
    }, [assignableUsers, comments, task?.assignee, task?.createdBy, user]);

    const entryCollaborators = useMemo(() => {
        const byId = new Map<string, CollaboratorMember>();
        const poolById = new Map(collaboratorPool.map((m) => [m.id, m] as const));
        const poolByMentionToken = new Map(
            collaboratorPool.map((m) => [buildCommentMentionToken(m), m] as const)
        );
        const add = (member: CollaboratorMember | null | undefined) => {
            if (!member?.id || !member.email) return;
            if (!byId.has(member.id)) byId.set(member.id, member);
        };

        if (task?.assignee?.id && task.assignee.email) {
            const fallback = poolById.get(task.assignee.id);
            add({
                id: task.assignee.id,
                name: task.assignee.name ?? fallback?.name ?? null,
                email: task.assignee.email,
                role: fallback?.role ?? null,
            });
        }

        comments.forEach((c) => {
            if (c.author?.id && c.author?.email) {
                const fallback = poolById.get(c.author.id);
                add({
                    id: c.author.id,
                    name: c.author.name ?? fallback?.name ?? null,
                    email: c.author.email,
                    role: c.author.role ?? fallback?.role ?? null,
                });
            }
            const mentionMatches = c.body.match(/@([A-Za-z0-9._-]+)/g) || [];
            mentionMatches.forEach((raw) => {
                const token = raw.slice(1).toLowerCase();
                const member = poolByMentionToken.get(token);
                if (member) add(member);
            });
        });

        manualCollaboratorIds.forEach((id) => {
            const member = poolById.get(id);
            if (member) add(member);
        });
        removedCollaboratorIds.forEach((id) => byId.delete(id));

        return Array.from(byId.values()).sort((a, b) => {
            const aLabel = (a.name || a.email).toLowerCase();
            const bLabel = (b.name || b.email).toLowerCase();
            return aLabel.localeCompare(bLabel);
        }).filter((member) => member.id !== user?.id);
    }, [buildCommentMentionToken, collaboratorPool, comments, manualCollaboratorIds, removedCollaboratorIds, task?.assignee, user?.id]);

    const collaboratorSearchResults = useMemo(() => {
        const q = collaboratorSearch.trim().toLowerCase();
        return collaboratorPool.filter((m) => {
            if (m.id === user?.id) return false;
            if (!q) return true;
            return (m.name || "").toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
        });
    }, [collaboratorPool, collaboratorSearch, user?.id]);

    const addCollaborator = React.useCallback((userId: string) => {
        setManualCollaboratorIds((prev) => Array.from(new Set([...prev, userId])));
        setRemovedCollaboratorIds((prev) => prev.filter((id) => id !== userId));
    }, []);

    const removeCollaborator = React.useCallback((userId: string) => {
        setManualCollaboratorIds((prev) => prev.filter((id) => id !== userId));
        setRemovedCollaboratorIds((prev) => Array.from(new Set([...prev, userId])));
    }, []);

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

    const updateCommentMentionState = React.useCallback((value: string, caretPosition: number) => {
        if (caretPosition < 0) {
            setCommentMentionRange(null);
            setCommentMentionQuery("");
            return;
        }

        const beforeCaret = value.slice(0, caretPosition);
        const atIndex = beforeCaret.lastIndexOf("@");
        if (atIndex < 0) {
            setCommentMentionRange(null);
            setCommentMentionQuery("");
            return;
        }

        if (atIndex > 0 && /[A-Za-z0-9._-]/.test(beforeCaret.charAt(atIndex - 1))) {
            setCommentMentionRange(null);
            setCommentMentionQuery("");
            return;
        }

        const query = beforeCaret.slice(atIndex + 1);
        if (!/^[A-Za-z0-9._-]*$/.test(query)) {
            setCommentMentionRange(null);
            setCommentMentionQuery("");
            return;
        }

        setCommentMentionRange({ start: atIndex, end: caretPosition });
        setCommentMentionQuery(query);
    }, []);

    const commentMentionSuggestions = useMemo(() => {
        if (!commentMentionRange) return [];
        const q = commentMentionQuery.trim().toLowerCase();
        const filtered = collaboratorPool.filter((member) => {
            if (member.id === user?.id) return false;
            if (!q) return true;
            return (
                (member.name || "").toLowerCase().includes(q) ||
                (member.email || "").toLowerCase().includes(q)
            );
        });
        return filtered.slice(0, 8);
    }, [collaboratorPool, commentMentionQuery, commentMentionRange, user?.id]);

    useEffect(() => {
        if (!commentMentionRange || commentMentionSuggestions.length === 0) {
            setCommentMentionActiveIndex(0);
            return;
        }
        setCommentMentionActiveIndex((prev) => Math.min(prev, commentMentionSuggestions.length - 1));
    }, [commentMentionRange, commentMentionSuggestions.length]);

    const handleSelectCommentMention = React.useCallback((member: { id: string; name: string | null; email: string }) => {
        if (!commentMentionRange) return;
        const token = `@${buildCommentMentionToken(member)}`;
        const before = newComment.slice(0, commentMentionRange.start);
        const after = newComment.slice(commentMentionRange.end);
        const needsSpace = after.length > 0 && !/^\s/.test(after) ? " " : "";
        const nextValue = `${before}${token}${needsSpace}${after}`;
        const nextCursor = (before + token + needsSpace).length;

        setNewComment(nextValue);
        setCommentMentionRange(null);
        setCommentMentionQuery("");
        setCommentMentionActiveIndex(0);
        setCommentMentionedUserIds((prev) => (prev.includes(member.id) ? prev : [...prev, member.id]));

        requestAnimationFrame(() => {
            if (!commentInputRef.current) return;
            commentInputRef.current.focus();
            commentInputRef.current.setSelectionRange(nextCursor, nextCursor);
        });
    }, [buildCommentMentionToken, commentMentionRange, newComment]);

    const handleCommentMentionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (!commentMentionRange || commentMentionSuggestions.length === 0) {
            if (e.key === "Escape") {
                setCommentMentionRange(null);
                setCommentMentionQuery("");
            }
            return;
        }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            setCommentMentionActiveIndex((prev) => (prev + 1) % commentMentionSuggestions.length);
            return;
        }

        if (e.key === "ArrowUp") {
            e.preventDefault();
            setCommentMentionActiveIndex((prev) => (prev - 1 + commentMentionSuggestions.length) % commentMentionSuggestions.length);
            return;
        }

        if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            const candidate = commentMentionSuggestions[commentMentionActiveIndex];
            if (candidate) handleSelectCommentMention(candidate);
            return;
        }

        if (e.key === "Escape") {
            e.preventDefault();
            setCommentMentionRange(null);
            setCommentMentionQuery("");
        }
    };

    const renderCommentBody = React.useCallback((body: string) => {
        const parts = body.split(/(@[A-Za-z0-9._-]+)/g);
        return parts.map((part, idx) => {
            if (/^@[A-Za-z0-9._-]+$/.test(part)) {
                return (
                    <span key={`mention-${idx}`} className="rounded bg-green-100 px-1 text-green-800 font-medium">
                        {part}
                    </span>
                );
            }
            return <React.Fragment key={`text-${idx}`}>{part}</React.Fragment>;
        });
    }, []);

    const renderCommentEditorOverlay = React.useCallback((body: string) => {
        const parts = body.split(/(@[A-Za-z0-9._-]+)/g);
        return parts.map((part, idx) => {
            if (/^@[A-Za-z0-9._-]+$/.test(part)) {
                return (
                    <span key={`editor-mention-${idx}`} className="rounded-sm bg-green-100/70 text-green-800 font-normal">
                        {part}
                    </span>
                );
            }
            return <React.Fragment key={`editor-text-${idx}`}>{part}</React.Fragment>;
        });
    }, []);

    useEffect(() => {
        if (!open) return;
        if (mode !== 1 || !task?.id) {
            setComments([]);
            setCommentsError(null);
            setNewComment("");
            setCommentMentionRange(null);
            setCommentMentionQuery("");
            setCommentMentionedUserIds([]);
            return;
        }
        void fetchComments(task.id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, mode, task?.id]);

    useEffect(() => {
        if (!open) return;
        setCollaboratorEditorOpen(false);
        setCollaboratorSearch("");
        setManualCollaboratorIds([]);
        setRemovedCollaboratorIds([]);
    }, [open, task?.id]);

    const handlePostComment = async () => {
        if (!task?.id) return;
        const body = newComment.trim();
        if (!body) return;
        const mentionTokenToId = new Map(
            collaboratorPool.map((member) => [buildCommentMentionToken(member), member.id] as const)
        );
        const bodyMentionIds = Array.from(
            new Set(
                (body.match(/@([A-Za-z0-9._-]+)/g) || [])
                    .map((raw) => raw.slice(1).toLowerCase())
                    .map((token) => mentionTokenToId.get(token))
                    .filter((id): id is string => Boolean(id))
            )
        );
        const mentionUserIds = Array.from(
            new Set([...(commentMentionedUserIds || []), ...bodyMentionIds])
        ).filter((id) => id !== user?.id);
        try {
            setPostingComment(true);
            const res = await api.post(
                `/tasks/${task.id}/comments`,
                { body, type: commentType, mentionUserIds },
                { timeout: 30000 }
            );
            const created = res.data as TaskComment;
            setComments((prev) => [...prev, created]);
            setNewComment("");
            setCommentType("COMMENT");
            setCommentsError(null);
            setCommentMentionRange(null);
            setCommentMentionQuery("");
            setCommentMentionActiveIndex(0);
            setCommentMentionedUserIds([]);
        } catch (e: any) {
            console.error("Failed to post comment", e);
            toast.error(e?.response?.data?.message || "Failed to post comment");
        } finally {
            setPostingComment(false);
        }
    };

    const handleApprove = async () => {
        if (!task?.id) return;
        try {
            setApproving(true);
            await api.post(`/tasks/${task.id}/approve`, {}, { timeout: 30000 });
            toast.success("Task approved!");
            dispatch(fetchTasks() as any);
            // Refresh comments to show the approval entry
            void fetchComments(task.id);
        } catch (e: any) {
            console.error("Failed to approve task", e);
            toast.error(e?.response?.data?.message || "Failed to approve task");
        } finally {
            setApproving(false);
        }
    };

    const handleRequestRevisions = async () => {
        if (!task?.id) return;
        const body = revisionComment.trim();
        if (!body) {
            toast.error("Please describe the revisions needed");
            return;
        }
        try {
            setRequestingRevisions(true);
            await api.post(`/tasks/${task.id}/request-revisions`, { comment: body }, { timeout: 30000 });
            toast.success("Revision request sent!");
            setRevisionComment("");
            setShowRevisionInput(false);
            dispatch(fetchTasks() as any);
            void fetchComments(task.id);
        } catch (e: any) {
            console.error("Failed to request revisions", e);
            toast.error(e?.response?.data?.message || "Failed to request revisions");
        } finally {
            setRequestingRevisions(false);
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

                    {/* Body + Footer wrapped in form */}
                    <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
                    <div className="flex-1 overflow-y-auto px-5 py-4 bg-gray-50/50">
                        <div className="space-y-5">
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
                            disabled={formReadOnly}
                            className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent ${formReadOnly ? "bg-gray-100 cursor-not-allowed" : ""}`}
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                        <textarea
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            disabled={formReadOnly}
                            className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent ${formReadOnly ? "bg-gray-100 cursor-not-allowed" : ""}`}
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
                                disabled={formReadOnly}
                                className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent ${formReadOnly ? "bg-gray-100 cursor-not-allowed" : ""}`}
                                placeholder="e.g. On-Page SEO, Link Building"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                            <select
                                value={form.status}
                                onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}
                                disabled={!canEditStatus}
                                className={`border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-primary-500 focus:border-transparent ${!canEditStatus ? "bg-gray-100 cursor-not-allowed" : ""}`}
                            >
                                <option value="TODO">TODO</option>
                                <option value="IN_PROGRESS">IN_PROGRESS</option>
                                <option value="REVIEW">REVIEW</option>
                                <option value="NEEDS_APPROVAL">NEEDS_APPROVAL</option>
                                <option value="CANCELLED">CANCELLED</option>
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
                                disabled={formReadOnly}
                                className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent ${formReadOnly ? "bg-gray-100 cursor-not-allowed" : ""}`}
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
                                        if (formReadOnly) return;
                                        setAssignableSearch(e.target.value);
                                        setAssignToOpen(true);
                                        if (form.assigneeId && e.target.value !== assigneeDisplay) {
                                            setForm((p) => ({ ...p, assigneeId: "" }));
                                            setAssigneeDisplay("");
                                        }
                                    }}
                                    onFocus={() => !formReadOnly && setAssignToOpen(true)}
                                    disabled={formReadOnly}
                                    placeholder="Search by name or email"
                                    className={`flex-1 border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary-500 focus:border-transparent ${formReadOnly ? "bg-gray-100 cursor-not-allowed" : ""}`}
                                />
                                {form.assigneeId && !formReadOnly && (
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
                            {assignToOpen && !formReadOnly && (
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
                            disabled={formReadOnly}
                            className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent ${formReadOnly ? "bg-gray-100 cursor-not-allowed" : ""}`}
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
                                disabled={formReadOnly}
                                className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent ${formReadOnly ? "bg-gray-100 cursor-not-allowed" : ""}`}
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
                                disabled={formReadOnly}
                                className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent ${formReadOnly ? "bg-gray-100 cursor-not-allowed" : ""}`}
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
                        {!formReadOnly && (
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
                                        type="text"
                                        value={urlInput}
                                        onChange={(e) => setUrlInput(e.target.value)}
                                        placeholder="Enter URL (e.g., www.example.com/image.png)"
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
                                                    download={formReadOnly ? (item.name || "attachment") : undefined}
                                                    className="text-xs text-primary-600 hover:text-primary-800 truncate block inline-flex items-center gap-1"
                                                >
                                                    {formReadOnly && <Download className="h-3.5 w-3.5 flex-shrink-0" />}
                                                    {item.name || item.value}
                                                </a>
                                            </div>
                                        </div>
                                        {!formReadOnly && (
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
                    {/* Approval Actions (client portal) */}
                    {canApprove && mode === 1 && task?.id && (
                        <section className="rounded-xl border-l-4 border-green-500 bg-green-50/50 p-4 sm:p-5">
                            <h3 className="text-sm font-semibold text-green-900 mb-3 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                Approval Required
                            </h3>
                            <p className="text-sm text-gray-600 mb-4">This task is waiting for your approval. Please review and take action.</p>
                            {!showRevisionInput ? (
                                <div className="flex flex-col sm:flex-row gap-3">
                                    <button
                                        type="button"
                                        onClick={() => void handleApprove()}
                                        disabled={approving}
                                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:opacity-50"
                                    >
                                        {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                        Approve
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowRevisionInput(true)}
                                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-rose-600 border border-rose-300 rounded-lg hover:bg-rose-50 transition-colors font-medium"
                                    >
                                        <RotateCcw className="h-4 w-4" />
                                        Request Revisions
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <textarea
                                        value={revisionComment}
                                        onChange={(e) => setRevisionComment(e.target.value)}
                                        className="w-full px-3 py-2 border border-rose-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 focus:border-transparent"
                                        rows={3}
                                        placeholder="Describe what needs to be changed..."
                                        autoFocus
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void handleRequestRevisions()}
                                            disabled={requestingRevisions || revisionComment.trim().length === 0}
                                            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors font-medium disabled:opacity-50"
                                        >
                                            {requestingRevisions ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                            Send Revision Request
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setShowRevisionInput(false); setRevisionComment(""); }}
                                            className="px-4 py-2 text-gray-600 hover:text-gray-800"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </section>
                    )}

                    {/* Activity Feed */}
                    <div className="rounded-xl border-l-4 border-teal-500 bg-teal-50/50 p-4 sm:p-5">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-teal-900 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                                Activity
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
                            <p className="mt-2 text-sm text-gray-500">Save the task to start the activity feed.</p>
                        ) : (
                            <div className="mt-3 rounded-lg border border-gray-200 bg-white">
                                <div className="max-h-64 overflow-y-auto p-3 space-y-3">
                                    {commentsLoading ? (
                                        <p className="text-sm text-gray-500">Loading activity...</p>
                                    ) : commentsError ? (
                                        <p className="text-sm text-rose-600">{commentsError}</p>
                                    ) : comments.length === 0 ? (
                                        <p className="text-sm text-gray-500">No activity yet. Start the conversation below.</p>
                                    ) : (
                                        comments.map((c) => {
                                            const config = activityConfig[c.type] || activityConfig.COMMENT;
                                            const isAuthor = user?.id && c.author?.id === user.id;
                                            const canDelete = canComment && isAuthor;
                                            const isSystemEntry = c.type === "APPROVAL" || c.type === "REVISION_REQUEST";
                                            const authorRole = c.author?.role === "USER"
                                                ? "Client"
                                                : c.author?.role === "SPECIALIST"
                                                ? "Specialist"
                                                : c.author?.role === "SUPER_ADMIN"
                                                ? "Super Admin"
                                                : c.author?.role === "ADMIN"
                                                ? "Admin"
                                                : "Agency";
                                            const when = (() => {
                                                try {
                                                    return new Date(c.createdAt).toLocaleString();
                                                } catch {
                                                    return "";
                                                }
                                            })();
                                            const displayName = c.author?.name || c.author?.email || "Unknown";
                                            const initials = displayName
                                                .split(/\s+/)
                                                .filter(Boolean)
                                                .slice(0, 2)
                                                .map((part) => part.charAt(0).toUpperCase())
                                                .join("") || "U";
                                            return (
                                                <div key={c.id} className={`group rounded-lg border p-3 ${config.borderColor} ${config.bgColor}`}>
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="min-w-0 flex items-start gap-3">
                                                            <div
                                                                className={`h-8 w-8 flex-shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${
                                                                    c.author?.role === "USER"
                                                                        ? "bg-violet-100 text-violet-700"
                                                                        : c.author?.role === "SPECIALIST"
                                                                            ? "bg-emerald-100 text-emerald-700"
                                                                            : c.author?.role === "SUPER_ADMIN"
                                                                                ? "bg-indigo-100 text-indigo-700"
                                                                                : c.author?.role === "ADMIN"
                                                                                    ? "bg-blue-100 text-blue-700"
                                                                                    : "bg-slate-100 text-slate-700"
                                                                }`}
                                                                title={displayName}
                                                            >
                                                                {initials}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <p className="text-sm font-medium text-gray-900 truncate">
                                                                        {displayName}
                                                                    </p>
                                                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                                                        {authorRole}
                                                                    </span>
                                                                </div>
                                                                <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap break-words">
                                                                    {renderCommentBody(c.body)}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            <p className="text-xs text-gray-500">{when}</p>
                                                            {canDelete && !isSystemEntry && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => requestDeleteComment(c.id)}
                                                                    className="p-1 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                                                    title="Delete"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>

                                <div className="border-t border-gray-200 p-3">
                                    {!canComment ? (
                                        <p className="text-sm text-gray-500">Sign in to participate in the conversation.</p>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                {availableCommentTypes.map((t) => {
                                                    const cfg = activityConfig[t];
                                                    return (
                                                        <button
                                                            key={t}
                                                            type="button"
                                                            onClick={() => setCommentType(t)}
                                                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
                                                                commentType === t
                                                                    ? `${cfg.color} ${cfg.bgColor} ${cfg.borderColor}`
                                                                    : "text-gray-500 bg-white border-gray-200 hover:bg-gray-50"
                                                            }`}
                                                        >
                                                            {cfg.icon}
                                                            {cfg.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            <div className="flex flex-col sm:flex-row gap-2">
                                                <div className="relative flex-1">
                                                    <div
                                                        aria-hidden
                                                        className="absolute inset-0 pointer-events-none px-3 py-2 text-sm leading-5 text-gray-700 whitespace-pre-wrap break-words rounded-lg"
                                                    >
                                                        {newComment.length === 0 ? (
                                                            <span className="text-gray-400">
                                                                {"Write a comment... Use @ to mention a user."}
                                                            </span>
                                                        ) : (
                                                            renderCommentEditorOverlay(newComment)
                                                        )}
                                                    </div>
                                                    <textarea
                                                        ref={commentInputRef}
                                                        value={newComment}
                                                        onChange={(e) => {
                                                            const value = e.target.value;
                                                            setNewComment(value);
                                                            updateCommentMentionState(value, e.target.selectionStart ?? value.length);
                                                        }}
                                                        onClick={(e) => updateCommentMentionState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
                                                        onKeyUp={(e) => updateCommentMentionState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
                                                        onKeyDown={handleCommentMentionKeyDown}
                                                        className="relative z-10 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm leading-5 bg-transparent text-transparent caret-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                                        rows={2}
                                                        placeholder=""
                                                    />
                                                    {commentMentionRange && commentMentionSuggestions.length > 0 && (
                                                        <div className="absolute bottom-full z-30 mb-1 w-full max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                                                            {commentMentionSuggestions.map((member, idx) => (
                                                                <button
                                                                    key={member.id}
                                                                    type="button"
                                                                    onMouseDown={(e) => {
                                                                        e.preventDefault();
                                                                        handleSelectCommentMention(member);
                                                                    }}
                                                                    className={`w-full px-3 py-2 text-left ${idx === commentMentionActiveIndex ? "bg-primary-50" : "hover:bg-gray-50"}`}
                                                                >
                                                                    <div className="text-sm font-medium text-gray-900">{member.name || member.email}</div>
                                                                    <div className="text-xs text-gray-500">{member.email}</div>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
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
                                            <div className="pt-1">
                                                <div className="flex items-center gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => setCollaboratorEditorOpen((v) => !v)}
                                                        className="text-sm font-medium text-gray-700 hover:text-gray-900"
                                                    >
                                                        Collaborators
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setCollaboratorEditorOpen((v) => !v)}
                                                        className="flex items-center -space-x-2"
                                                        title="Edit collaborators"
                                                    >
                                                        {entryCollaborators.slice(0, 8).map((member) => {
                                                            const displayName = member.name || member.email;
                                                            const initials = displayName
                                                                .split(" ")
                                                                .filter(Boolean)
                                                                .slice(0, 2)
                                                                .map((part) => part[0]?.toUpperCase() || "")
                                                                .join("") || "U";
                                                            return (
                                                                <div
                                                                    key={member.id}
                                                                    className="h-7 w-7 rounded-full border-2 border-white bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center"
                                                                    title={`${displayName} (${member.email})`}
                                                                >
                                                                    {initials}
                                                                </div>
                                                            );
                                                        })}
                                                        {entryCollaborators.length > 8 && (
                                                            <div
                                                                className="h-7 w-7 rounded-full border-2 border-white bg-gray-100 text-gray-600 text-[10px] font-semibold flex items-center justify-center"
                                                                title={`${entryCollaborators.length - 8} more`}
                                                            >
                                                                +{entryCollaborators.length - 8}
                                                            </div>
                                                        )}
                                                        <span className="ml-1 h-7 w-7 rounded-full border border-gray-300 bg-white text-gray-600 flex items-center justify-center">
                                                            <Plus className="h-3.5 w-3.5" />
                                                        </span>
                                                    </button>
                                                </div>
                                                <p className="mt-1 text-xs text-gray-500">
                                                    Collaborators notified on every message: <span className="font-semibold text-gray-700">{entryCollaborators.length}</span>
                                                    {" "}• @mention adds collaborator
                                                </p>
                                                {collaboratorEditorOpen && (
                                                    <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2.5 space-y-2">
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {entryCollaborators.map((member) => (
                                                                <span key={member.id} className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                                                    {member.name || member.email}
                                                                    <button type="button" className="text-gray-500 hover:text-red-600" onClick={() => removeCollaborator(member.id)}>
                                                                        <X className="h-3 w-3" />
                                                                    </button>
                                                                </span>
                                                            ))}
                                                        </div>
                                                        <input
                                                            value={collaboratorSearch}
                                                            onChange={(e) => setCollaboratorSearch(e.target.value)}
                                                            placeholder="Add collaborators by name or email..."
                                                            className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                                        />
                                                        <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200">
                                                            {collaboratorSearchResults.map((member) => {
                                                                const selected = entryCollaborators.some((m) => m.id === member.id);
                                                                return (
                                                                    <button
                                                                        key={member.id}
                                                                        type="button"
                                                                        onClick={() => (selected ? removeCollaborator(member.id) : addCollaborator(member.id))}
                                                                        className="w-full flex items-center justify-between px-2.5 py-2 text-left hover:bg-gray-50"
                                                                    >
                                                                        <div className="min-w-0">
                                                                            <div className="text-sm text-gray-900 truncate">{member.name || member.email}</div>
                                                                            <div className="text-xs text-gray-500 truncate">{member.email}</div>
                                                                        </div>
                                                                        <span className={`text-xs font-medium ${selected ? "text-red-600" : "text-primary-600"}`}>
                                                                            {selected ? "Remove" : "Add"}
                                                                        </span>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                        </div>
                    </div>

                    {/* Footer - outside scroll */}
                    <div className="shrink-0 border-t border-gray-200 bg-white px-5 py-4 rounded-b-2xl">
                        <div className="flex flex-col sm:flex-row gap-3">
                            <button
                                type="button"
                                onClick={handleCancel}
                                className={`${isClientUser || (isNotOwner && !isAdminAssigneeStatusEditor) ? "w-full" : "w-full sm:flex-1"} border border-gray-300 bg-white text-gray-700 py-3 px-6 rounded-xl hover:bg-gray-50 font-medium transition-colors`}
                            >
                                {isClientUser || (isNotOwner && !isAdminAssigneeStatusEditor) ? "Close" : "Cancel"}
                            </button>
                            {!isClientUser && (!isNotOwner || isAdminAssigneeStatusEditor) && (
                                <button
                                    type="submit"
                                    className="w-full sm:flex-1 py-3 px-6 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-md hover:shadow-lg transition-all"
                                >
                                    {mode === 0 ? "Create" : isAdminAssigneeStatusEditor ? "Save Status" : "Save"}
                                </button>
                            )}
                        </div>
                    </div>
                    </form>
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
