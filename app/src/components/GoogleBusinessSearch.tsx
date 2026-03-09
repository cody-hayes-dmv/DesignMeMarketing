import React, { useEffect, useMemo, useState } from "react";
import { Search, Loader2, Check, MapPin } from "lucide-react";
import api from "@/lib/api";

export type GoogleBusinessSelection = {
  placeId: string;
  mapsCid?: string | null;
  businessName: string;
  address: string;
  lat: number;
  lng: number;
};

type GoogleBusinessSearchProps = {
  value: GoogleBusinessSelection | null;
  onSelect: (selection: GoogleBusinessSelection | null) => void;
  onQueryChange?: (query: string) => void;
  inputId?: string;
  disabled?: boolean;
  placeholder?: string;
};

const GoogleBusinessSearch: React.FC<GoogleBusinessSearchProps> = ({
  value,
  onSelect,
  onQueryChange,
  inputId,
  disabled = false,
  placeholder = "Search business name...",
}) => {
  const [query, setQuery] = useState(value?.businessName ?? "");
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<GoogleBusinessSelection[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(value?.businessName ?? "");
  }, [value?.businessName]);

  useEffect(() => {
    if (disabled) return;
    const text = query.trim();
    if (text.length < 2) {
      setOptions([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.get("/local-map/gbp/search", {
          params: { q: text },
          _silent: true,
        } as any);
        if (cancelled) return;
        const rows = Array.isArray(res.data) ? res.data : [];
        setOptions(
          rows
            .map((row: any) => ({
              placeId: String(row.placeId || ""),
              mapsCid: row.mapsCid ? String(row.mapsCid) : null,
              businessName: String(row.businessName || ""),
              address: String(row.address || ""),
              lat: Number(row.lat),
              lng: Number(row.lng),
            }))
            .filter((row: GoogleBusinessSelection) => row.placeId && row.businessName && Number.isFinite(row.lat) && Number.isFinite(row.lng))
        );
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [disabled, query]);

  const hasValue = useMemo(() => Boolean(value?.placeId), [value?.placeId]);

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-primary-600" />
          Business Search
        </span>
      </label>
      <div className="relative">
        <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          id={inputId}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            onQueryChange?.(next);
            if (value?.placeId && next.trim() !== value.businessName.trim()) {
              onSelect(null);
            }
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full border border-gray-300 rounded-lg pl-9 pr-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        {loading ? (
          <Loader2 className="h-4 w-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 animate-spin" />
        ) : hasValue ? (
          <Check className="h-4 w-4 text-emerald-600 absolute right-3 top-1/2 -translate-y-1/2" />
        ) : null}
      </div>

      {open && options.length > 0 && (
        <div className="absolute z-40 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {options.map((option) => (
            <button
              key={option.placeId}
              type="button"
              onClick={() => {
                onSelect(option);
                setQuery(option.businessName);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
            >
              <p className="text-sm font-semibold text-gray-900">{option.businessName}</p>
              <p className="text-xs text-gray-600">{option.address}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default GoogleBusinessSearch;
