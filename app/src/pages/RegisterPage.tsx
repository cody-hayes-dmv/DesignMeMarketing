import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { register, clearError } from "@/store/slices/authSlice";
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  CheckCircle,
  Building2,
} from "lucide-react";
import zoesiLogo from "@/assets/zoesi-blue.png";
import AgencyRegisterModal from "@/components/AgencyRegisterModal";

const RegisterPage = () => {
  const dispatch = useDispatch();
  const { loading, error } = useSelector((state: RootState) => state.auth);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    name: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [agencyModalOpen, setAgencyModalOpen] = useState(false);

  useEffect(() => {
    dispatch(clearError());
  }, [dispatch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    dispatch(clearError());

    if (formData.password !== formData.confirmPassword) {
      return;
    }

    try {
      await dispatch(
        register({
          email: formData.email,
          password: formData.password,
          name: formData.name,
        }) as any
      ).unwrap();
      setRegistrationSuccess(true);
    } catch (error) {
      // Error is handled by Redux
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const passwordsMatch = formData.password === formData.confirmPassword;
  const isPasswordValid = formData.password.length >= 6;

  if (registrationSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 via-blue-50 to-indigo-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden border-l-4 border-l-emerald-500 p-8 text-center">
            <div className="h-1.5 w-full bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 mb-6" aria-hidden />
            <div className="flex justify-center mb-6">
              <div className="bg-emerald-100 w-16 h-16 rounded-full flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-emerald-600" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              Check Your Email
            </h1>
            <p className="text-gray-600 mb-6">
              We've sent a verification link to{" "}
              <strong>{formData.email}</strong>. Please check your email and
              click the link to verify your account.
            </p>
            <Link
              to="/login"
              className="inline-flex items-center space-x-2 text-blue-600 hover:text-blue-700 font-semibold transition-colors"
            >
              <span>Back to Sign In</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-blue-50 to-indigo-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden border-l-4 border-l-primary-500">
          <div className="h-1.5 w-full bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-600" aria-hidden />
          <div className="p-8">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <img src={zoesiLogo} alt="ZOESI" className="h-12 w-auto" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Create Your Account
            </h1>
            <p className="text-gray-600">
              Start your SEO analytics journey today
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Full Name
              </label>
              <div className="relative">
                <User className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 focus:border-blue-500 transition-colors"
                  placeholder="Enter your full name"
                  required
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Email Address
              </label>
              <div className="relative">
                <Mail className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 focus:border-blue-500 transition-colors"
                  placeholder="Enter your email"
                  required
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 focus:border-blue-500 transition-colors"
                  placeholder="Create a password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
              {formData.password && (
                <p
                  className={`text-xs mt-1 ${
                    isPasswordValid ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  Password must be at least 6 characters
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  id="confirmPassword"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 focus:border-blue-500 transition-colors"
                  placeholder="Confirm your password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
              {formData.confirmPassword && (
                <p
                  className={`text-xs mt-1 ${
                    passwordsMatch ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {passwordsMatch
                    ? "Passwords match"
                    : "Passwords do not match"}
                </p>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 border-l-4 border-l-red-500 text-red-700 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !passwordsMatch || !isPasswordValid}
              className="w-full bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-600 text-white py-3 px-6 rounded-lg font-semibold hover:from-primary-700 hover:via-blue-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-[0.98] shadow-md"
            >
              {loading ? (
                <div className="flex items-center justify-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Creating account...</span>
                </div>
              ) : (
                "Sign up"
              )}
            </button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-3 bg-white text-gray-500 font-medium">or</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setAgencyModalOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-lg font-semibold border-2 border-emerald-600 text-emerald-700 hover:bg-emerald-50 transition-colors shadow-sm"
            >
              <Building2 className="h-5 w-5" />
              Start For Free
            </button>
          </form>

          <AgencyRegisterModal
            open={agencyModalOpen}
            onClose={() => setAgencyModalOpen(false)}
            onSuccess={() => setAgencyModalOpen(false)}
          />

          <div className="mt-6 text-center">
            <p className="text-gray-600">
              Already have an account?{" "}
              <Link
                to="/login"
                className="text-blue-600 hover:text-blue-700 font-semibold transition-colors underline decoration-blue-500/50"
              >
                Sign in here
              </Link>
            </p>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200 text-center">
            <p className="text-xs text-gray-500">
              By creating an account, you agree to our{" "}
              <a href="#" className="text-blue-600 hover:text-blue-700 font-medium">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="#" className="text-indigo-600 hover:text-indigo-700 font-medium">
                Privacy Policy
              </a>
            </p>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
