import { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useLocation } from "react-router-dom";
import { RootState } from "@/store";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { CheckCircle2, ExternalLink, Lock, MessageSquare, Plus, Upload } from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";

type ProjectStatus = "active" | "complete";
type PageStatus = "pending_upload" | "needs_review" | "revision_requested" | "approved";
type CollaboratorUser = { id: string; name: string | null; email: string; role: string };

type WebDesignProject = {
  id: string;
  projectName: string;
  clientId: string;
  agencyId?: string | null;
  designerId: string;
  status: ProjectStatus;
  createdAt: string;
  completedAt?: string | null;
  client?: { id: string; name: string };
  designer?: { id: string; name: string | null; email: string };
  activatedBy?: { id: string; name: string | null; email: string };
  collaboratorUserIds?: string[];
  collaboratorUsers?: CollaboratorUser[];
  pages?: Array<{ id: string; status: PageStatus }>;
};

type WebDesignVersion = {
  id: string;
  versionNumber: number;
  fileUrl: string;
  uploadedAt: string;
};

type WebDesignComment = {
  id: string;
  message: string;
  parentId?: string | null;
  authorRole: "client" | "designer" | "admin";
  createdAt: string;
  author?: { id: string; name: string | null; email: string; role: string };
};

type WebDesignPage = {
  id: string;
  pageName: string;
  status: PageStatus;
  approvedAt?: string | null;
  figmaLink?: string | null;
  versions: WebDesignVersion[];
  comments: WebDesignComment[];
};

type WebDesignProjectDetail = Omit<WebDesignProject, "pages"> & { pages: WebDesignPage[] };
const WEB_DESIGN_LIVE_REFRESH_MS = 3000;

const statusLabel: Record<PageStatus, string> = {
  pending_upload: "Pending Upload",
  needs_review: "Needs Review",
  revision_requested: "Revision Requested",
  approved: "Approved",
};

const pageStatusBadgeClass: Record<PageStatus, string> = {
  pending_upload: "bg-slate-100 text-slate-700 border-slate-200",
  needs_review: "bg-sky-100 text-sky-700 border-sky-200",
  revision_requested: "bg-amber-100 text-amber-700 border-amber-200",
  approved: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace("#", "").trim();
  const expanded =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => `${c}${c}`)
          .join("")
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    return `rgba(79,70,229,${alpha})`;
  }
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface Props {
  clientId?: string;
  embedded?: boolean;
  initialProjectId?: string;
  initialPageId?: string;
}

