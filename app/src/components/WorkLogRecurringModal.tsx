import React, { useState, useEffect, useRef } from "react";
import { X, Upload, Plus, Loader2, Image, Video, Link as LinkIcon } from "lucide-react";
import api, { getUploadFileUrl } from "@/lib/api";
import toast from "react-hot-toast";

const FREQUENCIES = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "SEMIANNUAL", label: "Every 6 months" },
] as const;

type TaskStatus = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE";
type WorkLogAttachment = { type: string; value: string; name?: string };

export type WorkLogRecurringRuleForEdit = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  status?: string;
  assigneeId?: string | null;
  clientId?: string | null;
  frequency: string;
  nextRunAt: string;
  proof?: unknown;
};

interface WorkLogRecurringModalProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  onSaved?: () => void;
  clientId: string;
  rule?: WorkLogRecurringRuleForEdit | null;
}

const WorkLogRecurringModal: React.FC<WorkLogRecurringModalProps> = ({
  open,
  setOpen,
  onSaved,
  clientId,
  rule,
}) => {
  const isEdit = Boolean(rule?.id);
  const [assignableUsers, setAssignableUsers] = useState<Array<{ id: string; name: string | null; email: string; role: string }>>([]);
  const [assignableLoading, setAssignableLoading] = useState(false);
  const [assignableSearch, setAssignableSearch] = useState("");
  const [assignToOpen, setAssignToOpen] = useState(false);
  const [assigneeDisplay, setAssigneeDisplay] = useState("");
  const assignToRef = useRef<HTMLDivElement>(null);
  const taskNotesRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    title: "",
    category: "",
    taskNotes: "",
    dueDate: "",
    assigneeId: "",
    status: "TODO" as TaskStatus,
    frequency: "WEEKLY" as (typeof FREQUENCIES)[number]["value"],
    attachments: [] as WorkLogAttachment[],
  });
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlType, setUrlType] = useState<"image" | "video" | "url">("url");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAssignableLoading(true);
    api
      .get("/tasks/assignable-users", { params: assignableSearch.trim() ? { search: assignableSearch.trim() } : {} })
      .then((res) => {
        if (!cancelled && Array.isArray(res.data)) setAssignableUsers(res.data);
      })
      .catch(() => { if (!cancelled) setAssignableUsers([]); })
      .finally(() => { if (!cancelled) setAssignableLoading(false); });
    return () => { cancelled = true; };
  }, [open, assignableSearch]);

  useEffect(() => {
    if (open && rule?.id) {
      const proofList = Array.isArray(rule.proof)
        ? rule.proof
        : typeof rule.proof === "string"
          ? (() => {
              try {
                const p = JSON.parse(rule.proof);
                return Array.isArray(p) ? p : [];
              } catch {
                return [];
              }
            })()
          : [];
      setForm({
        title: rule.title,
        category: rule.category ?? "",
        taskNotes: (rule.description ?? "").trim(),
        dueDate: rule.nextRunAt ? new Date(rule.nextRunAt).toISOString().slice(0, 10) : "",
        assigneeId: rule.assigneeId ?? "",
        status: (rule.status as TaskStatus) ?? "TODO",
        frequency: (rule.frequency as (typeof FREQUENCIES)[number]["value"]) || "WEEKLY",
        attachments: proofList.map((p: { type?: string; value: string; name?: string }) => ({
          type: p.type ?? "url",
          value: p.value,
          name: p.name,
        })),
      });
      setAssigneeDisplay("");
      requestAnimationFrame(() => {
        if (taskNotesRef.current) taskNotesRef.current.innerHTML = (rule.description ?? "").trim();
      });
    } else if (open) {
      setForm({
        title: "",
        category: "",
        taskNotes: "",
        dueDate: "",
        assigneeId: "",
        status: "TODO",
        frequency: "WEEKLY",
        attachments: [],
      });
      setAssigneeDisplay("");
      setUrlInput("");
      requestAnimationFrame(() => {
        if (taskNotesRef.current) taskNotesRef.current.innerHTML = "";
      });
    }
  }, [open, rule]);

  useEffect(() => {
    if (!assignToOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (assignToRef.current && !assignToRef.current.contains(e.target as Node)) setAssignToOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [assignToOpen]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) formData.append("files", files[i]);
      const response = await api.post("/upload/worklog", formData);
      const uploaded = Array.isArray(response.data) ? response.data : [response.data];
      const items: WorkLogAttachment[] = uploaded
        .filter((raw: { value?: string; name?: string }) => raw && typeof raw.value === "string")
        .map((raw: { value: string; name?: string }) => ({ type: "url", value: raw.value, name: raw.name }));
      if (items.length > 0) {
        setForm((prev) => ({ ...prev, attachments: [...prev.attachments, ...items] }));
        toast.success(items.length === 1 ? "File uploaded." : "Files uploaded.");
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Upload failed.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const addUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    try {
      new URL(trimmed);
      setForm((prev) => ({
        ...prev,
        attachments: [...prev.attachments, { type: urlType, value: trimmed, name: trimmed }],
      }));
      setUrlInput("");
      toast.success("URL added.");
    } catch {
      toast.error("Please enter a valid URL.");
    }
  };

  const removeAttachment = (index: number) => {
    setForm((prev) => ({ ...prev, attachments: prev.attachments.filter((_, i) => i !== index) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const titleTrim = form.title.trim();
    if (!titleTrim) {
      toast.error("Title is required.");
      return;
    }
    const taskNotes = (taskNotesRef.current?.innerHTML ?? "").trim() || undefined;
    const firstRunAt = form.dueDate ? new Date(form.dueDate) : new Date();
    const apiOrigin =
      typeof window !== "undefined" && api.defaults.baseURL
        ? new URL(api.defaults.baseURL).origin
        : typeof window !== "undefined"
          ? window.location.origin
          : "";
    const proof = form.attachments
      .filter((a) => a?.value?.trim())
      .map((a) => {
        let value = a.value.trim();
        if (!value.startsWith("http")) value = value.startsWith("/") ? `${apiOrigin}${value}` : `${apiOrigin}/${value}`;
        return { type: a.type === "video" ? "video" : a.type === "image" ? "image" : "url", value, name: a.name };
      })
      .filter((a) => /^https?:\/\//.test(a.value));

    const dayOfWeek = firstRunAt.getDay();
    const dayOfMonth = firstRunAt.getDate();
    const payload: Record<string, unknown> = {
      title: titleTrim,
      description: taskNotes || undefined,
      category: form.category.trim() || undefined,
      status: form.status,
      assigneeId: form.assigneeId || undefined,
      clientId,
      proof,
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
        toast.success("Recurring task created.");
      }
      onSaved?.();
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || (isEdit ? "Failed to update." : "Failed to create."));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden ring-2 ring-primary-200/80">
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 bg-gradient-to-r from-teal-600 via-emerald-600 to-green-600 border-b-2 border-emerald-500/50">
          <h3 className="text-lg font-bold text-white drop-shadow-sm">
            {isEdit ? "Edit Recurring Task" : "Add Recurring Task"}
          </h3>
          <button type="button" onClick={() => setOpen(false)} className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col bg-gradient-to-b from-slate-50/50 to-white">
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
            <div className="rounded-xl border-l-4 border-primary-500 bg-primary-50/50 p-3">
              <label className="block text-sm font-semibold text-primary-800 mb-1">Title</label>
              <input
                type="text"
                maxLength={90}
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-400 transition-shadow"
                placeholder="e.g. Optimized homepage title tags"
              />
            </div>
            <div className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/50 p-3">
              <label className="block text-sm font-semibold text-emerald-800 mb-1">Work Type</label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400 transition-shadow"
                placeholder="e.g. Technical, Content, Link Building"
              />
            </div>
            <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50/50 p-3">
              <label className="block text-sm font-semibold text-amber-800 mb-1">Task</label>
              <div
                ref={taskNotesRef}
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => setForm((p) => ({ ...p, taskNotes: (e.target as HTMLDivElement).innerHTML }))}
                className="min-h-[120px] w-full border-2 border-gray-200 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-400 prose prose-sm max-w-none transition-shadow"
                data-placeholder="Add task details..."
                style={{ outline: "none" }}
              />
            </div>
            <div className="rounded-xl border-l-4 border-violet-500 bg-violet-50/50 p-3">
              <label className="block text-sm font-semibold text-violet-800 mb-1">Due date / First run</label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-400 transition-shadow"
              />
            </div>
            <div ref={assignToRef} className="relative rounded-xl border-l-4 border-slate-400 bg-slate-50/50 p-3">
              <label className="block text-sm font-semibold text-slate-700 mb-1">Assign to</label>
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
                placeholder="Search by name or email"
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-400 transition-shadow"
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
                  className="mt-1 text-sm text-slate-600 hover:text-primary-600 font-medium"
                >
                  Clear
                </button>
              )}
              {assignToOpen && (
                <ul className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border-2 border-primary-200 bg-white shadow-lg py-1">
                  {assignableLoading ? (
                    <li className="px-3 py-2 text-sm text-gray-500">Loading…</li>
                  ) : assignableUsers.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-gray-500">No users found.</li>
                  ) : (
                    assignableUsers.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 flex justify-between"
                          onClick={() => {
                            setForm((p) => ({ ...p, assigneeId: u.id }));
                            setAssigneeDisplay(u.name || u.email);
                            setAssignableSearch("");
                            setAssignToOpen(false);
                          }}
                        >
                          <span>{u.name || u.email}</span>
                          <span className="text-xs text-gray-500">{u.role.replace("_", " ")}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
            <div className="rounded-xl border-l-4 border-indigo-500 bg-indigo-50/50 p-3">
              <label className="block text-sm font-semibold text-indigo-800 mb-2">Proof / Attachments</label>
              <input
                id="worklog-recurring-file"
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,image/*,video/*,.txt,.csv"
                className="sr-only"
                onChange={handleFileSelect}
              />
              <label
                htmlFor="worklog-recurring-file"
                className="flex items-center justify-center w-full px-4 py-3 border-2 border-dashed border-violet-200 rounded-lg cursor-pointer hover:border-violet-400 hover:bg-violet-50/50 transition-colors"
              >
                <div className="flex flex-col items-center">
                  {uploading ? <Loader2 className="h-6 w-6 text-violet-500 animate-spin mb-2" /> : <Upload className="h-6 w-6 text-violet-500 mb-2" />}
                  <span className="text-sm text-violet-800/90">
                    {uploading ? "Uploading…" : "Click to upload files (PDF, Word, Excel, images, etc.)"}
                  </span>
                  <span className="text-xs text-violet-600/80 mt-1">max 25MB per file</span>
                </div>
              </label>
              <div className="flex flex-col sm:flex-row gap-2 mt-2">
                <select
                  value={urlType}
                  onChange={(e) => setUrlType(e.target.value as "image" | "video" | "url")}
                  className="px-3 py-2 border-2 border-gray-200 rounded-lg sm:w-40 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-400 transition-shadow"
                >
                  <option value="url">URL</option>
                  <option value="image">Image URL</option>
                  <option value="video">Video URL</option>
                </select>
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="Enter URL"
                  className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-400 transition-shadow"
                />
                <button type="button" onClick={addUrl} className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 font-medium flex items-center justify-center gap-1 transition-colors">
                  <Plus className="h-4 w-4" />
                  Add
                </button>
              </div>
              {form.attachments.length > 0 && (
                <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                  {form.attachments.map((att, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-violet-50/50 rounded-lg border border-violet-200">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {att.type === "image" && <Image className="h-4 w-4 text-blue-600 flex-shrink-0" />}
                        {att.type === "video" && <Video className="h-4 w-4 text-purple-600 flex-shrink-0" />}
                        {(att.type === "url" || !att.type) && <LinkIcon className="h-4 w-4 text-green-600 flex-shrink-0" />}
                        <a href={getUploadFileUrl(att.value)} target="_blank" rel="noopener noreferrer" className="text-sm text-primary-600 truncate">
                          {att.name || att.value || "Attachment"}
                        </a>
                      </div>
                      <button type="button" onClick={() => removeAttachment(i)} className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-xl border-l-4 border-blue-500 bg-blue-50/50 p-3">
              <label className="block text-sm font-semibold text-blue-800 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as TaskStatus }))}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-slate-400 focus:border-slate-400 transition-shadow"
              >
                <option value="TODO">Pending</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="REVIEW">In Review</option>
                <option value="DONE">Completed</option>
              </select>
            </div>
            <div className="rounded-xl border-l-4 border-teal-500 bg-teal-50/50 p-3">
              <label className="block text-sm font-semibold text-teal-800 mb-1">Recurrence</label>
              <select
                value={form.frequency}
                onChange={(e) => setForm((p) => ({ ...p, frequency: e.target.value as (typeof FREQUENCIES)[number]["value"] }))}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400 transition-shadow"
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex-shrink-0 px-6 py-4 border-t-2 border-gray-200 flex justify-end gap-3 bg-gradient-to-r from-gray-50 to-slate-50 rounded-b-2xl">
            <button type="button" onClick={() => setOpen(false)} className="px-5 py-2.5 rounded-xl bg-white border-2 border-gray-200 text-gray-700 font-medium hover:bg-gray-100 hover:border-gray-300 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !form.title.trim()}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-semibold hover:from-teal-700 hover:to-emerald-700 disabled:opacity-50 transition-all shadow-md"
            >
              {submitting ? "Saving…" : isEdit ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default WorkLogRecurringModal;
