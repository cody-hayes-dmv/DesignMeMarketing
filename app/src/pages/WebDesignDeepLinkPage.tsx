import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { RootState } from "@/store";
import api from "@/lib/api";

export default function WebDesignDeepLinkPage() {
  const navigate = useNavigate();
  const { projectId, pageId } = useParams<{ projectId: string; pageId: string }>();
  const { user } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    let cancelled = false;

    const resolveAndNavigate = async () => {
      const safeProjectId = String(projectId || "").trim();
      const safePageId = String(pageId || "").trim();
      if (!safeProjectId || !safePageId || !user) {
        navigate("/", { replace: true });
        return;
      }

      const query = new URLSearchParams({
        projectId: safeProjectId,
        pageId: safePageId,
      }).toString();

      if (user.role === "USER") {
        let resolvedClientId: string | null = null;
        try {
          const res = await api.get(`/web-design/projects/${encodeURIComponent(safeProjectId)}`, { _silent: true } as any);
          const project = res?.data as { client?: { id?: string | null }; clientId?: string | null } | undefined;
          resolvedClientId = String(project?.client?.id || project?.clientId || "").trim() || null;
        } catch {
          resolvedClientId = null;
        }

        const fallbackClientId = String((user as any)?.clientAccess?.clients?.[0]?.clientId || "").trim() || null;
        const targetClientId = resolvedClientId || fallbackClientId;
        if (!cancelled) {
          if (!targetClientId) {
            navigate("/client/tasks", { replace: true });
            return;
          }
          navigate(`/client/dashboard/${encodeURIComponent(targetClientId)}`, {
            replace: true,
            state: { tab: "web-design", projectId: safeProjectId, pageId: safePageId },
          });
        }
        return;
      }

      if (user.role === "DESIGNER") {
        if (!cancelled) navigate(`/designer/web-design?${query}`, { replace: true });
        return;
      }

      if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") {
        if (!cancelled) navigate(`/superadmin/web-design?${query}`, { replace: true });
        return;
      }

      if (user.role === "AGENCY") {
        if (!cancelled) navigate(`/agency/web-design?${query}`, { replace: true });
        return;
      }

      if (!cancelled) navigate("/", { replace: true });
    };

    resolveAndNavigate();
    return () => {
      cancelled = true;
    };
  }, [navigate, pageId, projectId, user]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
        <p className="text-gray-500">Opening web design update...</p>
      </div>
    </div>
  );
}
