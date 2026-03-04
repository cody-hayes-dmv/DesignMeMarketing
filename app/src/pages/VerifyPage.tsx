import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, CheckCircle, XCircle } from "lucide-react";
import api from "@/lib/api";
import { usePublicBranding } from "@/hooks/usePublicBranding";

const VerifyPage = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const { brandName, primaryColor } = usePublicBranding();

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Missing verification link. Please use the link from your email.");
      return;
    }

    let cancelled = false;
    api
      .post("/auth/verify", { token })
      .then(() => {
        if (cancelled) return;
        // Do not auto-login after verification. This avoids auth token/session
        // mismatches across environments and gives a consistent explicit sign-in step.
        localStorage.removeItem("token");
        // Notify any already-open app tab that verification succeeded.
        // Existing tabs should close themselves, while this verification tab stays open.
        const signal = String(Date.now());
        localStorage.setItem("email_verified_signal", signal);
        localStorage.removeItem("email_verified_signal");
        if (typeof window !== "undefined" && "BroadcastChannel" in window) {
          const channel = new BroadcastChannel("auth_events");
          channel.postMessage({ type: "EMAIL_VERIFIED" });
          channel.close();
        }
        setStatus("success");
        setMessage("Email verified successfully. Continue to sign in from this tab.");
      })
      .catch((err: any) => {
        if (!cancelled) {
          setStatus("error");
          setMessage(err?.response?.data?.message || "Invalid or expired link. Please try signing up again or request a new link.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-secondary-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-4">{brandName}</p>
          {status === "loading" && (
            <>
              <div className="flex justify-center mb-6">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderBottomColor: primaryColor }} />
              </div>
              <h1 className="text-xl font-bold text-gray-900 mb-2">Verifying your email...</h1>
              <p className="text-gray-600">Please wait.</p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="flex justify-center mb-6">
                <div className="bg-green-100 w-16 h-16 rounded-full flex items-center justify-center">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-4">Email verified</h1>
              <p className="text-gray-600 mb-6">{message}</p>
              <Link
                to="/login"
                className="inline-flex items-center justify-center gap-2 w-full py-3 px-6 rounded-lg font-semibold text-white transition-all shadow-md hover:shadow-lg animate-pulse"
                style={{ backgroundColor: primaryColor, animationDuration: "1.8s" }}
              >
                Continue to Sign in
                <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="text-xs text-gray-500 mt-3">Your account is verified and ready.</p>
            </>
          )}

          {status === "error" && (
            <>
              <div className="flex justify-center mb-6">
                <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center">
                  <XCircle className="h-8 w-8 text-red-600" />
                </div>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-4">Verification failed</h1>
              <p className="text-gray-600 mb-6">{message}</p>
              <Link
                to="/login"
                className="inline-flex items-center justify-center w-full py-3 px-6 rounded-lg font-semibold border-2 transition-colors"
                style={{ borderColor: primaryColor, color: primaryColor }}
              >
                Back to Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default VerifyPage;
