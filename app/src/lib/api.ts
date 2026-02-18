import axios from "axios";
import toast from "react-hot-toast";

// Prefer VITE_API_URL; fallback to same origin (e.g. dev proxy or missing env)
const BASE = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:5000");
const baseURL = BASE ? new URL("/api", BASE).toString() : "/api";

/**
 * Resolve a stored upload URL to a download URL that hits the backend.
 * Handles: /uploads/filename (legacy), full URLs with /uploads/ or /api/upload/.
 * Use this for all attachment/upload links so production downloads work (backend URL is used).
 */
export function getUploadFileUrl(url: string | undefined): string {
  if (!url || typeof url !== "string") return url || "#";
  try {
    const u = url.trim();
    if (u.startsWith("#") || !u) return u || "#";
    if (u.includes("/api/upload/")) return u;
    const match = u.match(/\/uploads\/([^/?]+)/);
    if (!match) return u;
    const filename = match[1];
    const origin = BASE ? new URL(BASE).origin : (typeof window !== "undefined" ? window.location.origin : "");
    if (!origin) return u;
    return `${origin}/api/upload/${encodeURIComponent(filename)}`;
  } catch {
    return url;
  }
}

// Track recent errors to prevent duplicate toasts
const recentErrors = new Map<string, number>();
const ERROR_DEBOUNCE_MS = 2000; // Show same error max once per 2 seconds

// Create axios instance with base configuration
const api = axios.create({
  baseURL,
  timeout: 90000, // 90s for heavy SEO/GA4/dashboard requests
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Don't override Content-Type for FormData (file uploads)
    if (config.data instanceof FormData) {
      delete config.headers["Content-Type"];
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url ?? "";
    const isAuth = /\/auth\/(login|register|verify|forgot-password|reset-password)/i.test(url);
    const isAgencyRegister = /\/agencies\/register/i.test(url) || /\/agencies\/register-free-trial/i.test(url);
    const isShare = /\/seo\/share\//i.test(url); // public shared dashboard endpoints
    
    // Get error message from response
    const errorMessage = error.response?.data?.message || error.message || "An error occurred";
    
    // Create a unique key for this error to prevent duplicates
    const errorKey = `${url}-${status}-${errorMessage}`;
    const now = Date.now();
    const lastShown = recentErrors.get(errorKey);
    
    // Don't show toast for auth errors (handled by login/register pages)
    // Don't show for agency register (modal / RegisterPage handle it to avoid duplicate toasts)
    // Don't show global toasts for share endpoints (share page handles its own UX)
    if (!isAuth && !isAgencyRegister && !isShare) {
      // Only show toast if we haven't shown this exact error recently
      if (!lastShown || now - lastShown > ERROR_DEBOUNCE_MS) {
        recentErrors.set(errorKey, now);
        
        // Clean up old entries periodically
        if (recentErrors.size > 50) {
          const cutoff = now - ERROR_DEBOUNCE_MS * 2;
          for (const [key, timestamp] of recentErrors.entries()) {
            if (timestamp < cutoff) {
              recentErrors.delete(key);
            }
          }
        }
        
        if (!error.response) {
          // Network error or timeout (e.g. server not running, wrong API URL, or slow response)
          const isTimeout = error.code === "ECONNABORTED";
          if (isTimeout) {
            toast.error("Request timed out. The server may be slow—try again.");
          } else {
            toast.error("Cannot reach the server. Check that the backend is running and VITE_API_URL is correct.");
          }
        } else if (status === 401) {
          localStorage.removeItem("token");
          toast.error("Session expired. Please login again.");
        } else if (status === 404 && /\/auth\/me/i.test(url)) {
          localStorage.removeItem("token");
          toast.error("Session expired. Please login again.");
        } else if (status === 403) {
          // 403 on /auth/me usually means invalid/expired token - clear it and treat like logout
          const isAuthMe = /\/auth\/me/i.test(url);
          const isInvalidToken = /invalid token|token/i.test((error.response?.data?.message || "").toLowerCase());
          if (isAuthMe || isInvalidToken) {
            localStorage.removeItem("token");
            toast.error("Session expired. Please login again.");
          } else {
            toast.error("Access denied. You don't have permission to perform this action.");
          }
        } else if (status === 404) {
          toast.error("Resource not found.");
        } else if (status >= 500) {
          toast.error("Server error. Please try again later.");
        } else if (status >= 400) {
          toast.error(errorMessage);
        }
      }
    }

    // IMPORTANT:
    // A 401 on share endpoints means "invalid/expired share link" and should NOT log the user out.
    if (isShare && status === 401) {
      // no-op: keep existing session token
    }
    
    return Promise.reject(error); // keep rejections for RTK to handle
  }
);

export default api;
