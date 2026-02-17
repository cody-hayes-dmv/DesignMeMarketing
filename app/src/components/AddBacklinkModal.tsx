import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";

interface AddBacklinkModalProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
  defaultTargetUrl: string;
  onSuccess?: () => void;
}

export default function AddBacklinkModal({
  open,
  onClose,
  clientId,
  defaultTargetUrl,
  onSuccess,
}: AddBacklinkModalProps) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    sourceUrl: "",
    targetUrl: "",
    anchorText: "",
    domainRating: "",
    isFollow: true,
  });

  useEffect(() => {
    if (open) {
      setForm({
        sourceUrl: "",
        targetUrl: defaultTargetUrl,
        anchorText: "",
        domainRating: "",
        isFollow: true,
      });
    }
  }, [open, defaultTargetUrl]);

  const submit = useCallback(async () => {
    try {
      setAdding(true);
      const domainRatingNum = form.domainRating.trim() ? Number(form.domainRating) : null;
      await api.post(`/seo/backlinks/${clientId}`, {
        sourceUrl: form.sourceUrl.trim(),
        targetUrl: form.targetUrl.trim() || undefined,
        anchorText: form.anchorText.trim() || null,
        domainRating: domainRatingNum != null && Number.isFinite(domainRatingNum) ? domainRatingNum : null,
        isFollow: form.isFollow,
      });
      toast.success("Backlink added");
      onClose();
      onSuccess?.();
    } catch (error: any) {
      console.error("Failed to add backlink", error);
      toast.error(error?.response?.data?.message || "Failed to add backlink");
    } finally {
      setAdding(false);
    }
  }, [form, clientId, onClose, onSuccess]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden ring-2 ring-primary-200/80">
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-600 border-b-2 border-primary-500/50">
          <h3 className="text-lg font-bold text-white drop-shadow-sm">Add Backlink</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 bg-gradient-to-b from-slate-50/80 to-white">
          <div className="rounded-xl border-l-4 border-primary-500 bg-primary-50/60 p-3">
            <label className="block text-sm font-semibold text-primary-800 mb-1">Source URL</label>
            <input
              type="text"
              value={form.sourceUrl}
              onChange={(e) => setForm((p) => ({ ...p, sourceUrl: e.target.value }))}
              className="w-full border-2 border-primary-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-400 bg-white transition-shadow"
              placeholder="https://example.com/page"
            />
          </div>
          <div className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/60 p-3">
            <label className="block text-sm font-semibold text-emerald-800 mb-1">Target URL</label>
            <input
              type="text"
              value={form.targetUrl}
              onChange={(e) => setForm((p) => ({ ...p, targetUrl: e.target.value }))}
              className="w-full border-2 border-emerald-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400 bg-white transition-shadow"
              placeholder="https://your-site.com/"
            />
          </div>
          <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50/60 p-3">
            <label className="block text-sm font-semibold text-amber-800 mb-1">Anchor Text (optional)</label>
            <input
              type="text"
              value={form.anchorText}
              onChange={(e) => setForm((p) => ({ ...p, anchorText: e.target.value }))}
              className="w-full border-2 border-amber-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-400 bg-white transition-shadow"
              placeholder="e.g. best seo services"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border-l-4 border-violet-500 bg-violet-50/60 p-3">
              <label className="block text-sm font-semibold text-violet-800 mb-1">Domain Rating (optional)</label>
              <input
                type="number"
                value={form.domainRating}
                onChange={(e) => setForm((p) => ({ ...p, domainRating: e.target.value }))}
                className="w-full border-2 border-violet-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-400 bg-white transition-shadow"
                placeholder="e.g. 65"
              />
            </div>
            <div className="flex items-end rounded-xl border-l-4 border-slate-400 bg-slate-50/60 p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isFollow}
                  onChange={(e) => setForm((p) => ({ ...p, isFollow: e.target.checked }))}
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                Follow link
              </label>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t-2 border-gray-200 flex items-center justify-end gap-3 bg-gradient-to-r from-gray-50 to-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-white border-2 border-gray-200 text-gray-700 font-medium hover:bg-gray-100 hover:border-gray-300 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={adding || !form.sourceUrl.trim()}
            onClick={() => void submit()}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary-600 to-blue-600 text-white font-semibold hover:from-primary-700 hover:to-blue-700 disabled:opacity-50 transition-all shadow-md"
          >
            {adding ? "Saving..." : "Add"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
