import React, { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { X, ChevronDown, ChevronRight } from "lucide-react";
import { assignClientToAgency, includeClientForAgency, unincludeClientFromAgency } from "@/store/slices/agencySlice";
import type { Agency } from "@/store/slices/agencySlice";
import type { Client } from "@/store/slices/clientSlice";
import api from "@/lib/api";
import toast from "react-hot-toast";

interface AssignClientToAgencyModalProps {
  open: boolean;
  onClose: () => void;
  client: Client;
  agencies: Agency[];
  onAssignSuccess?: () => void;
}

export default function AssignClientToAgencyModal({
  open,
  onClose,
  client,
  agencies,
  onAssignSuccess,
}: AssignClientToAgencyModalProps) {
  const dispatch = useDispatch();
  const [includedAgencyIds, setIncludedAgencyIds] = useState<Set<string>>(new Set());
  const [expandedAgencyId, setExpandedAgencyId] = useState<string | null>(null);
  const [loadingIncluded, setLoadingIncluded] = useState(false);
  const [togglingAgencyId, setTogglingAgencyId] = useState<string | null>(null);
  const [assigningAgencyId, setAssigningAgencyId] = useState<string | null>(null);

  useEffect(() => {
    if (open && client?.id) {
      setLoadingIncluded(true);
      api
        .get<string[]>(`/agencies/included-for-client/${client.id}`)
        .then((r) => setIncludedAgencyIds(new Set(r.data || [])))
        .catch(() => setIncludedAgencyIds(new Set()))
        .finally(() => setLoadingIncluded(false));
    }
  }, [open, client?.id]);

  const toggleInclude = async (agencyId: string) => {
    if (!client?.id) return;
    setTogglingAgencyId(agencyId);
    try {
      const isIncluded = includedAgencyIds.has(agencyId);
      if (isIncluded) {
        await dispatch(unincludeClientFromAgency({ agencyId, clientId: client.id }) as any).unwrap();
        setIncludedAgencyIds((prev) => {
          const next = new Set(prev);
          next.delete(agencyId);
          return next;
        });
        toast.success("Client removed from Included");
        window.dispatchEvent(new CustomEvent("included-clients-changed"));
      } else {
        await dispatch(includeClientForAgency({ agencyId, clientId: client.id }) as any).unwrap();
        setIncludedAgencyIds((prev) => new Set([...prev, agencyId]));
        toast.success("Client added to Included");
        window.dispatchEvent(new CustomEvent("included-clients-changed"));
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to update Included");
    } finally {
      setTogglingAgencyId(null);
    }
  };

  const handleAssign = async (agencyId: string) => {
    if (!client?.id) return;
    setAssigningAgencyId(agencyId);
    try {
      await dispatch(assignClientToAgency({ agencyId, clientId: client.id }) as any).unwrap();
      toast.success("Client assigned to agency successfully!");
      onClose();
      onAssignSuccess?.();
    } catch (e: any) {
      toast.error(e?.message || "Failed to assign client to agency");
    } finally {
      setAssigningAgencyId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl overflow-hidden ring-2 ring-emerald-200/80 max-w-2xl w-full max-h-[85vh] flex flex-col">
        <div className="flex justify-between items-center px-6 py-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-green-600 border-b-2 border-teal-500/50 shrink-0">
          <h2 className="text-xl font-bold text-white drop-shadow-sm">
            Assign Client to Agency
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4 bg-gradient-to-b from-slate-50/50 to-white">
          <p className="text-sm text-gray-700 rounded-xl border-l-4 border-teal-500 bg-teal-50/60 px-4 py-3">
            Select an agency to assign &quot;{client.name}&quot; to. Expand an agency to mark as Included (appears in Included tab).
          </p>
          <div className="rounded-xl border-2 border-emerald-200 bg-white overflow-hidden max-h-96 overflow-y-auto">
            {agencies.length === 0 ? (
              <div className="p-6 text-center text-gray-500 bg-amber-50/50 border-t border-amber-200">
                No agencies available. Create an agency first.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {agencies.map((agency) => {
                  const isExpanded = expandedAgencyId === agency.id;
                  const isIncluded = includedAgencyIds.has(agency.id);
                  const isToggling = togglingAgencyId === agency.id;
                  const isAssigning = assigningAgencyId === agency.id;
                  return (
                    <div key={agency.id}>
                      <div
                        className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-emerald-50/80 active:bg-emerald-100/80 transition-colors border-l-4 border-transparent hover:border-emerald-400"
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedAgencyId(isExpanded ? null : agency.id)}
                          className="p-1 rounded hover:bg-emerald-100/80 text-gray-500"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-900">{agency.name}</div>
                          {agency.subdomain && (
                            <div className="text-sm text-emerald-700/90 mt-0.5">
                              {agency.subdomain}.yourseodashboard.com
                            </div>
                          )}
                          <div className="text-xs text-gray-500 mt-1">
                            {agency.memberCount} member{agency.memberCount !== 1 ? "s" : ""}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAssign(agency.id)}
                          disabled={isAssigning}
                          className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 text-sm"
                        >
                          {isAssigning ? "Assigning…" : "Assign"}
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="px-4 pb-3 pt-0 pl-12 bg-slate-50/60 border-t border-slate-100">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isIncluded}
                              onChange={() => toggleInclude(agency.id)}
                              disabled={isToggling || loadingIncluded}
                              className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <span className="text-sm font-medium text-gray-700">
                              Included
                            </span>
                            {isToggling && (
                              <span className="text-xs text-gray-500">Updating…</span>
                            )}
                          </label>
                          <p className="text-xs text-gray-500 mt-1 ml-6">
                            When checked, this client appears in the Included tab for this agency and Super Admin.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
