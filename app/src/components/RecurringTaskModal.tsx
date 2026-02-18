import React, { useState, useEffect, useRef } from "react";
import DatePicker from "react-datepicker";
import { useDispatch, useSelector } from "react-redux";
import { Upload, X, Image, Video, Link as LinkIcon, Plus, Repeat } from "lucide-react";
import api from "@/lib/api";
import { RootState } from "@/store";
import { fetchClients } from "@/store/slices/clientSlice";
import { fetchTasks } from "@/store/slices/taskSlice";
import { ProofItem } from "@/store/slices/taskSlice";
import toast from "react-hot-toast";
import "react-datepicker/dist/react-datepicker.css";

const FREQUENCIES = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "SEMIANNUAL", label: "Every 6 months" },
] as const;

type TaskStatus = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE";

export type RecurringRuleForEdit = {
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
  proof?: unknown;
};

interface RecurringTaskModalProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  onSaved?: () => void;
  rule?: RecurringRuleForEdit | null;
  /** When opening for "add", prefill client (e.g. from Work Log on a client dashboard). */
  defaultClientId?: string;
}

const RecurringTaskModal: React.FC<RecurringTaskModalProps> = ({ open, setOpen, onSaved, rule, defaultClientId }) => {
  const isEdit = Boolean(rule?.id);
  const dispatch = useDispatch();
  const { clients } = useSelector((state: RootState) => state.client);
  const [assignableUsers, setAssignableUsers] = useState<Array<{ id: string; name: string | null; email: string; role?: string }>>([]);
  const [assignableLoading, setAssignableLoading] = useState(false);
  const [assignableSearch, setAssignableSearch] = useState("");
  const [assignToOpen, setAssignToOpen] = useState(false);
  const [assigneeDisplay, setAssigneeDisplay] = useState("");
  const assignToRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "",
    status: "TODO" as TaskStatus,
    priority: "",
    estimatedHours: "",
    assigneeId: "",
    clientId: "",
    frequency: "WEEKLY" as "WEEKLY" | "MONTHLY" | "QUARTERLY" | "SEMIANNUAL",
    firstRunAt: new Date(),
  });
  const [proof, setProof] = useState<ProofItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlType, setUrlType] = useState<"image" | "video" | "url">("url");
  const [submitting, setSubmitting] = useState(false);

  const sortedClients = React.useMemo(
    () => [...clients].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })),
    [clients]
  );

  useEffect(() => {
    if (open && clients.length === 0) {
      dispatch(fetchClients() as any);
    }
  }, [open, clients.length, dispatch]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAssignableLoading(true);
    api.get("/tasks/assignable-users", { params: assignableSearch.trim() ? { search: assignableSearch.trim() } : {} })
      .then((res) => {
        if (!cancelled && Array.isArray(res.data)) setAssignableUsers(res.data);
      })
      .catch(() => { if (!cancelled) setAssignableUsers([]); })
      .finally(() => { if (!cancelled) setAssignableLoading(false); });
    return () => { cancelled = true; };
  }, [open, assignableSearch]);

  useEffect(() => {
    if (!assignToOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (assignToRef.current && !assignToRef.current.contains(e.target as Node)) setAssignToOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [assignToOpen]);

  useEffect(() => {
    if (open && rule?.id) {
      const proofList = Array.isArray(rule.proof) ? rule.proof : typeof rule.proof === "string" ? (() => { try { const p = JSON.parse(rule.proof); return Array.isArray(p) ? p : []; } catch { return []; } })() : [];
      setForm({
        title: rule.title,
        description: rule.description ?? "",
        category: rule.category ?? "",
        status: (rule.status as TaskStatus) ?? "TODO",
        priority: rule.priority ?? "",
        estimatedHours: rule.estimatedHours != null ? String(rule.estimatedHours) : "",
        assigneeId: rule.assigneeId ?? "",
        clientId: rule.clientId ?? "",
        frequency: (rule.frequency as "WEEKLY" | "MONTHLY" | "QUARTERLY" | "SEMIANNUAL") || "WEEKLY",
        firstRunAt: new Date(rule.nextRunAt),
      });
      setProof(proofList as ProofItem[]);
      setAssigneeDisplay("");
    } else if (open && defaultClientId) {
      setForm((prev) => ({ ...prev, clientId: defaultClientId }));
    }
  }, [open, rule, defaultClientId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) formData.append("files", files[i]);
      const response = await api.post("/upload/multiple", formData);
      const uploadedFiles = Array.isArray(response.data) ? response.data : [response.data];
      setProof((prev) => [...prev, ...uploadedFiles]);
      toast.success("Files uploaded successfully!");
    } catch {
      // Toast from API interceptor
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleAddUrl = () => {
    if (!urlInput.trim()) return;
    try {
      new URL(urlInput);
      setProof((prev) => [...prev, { type: urlType, value: urlInput.trim(), name: urlInput.trim() }]);
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
    const firstRunAt = form.firstRunAt;
    const dayOfWeek = firstRunAt.getDay();
    const dayOfMonth = firstRunAt.getDate();
    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description || undefined,
      category: form.category || undefined,
      status: form.status,
      priority: form.priority || undefined,
      estimatedHours: form.estimatedHours ? parseInt(form.estimatedHours, 10) : undefined,
      assigneeId: form.assigneeId || undefined,
      clientId: form.clientId || undefined,
      proof: proof.length > 0 ? proof : [],
      frequency: form.frequency,
      dayOfWeek: form.frequency === "WEEKLY" ? dayOfWeek : undefined,
      dayOfMonth: form.frequency !== "WEEKLY" ? dayOfMonth : undefined,
      firstRunAt: firstRunAt.toISOString(),
    };
    if (isEdit && rule?.id) {
      (payload as Record<string, string>).nextRunAt = firstRunAt.toISOString();
      delete (payload as Record<string, unknown>).firstRunAt;
    }
    setSubmitting(true);
    try {
      if (isEdit && rule?.id) {
        await api.put(`/tasks/recurring/${rule.id}`, payload);
        toast.success("Recurring task updated.");
      } else {
        await api.post("/tasks/recurring", payload);
        toast.success("Recurring task created. A new task will be created on the schedule you chose.");
      }
      dispatch(fetchTasks() as any);
      onSaved?.();
      setOpen(false);
      setForm({
        title: "",
        description: "",
        category: "",
        status: "TODO",
        priority: "",
        estimatedHours: "",
        assigneeId: "",
        clientId: "",
        frequency: "WEEKLY",
        firstRunAt: new Date(),
      });
      setProof([]);
      setAssigneeDisplay("");
      setUrlInput("");
    } catch (err: any) {
      toast.error(err?.response?.data?.message || (isEdit ? "Failed to update recurring task" : "Failed to create recurring task"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl ring-1 ring-gray-200/80 max-h-[calc(100vh-2rem)] flex flex-col">
          <div className="flex items-center justify-between px-6 py-5 bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 text-white rounded-t-2xl border-b-2 border-indigo-500/50 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm">
                <Repeat className="h-5 w-5" />
              </div>
              <h2 className="text-lg sm:text-xl font-bold drop-shadow-sm">{isEdit ? "Edit Recurring Task" : "Add Recurring Task"}</h2>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 bg-gray-50/50">
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
                  Recurrence
                </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Recurrence</label>
                  <select
                    value={form.frequency}
                    onChange={(e) => setForm({ ...form, frequency: e.target.value as typeof form.frequency })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">First Run Date</label>
                  <DatePicker
                    selected={form.firstRunAt}
                    onChange={(date) => date && setForm({ ...form, firstRunAt: date })}
                    minDate={new Date()}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholderText="Select date"
                  />
                </div>
              </div>
              </section>
              <section className="rounded-xl border-l-4 border-amber-500 bg-amber-50/50 p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-amber-900 mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Assignment
                </h3>
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
                            {u.role && <span className="text-xs text-gray-500 ml-2">{u.role.replace("_", " ")}</span>}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
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
              </section>
              <section className="rounded-xl border-l-4 border-indigo-500 bg-indigo-50/50 p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-indigo-900 mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  Priority & Time
                </h3>
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
                    min={0}
                  />
                </div>
              </div>
              </section>
              <section className="rounded-xl border-l-4 border-violet-500 bg-violet-50/50 p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-violet-900 mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                  Proof / Attachments
                </h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Proof / Attachments</label>
                <div className="mb-4">
                  <label className="flex items-center justify-center w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-500 transition-colors">
                    <div className="flex flex-col items-center">
                      <Upload className="h-6 w-6 text-gray-400 mb-2" />
                      <span className="text-sm text-gray-600">
                        {uploading ? "Uploading..." : "Click to upload images or videos"}
                      </span>
                      <span className="text-xs text-gray-500 mt-1">PNG, JPG, GIF, MP4, WebM (max 50MB)</span>
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
                            <div className="text-sm font-medium text-gray-900 truncate">{item.name || item.value}</div>
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
              </section>
            </div>
          </div>
          <div className="flex-shrink-0 flex justify-end gap-3 px-5 py-4 border-t border-gray-200 bg-gray-100/80 rounded-b-2xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-4 py-2.5 border border-gray-300 bg-white rounded-xl text-gray-700 hover:bg-gray-50 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-md hover:shadow-lg disabled:opacity-50 transition-all"
            >
              {submitting ? (isEdit ? "Saving…" : "Creating…") : (isEdit ? "Update" : "Create")}
            </button>
          </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default RecurringTaskModal;
