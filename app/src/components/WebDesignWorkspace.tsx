import { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useLocation } from "react-router-dom";
import { RootState } from "@/store";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { CheckCircle2, ExternalLink, Lock, MessageSquare, Plus, Upload } from "lucide-react";

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

const statusLabel: Record<PageStatus, string> = {
  pending_upload: "Pending Upload",
  needs_review: "Needs Review",
  revision_requested: "Revision Requested",
  approved: "Approved",
};

const pageStatusBadgeClass: Record<PageStatus, string> = {
  pending_upload: "bg-gray-100 text-gray-700 border-gray-200",
  needs_review: "bg-blue-100 text-blue-700 border-blue-200",
  revision_requested: "bg-amber-100 text-amber-700 border-amber-200",
  approved: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

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
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [projectStatusFilter, setProjectStatusFilter] = useState<ProjectStatus>("active");
  const [uploading, setUploading] = useState(false);

  const isAdmin = ["SUPER_ADMIN", "ADMIN", "AGENCY"].includes(user?.role || "");
  const isClient = user?.role === "USER";
  const isDesignerOrAdmin = isAdmin || user?.role === "DESIGNER";
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedProjectId = initialProjectId || searchParams.get("projectId") || null;
  const requestedPageId = initialPageId || searchParams.get("pageId") || null;

  const selectedPage = useMemo(
    () => projectDetail?.pages.find((p) => p.id === selectedPageId) || null,
    [projectDetail, selectedPageId]
  );
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

  const loadProjectDetail = async (projectId: string) => {
    try {
      const res = await api.get(`/web-design/projects/${projectId}`);
      const detail = res.data as WebDesignProjectDetail;
      setProjectDetail(detail);
      if (requestedPageId && detail.pages.some((p) => p.id === requestedPageId)) {
        setSelectedPageId(requestedPageId);
      } else if (!selectedPageId || !detail.pages.some((p) => p.id === selectedPageId)) {
        setSelectedPageId(detail.pages[0]?.id || null);
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to load project details");
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
    if (!versionList.length) {
      setSelectedVersionId(null);
      return;
    }
    if (!selectedVersionId || !versionList.some((v) => v.id === selectedVersionId)) {
      setSelectedVersionId(versionList[0].id);
    }
  }, [versionList, selectedVersionId]);

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
    if (!window.confirm("Approve this page? This action is irreversible.")) return;
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

  const renderCommentTree = (parentId: string | null = null, depth = 0): JSX.Element[] => {
    const key = parentId || "root";
    const comments = commentsByParent[key] || [];
    return comments.map((c) => (
      <div key={c.id} className="space-y-2" style={{ marginLeft: depth > 0 ? `${Math.min(depth, 4) * 16}px` : 0 }}>
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              <span className="font-medium text-gray-600">{c.author?.name || c.author?.email || "Unknown"}</span>
              {" · "}
              <span className="capitalize">{c.authorRole}</span>
            </p>
            <p className="text-[11px] text-gray-400">{new Date(c.createdAt).toLocaleString()}</p>
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.message}</p>
          {selectedPage?.status !== "approved" && (
            <button
              type="button"
              onClick={() => setOpenReplyForId((prev) => (prev === c.id ? null : c.id))}
              className="mt-2 text-xs font-medium text-primary-700 hover:text-primary-800"
            >
              Reply
            </button>
          )}
        </div>
        {openReplyForId === c.id && selectedPage?.status !== "approved" && (
          <div className="flex gap-2">
            <input
              value={replyDrafts[c.id] || ""}
              onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))}
              placeholder="Write a reply"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => postComment(replyDrafts[c.id] || "", c.id)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
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
    <div className={embedded ? "space-y-6" : "min-h-screen bg-gray-50 p-8 space-y-6"}>
      {!embedded && <h1 className="text-2xl font-bold text-gray-900">Web Design</h1>}

      {isAdmin && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <h2 className="font-semibold text-gray-900">Activate Project</h2>
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
              className="rounded-lg bg-primary-600 text-white px-4 py-2 hover:bg-primary-700"
            >
              Activate
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Projects</h2>
            {loading && <span className="text-xs text-gray-500">Loading...</span>}
          </div>
          <div className="mb-3 inline-flex rounded-lg border border-gray-200 p-1">
            <button
              type="button"
              onClick={() => setProjectStatusFilter("active")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                projectStatusFilter === "active" ? "bg-primary-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Active Projects
            </button>
            <button
              type="button"
              onClick={() => setProjectStatusFilter("complete")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                projectStatusFilter === "complete" ? "bg-primary-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Past Projects
            </button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Client</th>
                  <th className="px-3 py-2 font-medium">Project</th>
                  <th className="px-3 py-2 font-medium">Designer</th>
                  <th className="px-3 py-2 font-medium">Activated By</th>
                  <th className="px-3 py-2 font-medium">Total Pages</th>
                  <th className="px-3 py-2 font-medium">Pages Approved</th>
                  <th className="px-3 py-2 font-medium">{projectStatusFilter === "active" ? "Started" : "Completed"}</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const approved = (p.pages || []).filter((pg) => pg.status === "approved").length;
                  const total = (p.pages || []).length;
                  const isSelected = selectedProjectId === p.id;
                  const dateValue = projectStatusFilter === "active" ? p.createdAt : p.completedAt || p.createdAt;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedProjectId(p.id)}
                      className={`cursor-pointer border-t border-gray-100 ${
                        isSelected ? "bg-primary-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <td className="px-3 py-2 text-gray-700">{p.client?.name || "Client"}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{p.projectName}</td>
                      <td className="px-3 py-2 text-gray-700">{p.designer?.name || p.designer?.email || "-"}</td>
                      <td className="px-3 py-2 text-gray-700">{p.activatedBy?.name || p.activatedBy?.email || "-"}</td>
                      <td className="px-3 py-2 text-gray-700">{total}</td>
                      <td className="px-3 py-2 text-gray-700">{approved}</td>
                      <td className="px-3 py-2 text-gray-600">{new Date(dateValue || Date.now()).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {projects.length === 0 && (
              <p className="p-3 text-sm text-gray-500">
                {projectStatusFilter === "active" ? "No active web design projects." : "No completed web design projects."}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
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
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{projectDetail.projectName}</h2>
                  <p className="text-sm text-gray-500">
                    {projectDetail.client?.name} - {projectDetail.status === "active" ? "Active" : "Complete"}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {approvedPagesCount}/{projectDetail.pages.length} pages approved
                  </p>
                </div>
                {isAdmin &&
                  projectDetail.status === "active" &&
                  projectDetail.pages.length > 0 &&
                  approvedPagesCount === projectDetail.pages.length && (
                  <button
                    type="button"
                    onClick={completeProject}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    Mark Project Complete
                  </button>
                  )}
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
                  <button onClick={addPage} className="md:col-span-1 rounded-lg bg-primary-600 text-white px-3 py-2 hover:bg-primary-700">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                <div className="border border-gray-200 rounded-lg p-3 md:col-span-1 md:sticky md:top-2 max-h-[62vh] overflow-y-auto">
                  <p className="text-sm font-medium mb-2">Pages</p>
                  <div className="space-y-2">
                    {projectDetail.pages.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedPageId(p.id)}
                        className={`w-full text-left rounded-lg border px-3 py-2 ${
                          selectedPageId === p.id ? "border-primary-300 bg-primary-50" : "border-gray-200"
                        }`}
                      >
                        <p className="text-sm font-medium">{p.pageName}</p>
                        <span
                          className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${pageStatusBadgeClass[p.status]}`}
                        >
                          {statusLabel[p.status]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border border-gray-200 rounded-lg p-3 md:col-span-2 max-h-[62vh] overflow-y-auto">
                  {!selectedPage ? (
                    <p className="text-sm text-gray-500">Select a page.</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{selectedPage.pageName}</p>
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
                              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:text-primary-800"
                            >
                              Open Figma Link
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        {isDesignerOrAdmin && selectedPage.status !== "approved" && projectDetail.status === "active" && (
                          <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
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
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className="text-sm font-medium">Current Design</p>
                        {!selectedVersion ? (
                          <p className="text-sm text-gray-500">No file uploaded yet.</p>
                        ) : (
                          <div className="space-y-2">
                            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                              Viewing v{selectedVersion.versionNumber} uploaded{" "}
                              {new Date(selectedVersion.uploadedAt).toLocaleString()}
                            </div>
                            <iframe
                              title={`${selectedPage.pageName}-design-preview`}
                              src={selectedVersion.fileUrl}
                              className="w-full h-[480px] rounded-lg border border-gray-200 bg-white"
                            />
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className="text-sm font-medium">Version History</p>
                        {selectedPage.versions.length === 0 ? (
                          <p className="text-sm text-gray-500">No file uploaded yet.</p>
                        ) : (
                          <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                            {versionList.map((v, idx) => (
                              <div
                                key={v.id}
                                className={`rounded-lg border px-3 py-2 ${
                                  selectedVersion?.id === v.id
                                    ? "border-primary-300 bg-primary-50"
                                    : "border-gray-200 hover:bg-gray-50"
                                }`}
                              >
                                <button type="button" onClick={() => setSelectedVersionId(v.id)} className="w-full text-left">
                                  <p className="text-sm font-medium text-primary-700">
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
                        <p className="text-sm font-medium">Comments</p>
                        <div className="max-h-44 overflow-y-auto space-y-2 pr-1">
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
                                  className="inline-flex items-center gap-1 rounded-lg bg-amber-600 text-white px-3 py-2 text-sm hover:bg-amber-700"
                                >
                                  <MessageSquare className="h-4 w-4" />
                                  Submit Feedback
                                </button>
                                <button
                                  onClick={approvePage}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm hover:bg-emerald-700"
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
                                className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
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
    </div>
  );
}

