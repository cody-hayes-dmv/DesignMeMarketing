import { useEffect, useState, useRef } from "react";
import {
  Plus,
  Save,
  Trash2,
  Copy,
  Check,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading2,
  Code,
  Minus,
  X,
} from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";

interface AiCommand {
  id: string;
  title: string;
  content: string;
  sortOrder: number;
}

const TOOLBAR_ACTIONS = [
  { icon: Bold, label: "Bold", prefix: "**", suffix: "**" },
  { icon: Italic, label: "Italic", prefix: "_", suffix: "_" },
  { icon: Heading2, label: "Heading", prefix: "## ", suffix: "" },
  { icon: List, label: "Bullet list", prefix: "- ", suffix: "" },
  { icon: ListOrdered, label: "Numbered list", prefix: "1. ", suffix: "" },
  { icon: Code, label: "Code", prefix: "`", suffix: "`" },
  { icon: Minus, label: "Divider", prefix: "\n---\n", suffix: "" },
] as const;

const AiCommandsPage = () => {
  const [commands, setCommands] = useState<AiCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [editDrafts, setEditDrafts] = useState<Record<string, { title: string; content: string }>>({});
  const newContentRef = useRef<HTMLTextAreaElement>(null);
  const editContentRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  useEffect(() => {
    loadCommands();
  }, []);

  const loadCommands = async () => {
    try {
      const res = await api.get("/ai-commands");
      setCommands(res.data);
    } catch {
      toast.error("Failed to load AI commands");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) {
      toast.error("Please enter a title");
      return;
    }
    setSaving("new");
    try {
      const res = await api.post("/ai-commands", { title: newTitle.trim(), content: newContent });
      setCommands((prev) => [...prev, res.data]);
      setNewTitle("");
      setNewContent("");
      setShowNewForm(false);
      toast.success("Command saved");
    } catch {
      toast.error("Failed to save command");
    } finally {
      setSaving(null);
    }
  };

  const handleUpdate = async (cmd: AiCommand) => {
    const draft = editDrafts[cmd.id];
    if (!draft) return;
    if (!draft.title.trim()) {
      toast.error("Title cannot be empty");
      return;
    }
    setSaving(cmd.id);
    try {
      const res = await api.put(`/ai-commands/${cmd.id}`, { title: draft.title.trim(), content: draft.content });
      setCommands((prev) => prev.map((c) => (c.id === cmd.id ? res.data : c)));
      setEditDrafts((prev) => {
        const next = { ...prev };
        delete next[cmd.id];
        return next;
      });
      toast.success("Command updated");
    } catch {
      toast.error("Failed to update command");
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this command?")) return;
    try {
      await api.delete(`/ai-commands/${id}`);
      setCommands((prev) => prev.filter((c) => c.id !== id));
      toast.success("Command deleted");
    } catch {
      toast.error("Failed to delete command");
    }
  };

  const handleCopy = (cmd: AiCommand) => {
    navigator.clipboard.writeText(cmd.content).then(() => {
      setCopiedId(cmd.id);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const startEditing = (cmd: AiCommand) => {
    setEditDrafts((prev) => ({ ...prev, [cmd.id]: { title: cmd.title, content: cmd.content } }));
    setExpandedId(cmd.id);
  };

  const cancelEditing = (id: string) => {
    setEditDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const hasDraftChanges = (cmd: AiCommand) => {
    const draft = editDrafts[cmd.id];
    if (!draft) return false;
    return draft.title !== cmd.title || draft.content !== cmd.content;
  };

  const insertFormatting = (
    textarea: HTMLTextAreaElement | null,
    prefix: string,
    suffix: string,
    setter: (val: string) => void,
    currentVal: string
  ) => {
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = currentVal.slice(start, end);
    const replacement = prefix + (selected || "text") + suffix;
    const newVal = currentVal.slice(0, start) + replacement + currentVal.slice(end);
    setter(newVal);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursorPos = start + prefix.length + (selected || "text").length;
      textarea.setSelectionRange(
        selected ? start : start + prefix.length,
        selected ? start + replacement.length : cursorPos
      );
    });
  };

  const ACCENT_COLORS = [
    { bg: "bg-violet-50", border: "border-violet-200", ring: "ring-violet-500", header: "from-violet-600 to-violet-700", badge: "bg-violet-100 text-violet-700" },
    { bg: "bg-sky-50", border: "border-sky-200", ring: "ring-sky-500", header: "from-sky-600 to-sky-700", badge: "bg-sky-100 text-sky-700" },
    { bg: "bg-emerald-50", border: "border-emerald-200", ring: "ring-emerald-500", header: "from-emerald-600 to-emerald-700", badge: "bg-emerald-100 text-emerald-700" },
    { bg: "bg-amber-50", border: "border-amber-200", ring: "ring-amber-500", header: "from-amber-600 to-amber-700", badge: "bg-amber-100 text-amber-700" },
    { bg: "bg-rose-50", border: "border-rose-200", ring: "ring-rose-500", header: "from-rose-600 to-rose-700", badge: "bg-rose-100 text-rose-700" },
    { bg: "bg-teal-50", border: "border-teal-200", ring: "ring-teal-500", header: "from-teal-600 to-teal-700", badge: "bg-teal-100 text-teal-700" },
  ];

  const renderToolbar = (
    textareaRef: HTMLTextAreaElement | null,
    setter: (val: string) => void,
    currentVal: string
  ) => (
    <div className="flex items-center gap-0.5 rounded-t-lg border border-b-0 border-gray-300 bg-gray-50 px-2 py-1.5">
      {TOOLBAR_ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          title={action.label}
          onClick={() => insertFormatting(textareaRef, action.prefix, action.suffix, setter, currentVal)}
          className="rounded p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition-colors"
        >
          <action.icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-violet-50/30 p-8">
      {/* Header */}
      <div className="relative mb-8 overflow-hidden rounded-2xl bg-gradient-to-r from-violet-700 via-purple-700 to-indigo-800 p-8 shadow-lg">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNnKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm">
              <Sparkles className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white md:text-3xl">AI Commands</h1>
              <p className="mt-1 text-sm text-violet-200">Save and organize your AI prompts and commands</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setShowNewForm(true); setExpandedId(null); }}
            className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/25"
          >
            <Plus className="h-4 w-4" /> Add Command
          </button>
        </div>
      </div>

      {/* New Command Form */}
      {showNewForm && (
        <div className="mb-8 rounded-2xl border-2 border-dashed border-violet-300 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">New Command</h2>
            <button type="button" onClick={() => setShowNewForm(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Title</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Blog Post Generator"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-200 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Command Content</label>
              {renderToolbar(
                newContentRef.current,
                setNewContent,
                newContent
              )}
              <textarea
                ref={newContentRef}
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={8}
                placeholder="Enter your AI command or prompt here... Use the toolbar above for formatting."
                className="w-full rounded-b-lg border border-gray-300 px-4 py-3 text-sm font-mono focus:border-violet-500 focus:ring-2 focus:ring-violet-200 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowNewForm(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={saving === "new"}
                className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {saving === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Command
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Commands List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
        </div>
      ) : commands.length === 0 && !showNewForm ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white/60 py-16 text-center">
          <Sparkles className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-4 text-lg font-semibold text-gray-700">No commands yet</h3>
          <p className="mt-1 text-sm text-gray-500">Create your first AI command to get started.</p>
          <button
            type="button"
            onClick={() => setShowNewForm(true)}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
          >
            <Plus className="h-4 w-4" /> Add Your First Command
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {commands.map((cmd, idx) => {
            const accent = ACCENT_COLORS[idx % ACCENT_COLORS.length];
            const isExpanded = expandedId === cmd.id;
            const draft = editDrafts[cmd.id];
            const isEditing = !!draft;
            const hasChanges = hasDraftChanges(cmd);

            return (
              <div
                key={cmd.id}
                className={`rounded-2xl border-2 bg-white shadow-sm transition-all ${isExpanded ? `${accent.border} shadow-md` : "border-gray-200 hover:border-gray-300 hover:shadow-md"}`}
              >
                {/* Command header */}
                <div
                  className="flex cursor-pointer items-center justify-between px-6 py-4"
                  onClick={() => {
                    if (isExpanded) {
                      setExpandedId(null);
                    } else {
                      setExpandedId(cmd.id);
                      if (!draft) startEditing(cmd);
                    }
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${accent.header} shadow-sm`}>
                      <Sparkles className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      {isEditing && isExpanded ? (
                        <input
                          type="text"
                          value={draft.title}
                          onChange={(e) => setEditDrafts((prev) => ({ ...prev, [cmd.id]: { ...prev[cmd.id], title: e.target.value } }))}
                          onClick={(e) => e.stopPropagation()}
                          className="text-lg font-bold text-gray-900 border-b-2 border-transparent focus:border-violet-400 outline-none bg-transparent"
                        />
                      ) : (
                        <h3 className="text-lg font-bold text-gray-900">{cmd.title}</h3>
                      )}
                      <p className="text-xs text-gray-400">
                        {cmd.content.length} characters
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleCopy(cmd); }}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                        copiedId === cmd.id
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {copiedId === cmd.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedId === cmd.id ? "Copied!" : "Copy"}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleDelete(cmd.id); }}
                      className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    {isExpanded ? (
                      <ChevronUp className="h-5 w-5 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-gray-400" />
                    )}
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className={`border-t ${accent.border} px-6 py-5 ${accent.bg} rounded-b-2xl`}>
                    {isEditing ? (
                      <div className="space-y-4">
                        <div>
                          {renderToolbar(
                            editContentRefs.current[cmd.id],
                            (val: string) => setEditDrafts((prev) => ({ ...prev, [cmd.id]: { ...prev[cmd.id], content: val } })),
                            draft.content
                          )}
                          <textarea
                            ref={(el) => { editContentRefs.current[cmd.id] = el; }}
                            value={draft.content}
                            onChange={(e) => setEditDrafts((prev) => ({ ...prev, [cmd.id]: { ...prev[cmd.id], content: e.target.value } }))}
                            rows={10}
                            className="w-full rounded-b-lg border border-gray-300 bg-white px-4 py-3 text-sm font-mono focus:border-violet-500 focus:ring-2 focus:ring-violet-200 focus:outline-none"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => cancelEditing(cmd.id)}
                            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdate(cmd)}
                            disabled={!hasChanges || saving === cmd.id}
                            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                          >
                            {saving === cmd.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Save Changes
                          </button>
                        </div>
                      </div>
                    ) : (
                      <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono leading-relaxed">{cmd.content}</pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AiCommandsPage;
