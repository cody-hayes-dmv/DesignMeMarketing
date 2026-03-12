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

type WebDesignProjectDetail = WebDesignProject & { pages: WebDesignPage[] };
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
  const [projects, setProjects] = useState<WebDesignProject[]>([]);
  const [projectDetail, setProjectDetail] = useState<WebDesignProjectDetail | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [designers, setDesigners] = useState<Array<{ id: string; name: string | null; email: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [activateClientId, setActivateClientId] = useState(clientId || "");
  const [activateDesignerId, setActivateDesignerId] = useState("");
  const [newPageName, setNewPageName] = useState("");
  const [newPageFigmaLink, setNewPageFigmaLink] = useState("");
  const [newComment, setNewComment] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [openReplyForId, setOpenReplyForId] = useState<string | null>(null);
  const [figmaDraft, setFigmaDraft] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [projectStatusFilter, setProjectStatusFilter] = useState<ProjectStatus>("active");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectSort, setProjectSort] = useState<"newest" | "oldest" | "client_az" | "project_az">("newest");
  const [uploading, setUploading] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const appliedRequestedPageRef = useRef<string | null>(null);
  const selectedPageIdRef = useRef<string | null>(null);

  const isAdmin = ["SUPER_ADMIN", "ADMIN", "AGENCY"].includes(user?.role || "");
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

  const shellClass = embedded ? "space-y-5 rounded-xl p-4" : "min-h-screen p-8 space-y-5";
  const shellStyle = {
    border: embedded ? `1px solid ${hexToRgba(brandColor, 0.2)}` : undefined,
    background: `linear-gradient(180deg, ${hexToRgba(brandColor, embedded ? 0.08 : 0.06)} 0%, #ffffff 50%)`,
  };
  const accentButtonStyle = {
    backgroundColor: brandColor,
    borderColor: brandColor,
  };
  const accentSoftStyle = {
    backgroundColor: hexToRgba(brandColor, 0.1),
    borderColor: hexToRgba(brandColor, 0.22),
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

  useEffect(() => {
    loadProjects();
  }, [clientId, requestedProjectId, projectStatusFilter]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectDetail(null);
      setSelectedPageId(null);
      setSelectedVersionId(null);
      return;
    }
    loadProjectDetail(selectedProjectId);
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
        setClients(rows.map((c: any) => ({ id: c.id, name: c.name })));
      })
      .catch(() => setClients([]));
    api.get("/web-design/designers")
      .then((res) => {
        setDesigners(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => setDesigners([]));
  }, [isAdmin]);

  const activateProject = async () => {
    if (!projectName.trim() || !activateClientId || !activateDesignerId) {
      toast.error("Project name, client, and designer are required");
      return;
    }
    try {
      await api.post("/web-design/projects/activate", {
        projectName: projectName.trim(),
        clientId: activateClientId,
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

  const postComment = async (message: string, parentId?: string | null) => {
    if (!selectedPage || !message.trim()) return;
    try {
      await api.post(`/web-design/pages/${selectedPage.id}/comments`, {
        message: message.trim(),
        ...(parentId ? { parentId } : {}),
      });
      if (parentId) {
        setReplyDrafts((prev) => ({ ...prev, [parentId]: "" }));
        setOpenReplyForId(null);
      } else {
        setNewComment("");
      }
      if (selectedProjectId) await loadProjectDetail(selectedProjectId);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to post comment");
    }
  };

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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Project name"
              className="border border-gray-300 rounded-lg px-3 py-2"
            />
            <select
              value={activateClientId}
              onChange={(e) => setActivateClientId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2"
            >
              <option value="">Select client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={activateDesignerId}
              onChange={(e) => setActivateDesignerId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2"
            >
              <option value="">Select designer</option>
              {designers.map((d) => (
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
                  <th className="px-3 py-2 font-medium">Client</th>
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
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{p.client?.name || "Client"}</td>
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
                  <button onClick={addPage} className="md:col-span-1 rounded-lg text-white px-3 py-2" style={accentButtonStyle}>
                    <Plus className="h-4 w-4" />
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
                          <span
                            className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${pageStatusBadgeClass[selectedPage.status]}`}
                          >
                            {statusLabel[selectedPage.status]}
                          </span>
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
                          className="max-h-52 overflow-y-auto space-y-1.5 rounded-lg border bg-white/80 p-2 pr-1"
                          style={{ borderColor: hexToRgba(brandColor, 0.16) }}
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
                            <div className="flex gap-2">
                              <input
                                value={newComment}
                                onChange={(e) => setNewComment(e.target.value)}
                                placeholder="Leave a comment"
                                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                              />
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
    </div>
  );
}

