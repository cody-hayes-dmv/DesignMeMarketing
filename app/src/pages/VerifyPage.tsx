import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useDispatch } from "react-redux";
import { CheckCircle, XCircle } from "lucide-react";
import api from "@/lib/api";
import { login } from "@/store/slices/authSlice";

const getRedirectUrl = (role: string) => {
  switch (role) {
    case "SUPER_ADMIN": return "/superadmin/dashboard";
    case "ADMIN":
    case "AGENCY": return "/agency/dashboard";
    case "SPECIALIST": return "/specialist/dashboard";
    case "USER": return "/client/dashboard";
    default: return "/agency/dashboard";
  }
};

const VerifyPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Missing verification link. Please use the link from your email.");
      return;
    }

    let cancelled = false;
    api
      .post("/auth/verify", { token })
      .then((res) => {
        if (cancelled) return;
        const { token: jwtToken, user } = res.data || {};
        if (jwtToken && user) {
          localStorage.setItem("token", jwtToken);
          dispatch(login.fulfilled(user, "", undefined) as any);
          navigate(getRedirectUrl(user.role || "AGENCY"), { replace: true });
        } else {
          setStatus("success");
          setMessage("Email verified successfully. You can now sign in.");
        }
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
  }, [token, dispatch, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-secondary-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          {status === "loading" && (
            <>
              <div className="flex justify-center mb-6">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
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
                className="inline-flex items-center justify-center w-full py-3 px-6 rounded-lg font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors"
              >
                Sign in
              </Link>
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
                className="inline-flex items-center justify-center w-full py-3 px-6 rounded-lg font-semibold border-2 border-primary-600 text-primary-600 hover:bg-primary-50 transition-colors"
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
