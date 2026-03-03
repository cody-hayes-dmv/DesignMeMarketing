import { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useLocation } from "react-router-dom";
import { RootState } from "@/store";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { CheckCircle2, MessageSquare, Plus, Upload } from "lucide-react";

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
  authorRole: "client" | "designer" | "admin";
  createdAt: string;
};

type WebDesignPage = {
  id: string;
  pageName: string;
  status: PageStatus;
  approvedAt?: string | null;
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
  const [newComment, setNewComment] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
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

  const loadProjects = async () => {
    setLoading(true);
    try {
      const res = await api.get("/web-design/projects");
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
  }, [clientId, requestedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectDetail(null);
      setSelectedPageId(null);
      return;
    }
    loadProjectDetail(selectedProjectId);
  }, [selectedProjectId, requestedPageId]);

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
      await api.post(`/web-design/projects/${selectedProjectId}/pages`, { pageName: newPageName.trim() });
      setNewPageName("");
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

  const postComment = async () => {
    if (!selectedPage || !newComment.trim()) return;
    try {
      await api.post(`/web-design/pages/${selectedPage.id}/comments`, { message: newComment.trim() });
      setNewComment("");
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
      await loadProjects();
      await loadProjectDetail(selectedProjectId);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to complete project");
    }
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
          <div className="space-y-2">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProjectId(p.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left ${
                  selectedProjectId === p.id ? "border-primary-300 bg-primary-50" : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <p className="font-medium text-sm text-gray-900">{p.projectName}</p>
                <p className="text-xs text-gray-500">{p.client?.name || "Client"}</p>
                <p className="mt-1 text-[11px] text-gray-500">
                  {(p.pages || []).filter((pg) => pg.status === "approved").length}/{(p.pages || []).length} pages approved
                </p>
              </button>
            ))}
            {projects.length === 0 && <p className="text-sm text-gray-500">No web design projects yet.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
          {!projectDetail ? (
            <p className="text-sm text-gray-500">Select a project to view details.</p>
          ) : (
            <div className="space-y-4">
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
                {isAdmin && projectDetail.status === "active" && (
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
                <div className="flex gap-2">
                  <input
                    value={newPageName}
                    onChange={(e) => setNewPageName(e.target.value)}
                    placeholder="New page name (e.g. Homepage)"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2"
                  />
                  <button onClick={addPage} className="rounded-lg bg-primary-600 text-white px-3 py-2 hover:bg-primary-700">
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
                        <p className="text-sm font-medium">Version History</p>
                        {selectedPage.versions.length === 0 ? (
                          <p className="text-sm text-gray-500">No file uploaded yet.</p>
                        ) : (
                          <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                            {[...selectedPage.versions].reverse().map((v, idx) => (
                              <a
                                key={v.id}
                                href={v.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="block rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50"
                              >
                                <p className="text-sm font-medium text-primary-700">
                                  v{v.versionNumber} {idx === 0 ? "(Current)" : ""}
                                </p>
                                <p className="text-xs text-gray-500">
                                  Uploaded {new Date(v.uploadedAt).toLocaleString()}
                                </p>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className="text-sm font-medium">Comments</p>
                        <div className="max-h-44 overflow-y-auto space-y-2 pr-1">
                          {selectedPage.comments.map((c) => (
                            <div key={c.id} className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                              <div className="flex items-center justify-between">
                                <p className="text-xs text-gray-500 capitalize">{c.authorRole}</p>
                                <p className="text-[11px] text-gray-400">{new Date(c.createdAt).toLocaleString()}</p>
                              </div>
                              <p className="text-sm text-gray-800">{c.message}</p>
                            </div>
                          ))}
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
                                onClick={postComment}
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