export default function WebDesignWorkspace({
  clientId,
  embedded = false,
  initialProjectId,
  initialPageId,
}: Props) {
  const location = useLocation();
  const { user } = useSelector((state: RootState) => state.auth);
  const isClientScopedView = Boolean(clientId);
  const [projects, setProjects] = useState<WebDesignProject[]>([]);
  const [projectDetail, setProjectDetail] = useState<WebDesignProjectDetail | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [designers, setDesigners] = useState<Array<{ id: string; name: string | null; email: string }>>([]);
  const [collaboratorOptions, setCollaboratorOptions] = useState<CollaboratorUser[]>([]);
  const [selectedCollaboratorIds, setSelectedCollaboratorIds] = useState<string[]>([]);
  const [collaboratorCandidateId, setCollaboratorCandidateId] = useState("");
  const [savingCollaborators, setSavingCollaborators] = useState(false);
  const [loading, setLoading] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [activateClientId, setActivateClientId] = useState(clientId || "");
  const [activateDesignerId, setActivateDesignerId] = useState("");
  const [newPageName, setNewPageName] = useState("");
  const [newPageFigmaLink, setNewPageFigmaLink] = useState("");
  const [newComment, setNewComment] = useState("");
  const [commentMentionRange, setCommentMentionRange] = useState<{ start: number; end: number } | null>(null);
  const [commentMentionQuery, setCommentMentionQuery] = useState("");
  const [commentMentionActiveIndex, setCommentMentionActiveIndex] = useState(0);
  const [commentMentionedUserIds, setCommentMentionedUserIds] = useState<string[]>([]);
  const [feedbackText, setFeedbackText] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [openReplyForId, setOpenReplyForId] = useState<string | null>(null);
  const [commentCollaboratorEditorOpen, setCommentCollaboratorEditorOpen] = useState(false);
  const [commentCollaboratorSearch, setCommentCollaboratorSearch] = useState("");
  const [figmaDraft, setFigmaDraft] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [projectStatusFilter, setProjectStatusFilter] = useState<ProjectStatus>("active");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectSort, setProjectSort] = useState<"newest" | "oldest" | "client_az" | "project_az">("newest");
  const [uploading, setUploading] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [deleteProjectModalOpen, setDeleteProjectModalOpen] = useState(false);
  const appliedRequestedPageRef = useRef<string | null>(null);
  const selectedPageIdRef = useRef<string | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);

  const isAdmin = ["SUPER_ADMIN", "ADMIN", "AGENCY"].includes(user?.role || "");
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const canManagePageStatus = ["SUPER_ADMIN", "DESIGNER", "USER"].includes(user?.role || "");
  const isClient = user?.role === "USER";
  const isDesignerOrAdmin = isAdmin || user?.role === "DESIGNER";
  const brandColor = user?.agencyBranding?.primaryColor || "#4f46e5";
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedProjectId = initialProjectId || searchParams.get("projectId") || null;
  const requestedPageId = initialPageId || searchParams.get("pageId") || null;

  const selectedPage = useMemo(
    () => projectDetail?.pages.find((p) => p.id === selectedPageId) || null,
    [projectDetail, selectedPageId]
  );
  const selectedCollaborators = useMemo(
    () => {
      const pool = [
        ...(projectDetail?.collaboratorUsers || []),
        ...collaboratorOptions,
      ];
      const poolById = new Map(pool.map((u) => [u.id, u] as const));
      return selectedCollaboratorIds
        .map((id) => poolById.get(id))
        .filter(Boolean) as CollaboratorUser[];
    },
    [selectedCollaboratorIds, collaboratorOptions, projectDetail?.collaboratorUsers]
  );
  const commentCollaboratorPool = useMemo(() => {
    const byId = new Map<string, CollaboratorUser>();
    const add = (member: CollaboratorUser | null | undefined) => {
      if (!member?.id || !member.email) return;
      if (!byId.has(member.id)) byId.set(member.id, member);
    };

    collaboratorOptions.forEach(add);
    (projectDetail?.collaboratorUsers || []).forEach(add);

    if (projectDetail?.designer?.id && projectDetail?.designer?.email) {
      add({
        id: projectDetail.designer.id,
        name: projectDetail.designer.name ?? null,
        email: projectDetail.designer.email,
        role: "DESIGNER",
      });
    }
    if (projectDetail?.activatedBy?.id && projectDetail?.activatedBy?.email) {
      add({
        id: projectDetail.activatedBy.id,
        name: projectDetail.activatedBy.name ?? null,
        email: projectDetail.activatedBy.email,
        role: "ADMIN",
      });
    }

    (selectedPage?.comments || []).forEach((c) => {
      if (!c.author?.id || !c.author?.email) return;
      add({
        id: c.author.id,
        name: c.author.name ?? null,
        email: c.author.email,
        role: c.author.role ?? "USER",
      });
    });

    return Array.from(byId.values()).sort((a, b) =>
      (a.name || a.email).localeCompare((b.name || b.email), undefined, { sensitivity: "base" })
    );
  }, [collaboratorOptions, projectDetail?.activatedBy, projectDetail?.collaboratorUsers, projectDetail?.designer, selectedPage?.comments]);
  const commentCollaboratorSearchResults = useMemo(() => {
    const q = commentCollaboratorSearch.trim().toLowerCase();
    return commentCollaboratorPool.filter((m) => {
      if (m.id === user?.id) return false;
      if (!q) return true;
      return (m.name || "").toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
    });
  }, [commentCollaboratorPool, commentCollaboratorSearch, user?.id]);
  const commentMentionSuggestions = useMemo(() => {
    if (!commentMentionRange) return [];
    const q = commentMentionQuery.trim().toLowerCase();
    return commentCollaboratorPool
      .filter((member) => {
        if (member.id === user?.id) return false;
        if (!q) return true;
        return (member.name || "").toLowerCase().includes(q) || member.email.toLowerCase().includes(q);
      })
      .slice(0, 8);
  }, [commentCollaboratorPool, commentMentionQuery, commentMentionRange, user?.id]);

  useEffect(() => {
    setActivateClientId(clientId || "");
  }, [clientId]);

  useEffect(() => {
    selectedPageIdRef.current = selectedPageId;
  }, [selectedPageId]);
  const approvedPagesCount = useMemo(
    () => (projectDetail?.pages || []).filter((p) => p.status === "approved").length,
    [projectDetail?.pages]
  );
  const versionList = useMemo(
    () => (selectedPage?.versions ? [...selectedPage.versions].sort((a, b) => b.versionNumber - a.versionNumber) : []),
    [selectedPage?.versions]
  );
  const selectedVersion = useMemo(() => {
    if (!versionList.length) return null;
    if (selectedVersionId) {
      const match = versionList.find((v) => v.id === selectedVersionId);
      if (match) return match;
    }
    return versionList[0];
  }, [versionList, selectedVersionId]);
  const commentsByParent = useMemo(() => {
    const map: Record<string, WebDesignComment[]> = {};
    if (!selectedPage) return map;
    selectedPage.comments.forEach((comment) => {
      const key = comment.parentId || "root";
      if (!map[key]) map[key] = [];
      map[key].push(comment);
    });
    return map;
  }, [selectedPage]);
  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    const list = q
      ? projects.filter((p) =>
          [p.projectName, p.client?.name || "", p.designer?.name || "", p.designer?.email || ""]
            .join(" ")
            .toLowerCase()
            .includes(q)
        )
      : [...projects];

    list.sort((a, b) => {
      if (projectSort === "client_az") return (a.client?.name || "").localeCompare(b.client?.name || "");
      if (projectSort === "project_az") return a.projectName.localeCompare(b.projectName);
      const aDate = new Date((projectStatusFilter === "active" ? a.createdAt : a.completedAt || a.createdAt) || 0).getTime();
      const bDate = new Date((projectStatusFilter === "active" ? b.createdAt : b.completedAt || b.createdAt) || 0).getTime();
      return projectSort === "oldest" ? aDate - bDate : bDate - aDate;
    });

    return list;
  }, [projects, projectSearch, projectSort, projectStatusFilter]);
  const sortedClients = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [clients]
  );
  const sortedDesigners = useMemo(
    () =>
      [...designers].sort((a, b) =>
        (a.name || a.email || "").localeCompare((b.name || b.email || ""), undefined, { sensitivity: "base" })
      ),
    [designers]
  );

  const shellClass = embedded ? "space-y-5 rounded-xl p-4" : "min-h-screen p-8 space-y-5";
  const shellStyle = {
    border: embedded ? `1px solid ${hexToRgba(brandColor, 0.2)}` : undefined,
    background: `linear-gradient(180deg, ${hexToRgba(brandColor, embedded ? 0.08 : 0.06)} 0%, #ffffff 50%)`,
  };
  const accentButtonStyle = {
    backgroundColor: brandColor,
    borderColor: brandColor,
  };

  const loadProjects = async () => {
    setLoading(true);
    try {
      const res = await api.get("/web-design/projects", { params: { status: projectStatusFilter } });
      const list = Array.isArray(res.data) ? (res.data as WebDesignProject[]) : [];
      const filtered = clientId ? list.filter((p) => p.clientId === clientId) : list;
      setProjects(filtered);
      const fallbackId = requestedProjectId && filtered.some((p) => p.id === requestedProjectId)
        ? requestedProjectId
        : selectedProjectId && filtered.some((p) => p.id === selectedProjectId)
        ? selectedProjectId
        : filtered[0]?.id || null;
      setSelectedProjectId(fallbackId);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to load web design projects");
    } finally {
      setLoading(false);
    }
  };

  const loadProjectDetail = async (projectId: string, options?: { silent?: boolean }) => {
    try {
      const res = await api.get(`/web-design/projects/${projectId}`);
      const detail = res.data as WebDesignProjectDetail;
      setProjectDetail(detail);
      // Keep the Projects table in sync with live detail updates.
      setProjects((prev) =>
        prev.map((project) =>
          project.id === detail.id
            ? {
                ...project,
                projectName: detail.projectName,
                clientId: detail.clientId,
                agencyId: detail.agencyId ?? null,
                designerId: detail.designerId,
                status: detail.status,
                createdAt: detail.createdAt,
                completedAt: detail.completedAt ?? null,
                client: detail.client,
                designer: detail.designer,
                activatedBy: detail.activatedBy,
                pages: detail.pages.map((page) => ({ id: page.id, status: page.status })),
              }
            : project
        )
      );
      const requestKey = requestedPageId ? `${projectId}:${requestedPageId}` : null;
      const shouldApplyRequestedPage =
        Boolean(requestKey) &&
        requestKey !== appliedRequestedPageRef.current &&
        detail.pages.some((p) => p.id === requestedPageId);
      if (requestedPageId && shouldApplyRequestedPage) {
        appliedRequestedPageRef.current = requestKey;
        setSelectedPageId(requestedPageId);
      } else if (!selectedPageIdRef.current || !detail.pages.some((p) => p.id === selectedPageIdRef.current)) {
        setSelectedPageId(detail.pages[0]?.id || null);
      }
    } catch (e: any) {
      if (!options?.silent) {
        toast.error(e?.response?.data?.message || "Failed to load project details");
      }
    }
  };

  const loadCollaboratorOptions = async (projectId: string) => {
    try {
      const res = await api.get(`/web-design/projects/${projectId}/collaborator-options`, { _silent: true } as any);
      setCollaboratorOptions(Array.isArray(res.data) ? res.data : []);
    } catch {
      setCollaboratorOptions([]);
    }
  };

  useEffect(() => {
    loadProjects();
  }, [clientId, requestedProjectId, projectStatusFilter]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectDetail(null);
      setSelectedPageId(null);
      setSelectedVersionId(null);
      setCollaboratorOptions([]);
      setSelectedCollaboratorIds([]);
      return;
    }
    try {
      const raw = window.localStorage.getItem(`webDesignCollaborators:${selectedProjectId}`);
      const parsed = raw ? JSON.parse(raw) : [];
      setSelectedCollaboratorIds(Array.isArray(parsed) ? parsed.map((v) => String(v || "")).filter(Boolean) : []);
    } catch {
      setSelectedCollaboratorIds([]);
    }
    loadProjectDetail(selectedProjectId);
    if (isDesignerOrAdmin) loadCollaboratorOptions(selectedProjectId);
  }, [selectedProjectId, requestedPageId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      loadProjectDetail(selectedProjectId, { silent: true });
    }, WEB_DESIGN_LIVE_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!versionList.length) {
      setSelectedVersionId(null);
      return;
    }
    if (!selectedVersionId || !versionList.some((v) => v.id === selectedVersionId)) {
      setSelectedVersionId(versionList[0].id);
    }
  }, [versionList, selectedVersionId]);

  useEffect(() => {
    setFigmaDraft(selectedPage?.figmaLink || "");
  }, [selectedPage?.id, selectedPage?.figmaLink]);

  useEffect(() => {
    if (!isAdmin) return;
    api.get("/clients")
      .then((res) => {
        const rows = Array.isArray(res.data) ? res.data : [];
        setClients(
          rows
            .filter((c: any) => String(c?.status || "").toUpperCase() === "ACTIVE")
            .map((c: any) => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
        );
      })
      .catch(() => setClients([]));
    api.get("/web-design/designers")
      .then((res) => {
        setDesigners(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => setDesigners([]));
  }, [isAdmin]);

  const activateProject = async () => {
    const effectiveClientId = clientId || activateClientId;
    if (!projectName.trim() || !effectiveClientId || !activateDesignerId) {
      toast.error("Project name, client, and designer are required");
      return;
    }
    try {
      await api.post("/web-design/projects/activate", {
        projectName: projectName.trim(),
        clientId: effectiveClientId,
        designerId: activateDesignerId,
      });
      setProjectName("");
      toast.success("Web design project activated");
      loadProjects();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to activate project");
    }
  };

  const addPage = async () => {
    if (!selectedProjectId || !newPageName.trim()) return;
    try {
      await api.post(`/web-design/projects/${selectedProjectId}/pages`, {
        pageName: newPageName.trim(),
        figmaLink: newPageFigmaLink.trim() ? newPageFigmaLink.trim() : null,
      });
      setNewPageName("");
      setNewPageFigmaLink("");
      await loadProjectDetail(selectedProjectId);
      toast.success("Page added");
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to add page");
    }
  };

  const uploadPdfVersion = async (file: File) => {
    if (!selectedPage) return;
    if (!file || file.type !== "application/pdf") {
      toast.error("Please select a PDF file");
      return;
    }
    const form = new FormData();
    form.append("files", file);
    setUploading(true);
    try {
      const uploadRes = await api.post("/upload/worklog", form);
      const firstFile = Array.isArray(uploadRes.data) ? uploadRes.data[0] : null;
      if (!firstFile?.value) throw new Error("Upload did not return a file URL.");
      await api.post(`/web-design/pages/${selectedPage.id}/versions`, { fileUrl: firstFile.value });
      toast.success("Revision uploaded");
      if (selectedProjectId) await loadProjectDetail(selectedProjectId);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || "Failed to upload file");
    } finally {
      setUploading(false);
    }
  };

  const buildCommentMentionToken = (member: { name: string | null; email: string }) => {
    const rawHandle = (member.name || member.email || "").trim();
    return (rawHandle
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9._-]/g, "") || "user").toLowerCase();
  };
  const updateCommentMentionState = (value: string, caretPosition: number) => {
    const safeCaret = Math.max(0, Math.min(caretPosition, value.length));
    const beforeCaret = value.slice(0, safeCaret);
    const atIndex = beforeCaret.lastIndexOf("@");
    if (atIndex < 0) {
      setCommentMentionRange(null);
      setCommentMentionQuery("");
      return;
    }
    const prevChar = atIndex > 0 ? beforeCaret.charAt(atIndex - 1) : " ";
    if (!/\s|[\(\[\{,]/.test(prevChar)) {
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
    setCommentMentionRange({ start: atIndex, end: safeCaret });
    setCommentMentionQuery(query.toLowerCase());
  };

  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setNewComment(next);
    updateCommentMentionState(next, e.target.selectionStart ?? next.length);
  };

  const handleSelectCommentMention = (member: CollaboratorUser) => {
    if (!commentMentionRange) return;
    const token = `@${buildCommentMentionToken(member)} `;
    const before = newComment.slice(0, commentMentionRange.start);
    const after = newComment.slice(commentMentionRange.end);
    const nextValue = `${before}${token}${after}`;
    const nextCaret = (before + token).length;
    setNewComment(nextValue);
    setCommentMentionRange(null);
    setCommentMentionQuery("");
    setCommentMentionActiveIndex(0);
    setCommentMentionedUserIds((prev) => (prev.includes(member.id) ? prev : [...prev, member.id]));
    requestAnimationFrame(() => {
      if (!commentInputRef.current) return;
      commentInputRef.current.focus();
      commentInputRef.current.setSelectionRange(nextCaret, nextCaret);
    });
  };

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

  const extractMentionUserIdsFromMessage = (message: string): string[] => {
    const mentionMatches = message.match(/@([A-Za-z0-9._-]+)/g) || [];
    if (mentionMatches.length === 0) return [];
    const tokenToUserId = new Map(
      commentCollaboratorPool.map((member) => [buildCommentMentionToken(member), member.id] as const)
    );
    return Array.from(
      new Set(
        mentionMatches
          .map((raw) => raw.slice(1).toLowerCase())
          .map((token) => tokenToUserId.get(token))
          .filter(Boolean) as string[]
      )
    ).filter((uid) => uid !== user?.id);
  };

  const postComment = async (message: string, parentId?: string | null) => {
    if (!selectedPage || !message.trim()) return;
    const trimmedMessage = message.trim();
    const bodyMentionIds = extractMentionUserIdsFromMessage(trimmedMessage);
    const mentionUserIds = Array.from(new Set([...(commentMentionedUserIds || []), ...bodyMentionIds]));
    const notifyUserIds = Array.from(new Set([...selectedCollaboratorIds, ...mentionUserIds]));
    try {
      await api.post(`/web-design/pages/${selectedPage.id}/comments`, {
        message: trimmedMessage,
        ...(parentId ? { parentId } : {}),
        ...(notifyUserIds.length ? { notifyUserIds } : {}),
      });
      if (parentId) {
        setReplyDrafts((prev) => ({ ...prev, [parentId]: "" }));
        setOpenReplyForId(null);
      } else {
        setNewComment("");
        setCommentMentionQuery("");
        setCommentMentionRange(null);
        setCommentMentionedUserIds([]);
        setCommentMentionActiveIndex(0);
      }
      if (notifyUserIds.length > selectedCollaboratorIds.length) {
        await persistCollaborators(notifyUserIds, { silent: true });
      }
      if (selectedProjectId) await loadProjectDetail(selectedProjectId);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to post comment");
    }
  };

  useEffect(() => {
    if (!commentMentionRange || commentMentionSuggestions.length === 0) {
      setCommentMentionActiveIndex(0);
      return;
    }
    setCommentMentionActiveIndex((prev) => Math.min(prev, commentMentionSuggestions.length - 1));
  }, [commentMentionRange, commentMentionSuggestions.length]);

  const submitFeedback = async () => {
    if (!selectedPage || !feedbackText.trim()) return;
    try {
      await api.post(`/web-design/pages/${selectedPage.id}/submit-feedback`, { message: feedbackText.trim() });
      setFeedbackText("");
      if (selectedProjectId) await loadProjectDetail(selectedProjectId);
      toast.success("Feedback submitted");
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to submit feedback");
    }
  };

  const approvePage = async () => {
    if (!selectedPage) return;
    try {
      await api.post(`/web-design/pages/${selectedPage.id}/approve`);
      if (selectedProjectId) await loadProjectDetail(selectedProjectId);
      toast.success("Page approved");
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to approve page");
    }
  };

  const completeProject = async () => {
    if (!selectedProjectId) return;
    try {
      await api.post(`/web-design/projects/${selectedProjectId}/complete`);
      toast.success("Project marked complete");
      setProjectStatusFilter("complete");
      await loadProjects();
      await loadProjectDetail(selectedProjectId);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to complete project");
    }
  };

  const deleteProject = async () => {
    if (!selectedProjectId) return;
    try {
      await api.delete(`/web-design/projects/${selectedProjectId}`);
      toast.success("Project deleted");
      setProjectDetail(null);
      setSelectedPageId(null);
      setSelectedVersionId(null);
      await loadProjects();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to delete project");
    }
  };

  const savePageMeta = async () => {
    if (!selectedPage) return;
    try {
      await api.patch(`/web-design/pages/${selectedPage.id}`, {
        figmaLink: figmaDraft.trim() ? figmaDraft.trim() : null,
      });
      if (selectedProjectId) await loadProjectDetail(selectedProjectId);
      toast.success("Page details updated");
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to update page details");
    }
  };

  const markPageReadyForReview = async () => {
    if (!selectedPage) return;
    setMarkingReady(true);
    try {
      const res = await api.post(`/web-design/pages/${selectedPage.id}/mark-ready`);
      toast.success(res?.data?.message || "Page marked ready for client review");
      if (selectedProjectId) await loadProjectDetail(selectedProjectId);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to mark page ready for review");
    } finally {
      setMarkingReady(false);
    }
  };

  const updatePageStatus = async (status: PageStatus) => {
    if (!selectedPage) return;
    setUpdatingStatus(true);
    try {
      await api.patch(`/web-design/pages/${selectedPage.id}/status`, { status });
      if (selectedProjectId) await loadProjectDetail(selectedProjectId);
      toast.success("Page status updated");
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to update page status");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const persistCollaborators = async (nextIds: string[], options?: { silent?: boolean }) => {
    if (!selectedProjectId) return;
    setSavingCollaborators(true);
    try {
      const ids = [...new Set(nextIds.map((v) => String(v || "").trim()).filter(Boolean))];
      setSelectedCollaboratorIds(ids);
      window.localStorage.setItem(`webDesignCollaborators:${selectedProjectId}`, JSON.stringify(ids));
      if (!options?.silent) toast.success("Collaborators updated");
    } catch {
      toast.error("Failed to update collaborators");
    } finally {
      setSavingCollaborators(false);
    }
  };

  const renderCommentTree = (parentId: string | null = null, depth = 0): JSX.Element[] => {
    const key = parentId || "root";
    const comments = commentsByParent[key] || [];
    return comments.map((c) => (
      <div
        key={c.id}
        className={`space-y-1.5 ${depth > 0 ? "border-l border-slate-200/80 pl-2.5" : ""}`}
        style={{ marginLeft: depth > 0 ? `${Math.min(depth, 4) * 10}px` : 0 }}
      >
        <div
          className={`rounded-md border px-2.5 py-1.5 ${
            c.authorRole === "client"
              ? "bg-amber-50 border-amber-200"
              : c.authorRole === "designer"
              ? "bg-sky-50 border-sky-200"
              : "bg-violet-50 border-violet-200"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] leading-none text-gray-500">
              <span className="font-semibold text-gray-700">{c.author?.name || c.author?.email || "Unknown"}</span>
              {" · "}
              <span className="capitalize">{c.authorRole}</span>
            </p>
            <p className="text-[10px] leading-none text-gray-400 whitespace-nowrap">{new Date(c.createdAt).toLocaleString()}</p>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-gray-800 whitespace-pre-wrap">{c.message}</p>
          {selectedPage?.status !== "approved" && (
            <button
              type="button"
              onClick={() => setOpenReplyForId((prev) => (prev === c.id ? null : c.id))}
              className="mt-1.5 text-[11px] font-medium text-primary-700 hover:text-primary-800"
            >
              Reply
            </button>
          )}
        </div>
        {openReplyForId === c.id && selectedPage?.status !== "approved" && (
          <div className="flex gap-1.5">
            <input
              value={replyDrafts[c.id] || ""}
              onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))}
              placeholder="Write a reply"
              className="flex-1 border border-gray-300 rounded-md px-2.5 py-1.5 text-xs"
            />
            <button
              type="button"
              onClick={() => postComment(replyDrafts[c.id] || "", c.id)}
              className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs hover:bg-gray-50"
            >
              Post Reply
            </button>
          </div>
        )}
        {renderCommentTree(c.id, depth + 1)}
      </div>
    ));
  };

  return (
    <div className={shellClass} style={shellStyle}>
      {!embedded && <h1 className="text-2xl font-bold text-gray-900">Web Design</h1>}

      {isAdmin && (
        <div
          className="rounded-xl p-4 space-y-3 shadow-sm"
          style={{
            border: `1px solid ${hexToRgba(brandColor, 0.2)}`,
            background: `linear-gradient(90deg, ${hexToRgba(brandColor, 0.1)} 0%, ${hexToRgba(brandColor, 0.06)} 50%, #ffffff 100%)`,
          }}
        >
          <h2 className="text-xs font-semibold tracking-[0.08em] text-gray-600 uppercase">Activate Project</h2>
          <div className={`grid grid-cols-1 ${isClientScopedView ? "md:grid-cols-3" : "md:grid-cols-4"} gap-3 overflow-visible`}>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Project name"
              className="border border-gray-300 rounded-lg px-3 py-2"
            />
            {!isClientScopedView && (
              <select
                value={activateClientId}
                onChange={(e) => setActivateClientId(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2"
              >
                <option value="">Select client</option>
                {sortedClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={activateDesignerId}
              onChange={(e) => setActivateDesignerId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2"
            >
              <option value="">Select designer</option>
              {sortedDesigners.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name || d.email}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={activateProject}
              className="rounded-lg text-white px-4 py-2"
              style={accentButtonStyle}
            >
              Activate
            </button>
          </div>
        </div>
      )}

      <div className="space-y-5">
        <div className="rounded-xl bg-white p-4 shadow-sm" style={{ border: `1px solid ${hexToRgba(brandColor, 0.16)}` }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold tracking-[0.08em] text-gray-600 uppercase">Projects</h2>
            {loading && <span className="text-xs text-gray-500">Loading...</span>}
          </div>
          <div className="mb-4 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button
              type="button"
              onClick={() => setProjectStatusFilter("active")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${projectStatusFilter === "active" ? "text-white" : "text-gray-600 hover:bg-gray-100"}`}
              style={projectStatusFilter === "active" ? accentButtonStyle : undefined}
            >
              Active Projects
            </button>
            <button
              type="button"
              onClick={() => setProjectStatusFilter("complete")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${projectStatusFilter === "complete" ? "text-white" : "text-gray-600 hover:bg-gray-100"}`}
              style={projectStatusFilter === "complete" ? accentButtonStyle : undefined}
            >
              Past Projects
            </button>
          </div>
          <div className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              placeholder="Search client, project, designer"
              className="md:col-span-2 border border-gray-300 rounded-md px-3 py-1.5 text-xs"
            />
            <select
              value={projectSort}
              onChange={(e) => setProjectSort(e.target.value as typeof projectSort)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-xs"
            >
              <option value="newest">Sort: Newest</option>
              <option value="oldest">Sort: Oldest</option>
              <option value="client_az">Sort: Client A-Z</option>
              <option value="project_az">Sort: Project A-Z</option>
            </select>
          </div>
          <div
            className="overflow-auto rounded-lg max-h-[320px]"
            style={{ border: `1px solid ${hexToRgba(brandColor, 0.14)}` }}
          >
            <table className="w-full text-left text-[12px]">
              <thead className="text-gray-700 bg-gray-50 sticky top-0 z-10">
                <tr>
                  {!isClientScopedView && <th className="px-3 py-2 font-medium">Client</th>}
                  <th className="px-3 py-2 font-medium">Project</th>
                  <th className="px-3 py-2 font-medium">Designer</th>
                  {projectStatusFilter === "active" && (
                    <>
                      <th className="px-3 py-2 font-medium">Total Pages</th>
                      <th className="px-3 py-2 font-medium">Pages Approved</th>
                    </>
                  )}
                  <th className="px-3 py-2 font-medium">{projectStatusFilter === "active" ? "Started" : "Completed"}</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map((p) => {
                  const approved = (p.pages || []).filter((pg) => pg.status === "approved").length;
                  const total = (p.pages || []).length;
                  const isSelected = selectedProjectId === p.id;
                  const dateValue = projectStatusFilter === "active" ? p.createdAt : p.completedAt || p.createdAt;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedProjectId(p.id)}
                      className={`cursor-pointer ${
                        isSelected ? "" : "hover:bg-gray-50"
                      }`}
                      style={{
                        borderTop: `1px solid ${hexToRgba(brandColor, 0.1)}`,
                        backgroundColor: isSelected ? hexToRgba(brandColor, 0.12) : undefined,
                      }}
                    >
                      {!isClientScopedView && (
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{p.client?.name || "Client"}</td>
                      )}
                      <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{p.projectName}</td>
                      <td className="px-3 py-2 text-gray-700">{p.designer?.name || p.designer?.email || "-"}</td>
                      {projectStatusFilter === "active" && (
                        <>
                          <td className="px-3 py-2 text-gray-700">{total}</td>
                          <td className="px-3 py-2 text-gray-700">{approved}</td>
                        </>
                      )}
                      <td className="px-3 py-2 text-gray-600">{new Date(dateValue || Date.now()).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredProjects.length === 0 && (
              <p className="p-3 text-sm text-gray-500">
                {projectSearch.trim()
                  ? "No projects match your search."
                  : projectStatusFilter === "active"
                  ? "No active web design projects."
                  : "No completed web design projects."}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-white p-4 shadow-sm" style={{ border: `1px solid ${hexToRgba(brandColor, 0.16)}` }}>
          {!projectDetail ? (
            <p className="text-sm text-gray-500">Select a project to view details.</p>
          ) : (
            <div className="space-y-4">
              {projectDetail.status === "complete" && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 inline-flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Project is complete. This view is read-only.
                </div>
              )}
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div
                    className="rounded-xl border p-4 shadow-sm ring-1 ring-white/60"
                    style={{
                      borderColor: hexToRgba(brandColor, 0.24),
                      background: `linear-gradient(105deg, ${hexToRgba(brandColor, 0.2)} 0%, ${hexToRgba("#22d3ee", 0.16)} 55%, ${hexToRgba("#34d399", 0.14)} 100%)`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-gray-900">{projectDetail.projectName}</h2>
                        <span
                          className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold shadow-sm"
                          style={
                            projectDetail.status === "active"
                              ? {
                                  backgroundColor: hexToRgba(brandColor, 0.18),
                                  borderColor: hexToRgba(brandColor, 0.34),
                                  color: "#1f2937",
                                }
                              : {
                                  backgroundColor: hexToRgba("#7c3aed", 0.2),
                                  borderColor: hexToRgba("#7c3aed", 0.36),
                                  color: "#4c1d95",
                                }
                          }
                        >
                          {projectDetail.status === "active" ? "Active" : "Complete"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isAdmin &&
                          projectDetail.status === "active" &&
                          projectDetail.pages.length > 0 &&
                          approvedPagesCount === projectDetail.pages.length && (
                          <button
                            type="button"
                            onClick={completeProject}
                            className="rounded-md border border-gray-300 bg-white/90 px-3 py-1.5 text-xs font-medium whitespace-nowrap shadow-sm hover:bg-white"
                          >
                            Mark Project Complete
                          </button>
                          )}
                        {isSuperAdmin && (
                          <button
                            type="button"
                            onClick={() => setDeleteProjectModalOpen(true)}
                            className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 whitespace-nowrap shadow-sm hover:bg-rose-100"
                          >
                            Delete Project
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs uppercase tracking-wide text-slate-600">
                      {projectDetail.client?.name || "No client"} - Web Design Project
                    </p>
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-600">
                        <span>Progress</span>
                        <span>
                          {approvedPagesCount}/{projectDetail.pages.length} pages approved
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-white/90 shadow-inner">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${projectDetail.pages.length ? (approvedPagesCount / projectDetail.pages.length) * 100 : 0}%`,
                            background: `linear-gradient(90deg, ${brandColor} 0%, #22d3ee 55%, #6366f1 100%)`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="relative mt-3">
                    <div className="scrollbar-none grid auto-cols-[minmax(180px,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1 text-xs">
                      <div
                        className="rounded-lg border px-3 py-2 shadow-sm"
                        style={{
                          borderColor: hexToRgba(brandColor, 0.28),
                          background: `linear-gradient(135deg, ${hexToRgba(brandColor, 0.15)} 0%, ${hexToRgba("#38bdf8", 0.15)} 100%)`,
                        }}
                      >
                        <p className="font-semibold" style={{ color: brandColor }}>Assigned Designer</p>
                        <p className="mt-0.5 text-slate-700">{projectDetail.designer?.name || projectDetail.designer?.email || "-"}</p>
                      </div>
                      <div
                        className="rounded-lg border px-3 py-2 shadow-sm"
                        style={{
                          borderColor: hexToRgba(brandColor, 0.28),
                          background: `linear-gradient(135deg, ${hexToRgba(brandColor, 0.12)} 0%, ${hexToRgba("#a855f7", 0.14)} 100%)`,
                        }}
                      >
                        <p className="font-semibold" style={{ color: brandColor }}>Activated By</p>
                        <p className="mt-0.5 text-slate-700">{projectDetail.activatedBy?.name || projectDetail.activatedBy?.email || "-"}</p>
                      </div>
                      <div
                        className="rounded-lg border px-3 py-2 shadow-sm"
                        style={{
                          borderColor: hexToRgba(brandColor, 0.28),
                          background: `linear-gradient(135deg, ${hexToRgba(brandColor, 0.1)} 0%, ${hexToRgba("#f59e0b", 0.16)} 100%)`,
                        }}
                      >
                        <p className="font-semibold" style={{ color: brandColor }}>Date Created</p>
                        <p className="mt-0.5 text-slate-700">{new Date(projectDetail.createdAt).toLocaleDateString()}</p>
                      </div>
                      <div
                        className="rounded-lg border px-3 py-2 shadow-sm"
                        style={{
                          borderColor: hexToRgba(brandColor, 0.28),
                          background: `linear-gradient(135deg, ${hexToRgba(brandColor, 0.12)} 0%, ${hexToRgba("#10b981", 0.16)} 100%)`,
                        }}
                      >
                        <p className="font-semibold" style={{ color: brandColor }}>Project Status</p>
                        <p className="mt-0.5 text-slate-700">{projectDetail.status === "active" ? "Active" : "Complete"}</p>
                      </div>
                    </div>
                    <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white to-transparent" />
                    <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white to-transparent" />
                  </div>
                </div>
              </div>

              {isAdmin && projectDetail.status === "active" && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <input
                    value={newPageName}
                    onChange={(e) => setNewPageName(e.target.value)}
                    placeholder="New page name (e.g. Homepage)"
                    className="md:col-span-5 border border-gray-300 rounded-lg px-3 py-2"
                  />
                  <input
                    value={newPageFigmaLink}
                    onChange={(e) => setNewPageFigmaLink(e.target.value)}
                    placeholder="Optional Figma share link"
                    className="md:col-span-6 border border-gray-300 rounded-lg px-3 py-2"
                  />
                  <button
                    onClick={addPage}
                    type="button"
                    title="+ Add page"
                    className="md:col-span-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-white text-sm font-medium shadow-sm transition-all hover:scale-[1.02] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-1"
                    style={{
                      background: `linear-gradient(90deg, ${brandColor} 0%, #6366f1 65%, #22d3ee 100%)`,
                      border: `1px solid ${hexToRgba(brandColor, 0.42)}`,
                      boxShadow: `0 6px 14px ${hexToRgba(brandColor, 0.24)}`,
                    }}
                  >
                    <Plus className="h-4 w-4" strokeWidth={2.4} />
                    <span>Add page</span>
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                <div
                  className="rounded-lg p-3 md:col-span-1 md:sticky md:top-2 max-h-[62vh] overflow-y-auto shadow-sm"
                  style={{
                    border: `1px solid ${hexToRgba(brandColor, 0.2)}`,
                    background: `linear-gradient(165deg, ${hexToRgba(brandColor, 0.09)} 0%, #ffffff 60%)`,
                  }}
                >
                  <p className="text-xs font-semibold tracking-[0.08em] uppercase mb-2" style={{ color: brandColor }}>Pages</p>
                  <div className="space-y-2">
                    {projectDetail.pages.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedPageId(p.id)}
                        className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${selectedPageId === p.id ? "shadow-sm" : ""}`}
                        style={
                          selectedPageId === p.id
                            ? { borderColor: hexToRgba(brandColor, 0.36), backgroundColor: hexToRgba(brandColor, 0.14) }
                            : { borderColor: hexToRgba(brandColor, 0.14), backgroundColor: "rgba(255,255,255,0.92)" }
                        }
                      >
                        <p className="text-sm font-medium" style={{ color: selectedPageId === p.id ? brandColor : "#111827" }}>{p.pageName}</p>
                        <span
                          className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${pageStatusBadgeClass[p.status]}`}
                        >
                          {statusLabel[p.status]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  className="rounded-lg p-4 md:col-span-2 max-h-[62vh] overflow-y-auto shadow-sm"
                  style={{
                    border: `1px solid ${hexToRgba(brandColor, 0.2)}`,
                    background: `linear-gradient(170deg, ${hexToRgba(brandColor, 0.06)} 0%, #ffffff 34%)`,
                  }}
                >
                  {!selectedPage ? (
                    <p className="text-sm text-gray-500">Select a page.</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{selectedPage.pageName}</p>
                          {canManagePageStatus && projectDetail.status === "active" ? (
                            <select
                              value={selectedPage.status}
                              onChange={(e) => updatePageStatus(e.target.value as PageStatus)}
                              disabled={updatingStatus}
                              className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium bg-white ${pageStatusBadgeClass[selectedPage.status]} disabled:opacity-60`}
                            >
                              <option value="pending_upload">Pending Upload</option>
                              <option value="needs_review">Needs Review</option>
                              <option value="revision_requested">Revision Requested</option>
                              <option value="approved">Approved</option>
                            </select>
                          ) : (
                            <span
                              className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${pageStatusBadgeClass[selectedPage.status]}`}
                            >
                              {statusLabel[selectedPage.status]}
                            </span>
                          )}
                          {selectedPage.status === "approved" && selectedPage.approvedAt && (
                            <p className="mt-1 text-xs text-emerald-700">
                              Approved on {new Date(selectedPage.approvedAt).toLocaleString()}
                            </p>
                          )}
                          {selectedPage.figmaLink && (
                            <a
                              href={selectedPage.figmaLink}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-xs font-medium hover:opacity-90"
                              style={{ color: brandColor }}
                            >
                              Open Figma Link
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        {isDesignerOrAdmin && selectedPage.status !== "approved" && projectDetail.status === "active" && (
                          <div className="flex items-center gap-2">
                            <label
                              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer hover:opacity-90"
                              style={{
                                borderColor: hexToRgba(brandColor, 0.28),
                                backgroundColor: hexToRgba(brandColor, 0.08),
                                color: brandColor,
                              }}
                            >
                              <Upload className="h-4 w-4" />
                              Upload PDF
                              <input
                                type="file"
                                accept="application/pdf"
                                className="hidden"
                                disabled={uploading}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) uploadPdfVersion(file);
                                  e.currentTarget.value = "";
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={markPageReadyForReview}
                              disabled={markingReady || selectedPage.status === "needs_review" || selectedPage.versions.length === 0}
                              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                              style={{
                                background:
                                  selectedPage.status === "needs_review"
                                    ? "linear-gradient(90deg, #0ea5e9 0%, #2563eb 100%)"
                                    : `linear-gradient(90deg, ${brandColor} 0%, #6366f1 65%, #22d3ee 100%)`,
                                borderColor: hexToRgba(brandColor, 0.42),
                              }}
                            >
                              {selectedPage.status === "needs_review"
                                ? "Ready for Review"
                                : markingReady
                                ? "Marking..."
                                : "Mark Ready for Review"}
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-[0.08em] uppercase" style={{ color: brandColor }}>Page Details</p>
                        {isDesignerOrAdmin && projectDetail.status === "active" ? (
                          <div className="flex gap-2">
                            <input
                              value={figmaDraft}
                              onChange={(e) => setFigmaDraft(e.target.value)}
                              placeholder="Optional Figma share link"
                              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            />
                            <button
                              type="button"
                              onClick={savePageMeta}
                              className="rounded-lg text-white px-3 py-2 text-sm border shadow-sm hover:opacity-95"
                              style={{
                                background: `linear-gradient(90deg, ${brandColor} 0%, #6366f1 60%, #22d3ee 100%)`,
                                borderColor: hexToRgba(brandColor, 0.45),
                              }}
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">{selectedPage.figmaLink || "No Figma link added."}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-[0.08em] uppercase" style={{ color: brandColor }}>Current Design</p>
                        {!selectedVersion ? (
                          <p className="text-sm text-gray-500">No file uploaded yet.</p>
                        ) : (
                          <div className="space-y-2">
                            <div
                              className="rounded-lg border px-3 py-2 text-xs text-gray-700"
                              style={{
                                borderColor: hexToRgba(brandColor, 0.2),
                                background: `linear-gradient(135deg, ${hexToRgba(brandColor, 0.1)} 0%, ${hexToRgba("#e0f2fe", 0.9)} 100%)`,
                              }}
                            >
                              Viewing v{selectedVersion.versionNumber} uploaded{" "}
                              {new Date(selectedVersion.uploadedAt).toLocaleString()}
                            </div>
                            <iframe
                              title={`${selectedPage.pageName}-design-preview`}
                              src={selectedVersion.fileUrl}
                              className="w-full h-[480px] rounded-xl border border-indigo-100 bg-white"
                            />
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-[0.08em] uppercase" style={{ color: brandColor }}>Version History</p>
                        {selectedPage.versions.length === 0 ? (
                          <p className="text-sm text-gray-500">No file uploaded yet.</p>
                        ) : (
                          <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                            {versionList.map((v, idx) => (
                              <div
                                key={v.id}
                                className={`rounded-lg border px-3 py-2 ${
                                  selectedVersion?.id === v.id
                                    ? ""
                                    : "hover:bg-gray-50"
                                }`}
                                style={
                                  selectedVersion?.id === v.id
                                    ? { borderColor: hexToRgba(brandColor, 0.32), backgroundColor: hexToRgba(brandColor, 0.08) }
                                    : { borderColor: "rgb(229 231 235)" }
                                }
                              >
                                <button type="button" onClick={() => setSelectedVersionId(v.id)} className="w-full text-left">
                                  <p className="text-sm font-medium" style={{ color: brandColor }}>
                                    v{v.versionNumber} {idx === 0 ? "(Latest)" : ""}
                                  </p>
                                  <p className="text-xs text-gray-500">Uploaded {new Date(v.uploadedAt).toLocaleString()}</p>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-[0.08em] uppercase" style={{ color: brandColor }}>Comments</p>
                        <div
                          className="max-h-52 overflow-y-auto space-y-1.5 rounded-lg border-l-4 p-2.5 pr-1.5 shadow-sm"
                          style={{
                            borderColor: hexToRgba(brandColor, 0.2),
                            borderLeftColor: brandColor,
                            background: `linear-gradient(145deg, ${hexToRgba(brandColor, 0.08)} 0%, #ffffff 45%)`,
                          }}
                        >
                          {renderCommentTree()}
                          {selectedPage.comments.length === 0 && <p className="text-sm text-gray-500">No comments yet.</p>}
                        </div>
                      </div>

                      {selectedPage.status !== "approved" && (
                        <div className="space-y-2">
                          {isClient ? (
                            <>
                              <textarea
                                value={feedbackText}
                                onChange={(e) => setFeedbackText(e.target.value)}
                                placeholder="Share your revision requests..."
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={submitFeedback}
                                  className="inline-flex items-center gap-1 rounded-lg text-white px-3 py-2 text-sm border shadow-sm hover:opacity-95"
                                  style={{
                                    background: `linear-gradient(90deg, ${brandColor} 0%, #f59e0b 100%)`,
                                    borderColor: hexToRgba(brandColor, 0.4),
                                  }}
                                >
                                  <MessageSquare className="h-4 w-4" />
                                  Submit Feedback
                                </button>
                                <button
                                  onClick={() => setApproveModalOpen(true)}
                                  className="inline-flex items-center gap-1 rounded-lg text-white px-3 py-2 text-sm border shadow-sm hover:opacity-95"
                                  style={{
                                    background: `linear-gradient(90deg, ${brandColor} 0%, #10b981 100%)`,
                                    borderColor: hexToRgba(brandColor, 0.4),
                                  }}
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                  Approve Page
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] text-gray-500">
                                  Collaborators notified on every message: <span className="font-semibold text-gray-700">{selectedCollaborators.length}</span>
                                  {" "}• @mention adds collaborator
                                </p>
                                <button
                                  type="button"
                                  onClick={() => setCommentCollaboratorEditorOpen((prev) => !prev)}
                                  className="rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                                >
                                  {commentCollaboratorEditorOpen ? "Close collaborators" : "Edit collaborators"}
                                </button>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {selectedCollaborators.slice(0, 8).map((u) => (
                                  <span
                                    key={u.id}
                                    className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700"
                                  >
                                    {u.name || u.email}
                                  </span>
                                ))}
                                {selectedCollaborators.length > 8 && (
                                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                                    +{selectedCollaborators.length - 8}
                                  </span>
                                )}
                              </div>
                              {commentCollaboratorEditorOpen && (
                                <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
                                  <input
                                    value={commentCollaboratorSearch}
                                    onChange={(e) => setCommentCollaboratorSearch(e.target.value)}
                                    placeholder="Add collaborators by name or email..."
                                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs"
                                  />
                                  <div className="max-h-40 overflow-y-auto space-y-1">
                                    {commentCollaboratorSearchResults.map((member) => {
                                      const selected = selectedCollaboratorIds.includes(member.id);
                                      return (
                                        <button
                                          key={member.id}
                                          type="button"
                                          onClick={() => {
                                            const nextIds = selected
                                              ? selectedCollaboratorIds.filter((id) => id !== member.id)
                                              : [...new Set([...selectedCollaboratorIds, member.id])];
                                            persistCollaborators(nextIds);
                                          }}
                                          className={`w-full rounded-md px-2 py-1.5 text-left text-xs ${
                                            selected ? "bg-primary-50 text-primary-700" : "hover:bg-gray-50 text-gray-700"
                                          }`}
                                        >
                                          <span className="font-medium">{member.name || member.email}</span>
                                          <span className="ml-1 text-gray-500">({member.email})</span>
                                        </button>
                                      );
                                    })}
                                    {commentCollaboratorSearchResults.length === 0 && (
                                      <p className="px-1 py-2 text-xs text-gray-500">No collaborators found.</p>
                                    )}
                                  </div>
                                </div>
                              )}
                              <div className="relative flex gap-2">
                                <textarea
                                  ref={commentInputRef}
                                  value={newComment}
                                  onChange={handleCommentChange}
                                  onKeyDown={handleCommentMentionKeyDown}
                                  placeholder="Write a comment... Use @ to mention a user."
                                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[42px]"
                                />
                                {commentMentionRange && commentMentionSuggestions.length > 0 && (
                                  <div className="absolute left-0 right-24 top-full z-20 mt-1 max-h-44 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                                    {commentMentionSuggestions.map((member, idx) => (
                                      <button
                                        key={member.id}
                                        type="button"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => handleSelectCommentMention(member)}
                                        className={`w-full px-3 py-2 text-left text-xs ${
                                          idx === commentMentionActiveIndex ? "bg-primary-50" : "hover:bg-gray-50"
                                        }`}
                                      >
                                        <p className="font-medium text-gray-800">{member.name || member.email}</p>
                                        <p className="text-[11px] text-gray-500">{member.email}</p>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              <button
                                onClick={() => postComment(newComment)}
                                className="rounded-lg border px-3 py-2 text-sm text-white shadow-sm hover:opacity-95"
                                style={{
                                  background: `linear-gradient(90deg, ${brandColor} 0%, #6366f1 65%, #22d3ee 100%)`,
                                  borderColor: hexToRgba(brandColor, 0.42),
                                }}
                              >
                                Post
                              </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        isOpen={approveModalOpen}
        onClose={() => setApproveModalOpen(false)}
        onConfirm={approvePage}
        title="Approve this page?"
        message={`Approve "${selectedPage?.pageName || "this page"}"? This action is irreversible.`}
        confirmText="Approve Page"
        cancelText="Cancel"
        variant="warning"
      />
      <ConfirmDialog
        isOpen={deleteProjectModalOpen}
        onClose={() => setDeleteProjectModalOpen(false)}
        onConfirm={deleteProject}
        title="Delete this project?"
        message={`Delete "${projectDetail?.projectName || "this project"}"? This will permanently remove all pages, versions, and comments.`}
        confirmText="Delete Project"
        cancelText="Cancel"
        variant="danger"
        requireConfirmText="DELETE"
      />
    </div>
  );
}

