import React, { useState } from "react";
import { Link } from "react-router-dom";
import { X, Eye, EyeOff, CreditCard } from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";

interface AgencyRegisterModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const AgencyRegisterModal: React.FC<AgencyRegisterModalProps> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/agencies/register-free-trial", {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        contactEmail: contactEmail.trim(),
        password,
      });
      toast.success(
        "Please check your email to verify your account. After verification, you can sign in and use the Free tier for 7 days."
      );
      setFirstName("");
      setLastName("");
      setContactEmail("");
      setPassword("");
      onClose();
      onSuccess?.();
    } catch (err: any) {
      toast.error(
        err?.response?.data?.message || "Failed to create account. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const isPasswordValid = password.length >= 6;
  const canSubmit =
    firstName.trim() &&
    lastName.trim() &&
    contactEmail.trim() &&
    isPasswordValid &&
    !submitting;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-8 overflow-hidden border-l-4 border-emerald-500">
        {/* Gradient header */}
        <div className="bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-600 px-6 py-5 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white drop-shadow-sm">Start For Free</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-white/90 hover:text-white hover:bg-white/20 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 bg-gradient-to-b from-slate-50/80 to-white">
          <h1 className="text-xl font-bold text-slate-800 mb-2 text-center">
            Create a free advanced trial with your work email
          </h1>
          {/* Emerald badge for no card */}
          <div className="flex items-center justify-center gap-2 mb-6 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium">
            <span className="relative inline-block">
              <CreditCard className="h-4 w-4 text-emerald-500" />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="w-5 h-px bg-emerald-500 transform -rotate-45" aria-hidden />
              </span>
            </span>
            <span>No credit card required</span>
          </div>

          {/* Form inputs with teal focus */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label htmlFor="firstName" className="sr-only">First Name</label>
              <input
                id="firstName"
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-400 focus:border-teal-500 bg-white transition-colors"
                placeholder="First Name"
              />
            </div>
            <div>
              <label htmlFor="lastName" className="sr-only">Last Name</label>
              <input
                id="lastName"
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-400 focus:border-teal-500 bg-white transition-colors"
                placeholder="Last Name"
              />
            </div>
          </div>

          <div className="mb-3">
            <label htmlFor="contactEmail" className="sr-only">Contact Email</label>
            <input
              id="contactEmail"
              type="email"
              required
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-400 focus:border-teal-500 bg-white transition-colors"
              placeholder="Contact Email"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="password" className="sr-only">Password</label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 pr-10 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-400 focus:border-teal-500 bg-white transition-colors"
                placeholder="Password (min 6 characters)"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-teal-600 transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            {password && !isPasswordValid && (
              <p className="text-xs text-amber-600 mt-1 font-medium">Password must be at least 6 characters</p>
            )}
          </div>

          {/* Gradient CTA button */}
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-3.5 px-6 rounded-xl font-semibold text-white bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-600 hover:from-emerald-500 hover:via-teal-400 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-teal-500/25 hover:shadow-teal-500/30"
          >
            {submitting ? "Sending..." : "Start 7-days Free Trial"}
          </button>

          <p className="text-xs text-slate-500 mt-4 text-center">
            By clicking this button, you agree to our{" "}
            <a href="/terms" className="text-teal-600 hover:text-teal-700 hover:underline font-medium" target="_blank" rel="noopener noreferrer">Terms of Service</a>{" "}
            and{" "}
            <a href="/privacy" className="text-cyan-600 hover:text-cyan-700 hover:underline font-medium" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
          </p>

          <div className="mt-6 pt-6 border-t border-slate-200 space-y-3">
            <div className="text-sm text-slate-600 text-center">
              <span>Sign up with Google work account: </span>
              <button type="button" className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 font-medium" disabled>
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                <span>Google <span className="text-slate-400 font-normal"></span></span>
              </button>
            </div>
            <p className="text-sm text-slate-600 text-center">
              Already have an account?{" "}
              <Link to="/login" onClick={onClose} className="text-violet-600 hover:text-violet-700 font-semibold hover:underline">
                Log in
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AgencyRegisterModal;
