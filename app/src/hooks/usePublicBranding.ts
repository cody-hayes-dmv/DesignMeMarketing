import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";

type BrandingResponse = {
  brandDisplayName?: string;
  logoUrl?: string | null;
  primaryColor?: string;
  agencyBranding?: {
    brandDisplayName?: string | null;
    logoUrl?: string | null;
    primaryColor?: string | null;
  } | null;
};

export function usePublicBranding() {
  const [data, setData] = useState<BrandingResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const hostHint = typeof window !== "undefined" ? window.location.hostname : undefined;
    api
      .get("/auth/branding", { params: hostHint ? { host: hostHint } : undefined })
      .then((res) => {
        if (!cancelled) setData(res.data || null);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const agency = data?.agencyBranding;
    return {
      brandName: agency?.brandDisplayName || data?.brandDisplayName || "Your Marketing Dashboard",
      logoUrl: agency?.logoUrl || data?.logoUrl || null,
      primaryColor: agency?.primaryColor || data?.primaryColor || "#4f46e5",
    };
  }, [data]);
}

