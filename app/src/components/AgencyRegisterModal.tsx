import React, { useState } from "react";
import { X, User, Mail, Lock, Eye, EyeOff } from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";

interface AgencyRegisterModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const INDUSTRY_OPTIONS = [
  "Full Service Agency",
  "SEO Specialist",
  "Web Design",
  "PPC Agency",
  "Social Media",
  "Local Marketing",
  "Other",
];

const AGENCY_SIZE_OPTIONS = [
  "Solo (1 person)",
  "Small (2-5 employees)",
  "Medium (6-15 employees)",
  "Large (16-30 employees)",
  "Enterprise (30+ employees)",
];

const REFERRAL_OPTIONS = [
  { value: "", label: "Select..." },
  { value: "Google Search", label: "Google Search" },
  { value: "referral", label: "Referral" },
  { value: "Social Media", label: "Social Media" },
  { value: "Industry Event", label: "Industry Event" },
  { value: "Cold Outreach", label: "Cold Outreach" },
  { value: "Other", label: "Other" },
];

const PRIMARY_GOALS = [
  "White label reporting for clients",
  "Outsource SEO fulfillment",
  "Scale my agency",
  "Better client retention",
];

const TOOLS_OPTIONS = ["SEMrush", "Ahrefs", "AgencyAnalytics"];

const initialForm = {
  name: "",
  website: "",
  industry: "",
  agencySize: "",
  numberOfClients: "" as string | number,
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  contactJobTitle: "",
  streetAddress: "",
  city: "",
  state: "",
  zip: "",
  country: "United States",
  subdomain: "",
  password: "",
  passwordConfirm: "",
  referralSource: "",
  referralSourceOther: "",
  primaryGoals: [] as string[],
  primaryGoalsOther: "",
  currentTools: "",
};

const AgencyRegisterModal: React.FC<AgencyRegisterModalProps> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const [form, setForm] = useState(initialForm);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (field: string, value: string | number | string[]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.passwordConfirm) {
      toast.error("Passwords do not match");
      return;
    }
    if (form.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setSubmitting(true);
    try {
      const website =
        form.website.trim().startsWith("http")
          ? form.website.trim()
          : `https://${form.website.trim()}`;
      const toolsList = form.currentTools
        ? form.currentTools
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
      await api.post("/agencies/register", {
        name: form.name.trim(),
        website,
        industry: form.industry || undefined,
        agencySize: form.agencySize || undefined,
        numberOfClients:
          form.numberOfClients === "" ? undefined : Number(form.numberOfClients),
        contactName: form.contactName.trim(),
        contactEmail: form.contactEmail.trim(),
        contactPhone: form.contactPhone || undefined,
        contactJobTitle: form.contactJobTitle || undefined,
        streetAddress: form.streetAddress || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        zip: form.zip || undefined,
        country: form.country || undefined,
        subdomain: form.subdomain?.trim() || undefined,
        password: form.password,
        passwordConfirm: form.passwordConfirm,
        referralSource: form.referralSource || undefined,
        referralSourceOther:
          form.referralSource === "referral" ? form.referralSourceOther : undefined,
        primaryGoals:
          form.primaryGoals?.length ? form.primaryGoals : undefined,
        primaryGoalsOther: form.primaryGoalsOther || undefined,
        currentTools: toolsList.length ? toolsList.join(", ") : undefined,
      });
      toast.success(
        "Agency account created. Please check your email to verify your account."
      );
      setForm(initialForm);
      onClose();
      onSuccess?.();
    } catch (err: any) {
      toast.error(
        err?.response?.data?.message || "Failed to create agency account"
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const passwordsMatch = form.password === form.passwordConfirm;
  const isPasswordValid = form.password.length >= 6;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col my-8">
        <div className="flex justify-between items-center p-6 border-b border-gray-200 shrink-0">
          <h2 className="text-xl font-bold text-gray-900">Sign up as an agency</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
          <div className="p-6 overflow-y-auto space-y-6 flex-1">
            {/* Section A: Agency Information */}
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                AGENCY INFORMATION (Required)
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Agency Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => handleChange("name", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="e.g. TKM Agency"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Agency Website *
                  </label>
                  <input
                    type="url"
                    required
                    value={form.website}
                    onChange={(e) => handleChange("website", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="https://tkmdigital.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Industry/Specialty
                  </label>
                  <select
                    value={form.industry}
                    onChange={(e) => handleChange("industry", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Select...</option>
                    {INDUSTRY_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Agency Size
                  </label>
                  <select
                    value={form.agencySize}
                    onChange={(e) => handleChange("agencySize", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Select...</option>
                    {AGENCY_SIZE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Number of Current Clients
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={form.numberOfClients}
                    onChange={(e) =>
                      handleChange(
                        "numberOfClients",
                        e.target.value === "" ? "" : Number(e.target.value)
                      )
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="e.g. 12"
                  />
                </div>
              </div>
            </section>

            {/* Section B: Primary Contact + Password */}
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                PRIMARY CONTACT (Required)
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Primary Contact Name *
                  </label>
                  <div className="relative">
                    <User className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={form.contactName}
                      onChange={(e) => handleChange("contactName", e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="e.g. Johnny Doe"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Contact Email * (login email)
                  </label>
                  <div className="relative">
                    <Mail className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={form.contactEmail}
                      onChange={(e) => handleChange("contactEmail", e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="johnny@tkmdigital.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Password *
                  </label>
                  <div className="relative">
                    <Lock className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      value={form.password}
                      onChange={(e) => handleChange("password", e.target.value)}
                      className="w-full pl-10 pr-12 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="Create a password (min 6 characters)"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                  {form.password && (
                    <p
                      className={`text-xs mt-1 ${
                        isPasswordValid ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      Password must be at least 6 characters
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Confirm Password *
                  </label>
                  <div className="relative">
                    <Lock className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      required
                      value={form.passwordConfirm}
                      onChange={(e) =>
                        handleChange("passwordConfirm", e.target.value)
                      }
                      className="w-full pl-10 pr-12 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="Confirm your password"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                  {form.passwordConfirm && (
                    <p
                      className={`text-xs mt-1 ${
                        passwordsMatch ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {passwordsMatch
                        ? "Passwords match"
                        : "Passwords do not match"}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={form.contactPhone}
                    onChange={(e) => handleChange("contactPhone", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="+1 (631) 555-1234"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Job Title
                  </label>
                  <input
                    type="text"
                    value={form.contactJobTitle}
                    onChange={(e) =>
                      handleChange("contactJobTitle", e.target.value)
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="Owner, Marketing Director, SEO Manager"
                  />
                </div>
              </div>
            </section>

            {/* Section C: Business Address */}
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                BUSINESS ADDRESS (Optional)
              </h3>
              <div className="space-y-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Street Address
                  </label>
                  <input
                    type="text"
                    value={form.streetAddress}
                    onChange={(e) =>
                      handleChange("streetAddress", e.target.value)
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="375 Commack Road"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => handleChange("city", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="Deer Park"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    State/Province
                  </label>
                  <input
                    type="text"
                    value={form.state}
                    onChange={(e) => handleChange("state", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="NY"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    ZIP/Postal Code
                  </label>
                  <input
                    type="text"
                    value={form.zip}
                    onChange={(e) => handleChange("zip", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="11729"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Country
                  </label>
                  <select
                    value={form.country}
                    onChange={(e) => handleChange("country", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="United States">United States</option>
                    <option value="Canada">Canada</option>
                    <option value="United Kingdom">United Kingdom</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
            </section>

            {/* Section D: Subdomain */}
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                WHITE LABEL SUBDOMAIN (Optional)
              </h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Custom Subdomain
                </label>
                <input
                  type="text"
                  value={form.subdomain}
                  onChange={(e) => handleChange("subdomain", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="tkmdigital"
                />
                <p className="mt-1 text-xs text-gray-500">
                  e.g. tkmdigital → tkmdigital.yourplatform.com. Leave blank if
                  not needed.
                </p>
              </div>
            </section>

            {/* Section F: Additional Questions */}
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                ADDITIONAL QUESTIONS (Optional)
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    How did you hear about us?
                  </label>
                  <select
                    value={form.referralSource}
                    onChange={(e) =>
                      handleChange("referralSource", e.target.value)
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  >
                    {REFERRAL_OPTIONS.map((opt) => (
                      <option key={opt.value || "empty"} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {form.referralSource === "referral" && (
                    <input
                      type="text"
                      value={form.referralSourceOther}
                      onChange={(e) =>
                        handleChange("referralSourceOther", e.target.value)
                      }
                      className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="Referral from..."
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    What&apos;s your primary goal? (select multiple)
                  </label>
                  <div className="space-y-1 flex flex-wrap gap-2">
                    {PRIMARY_GOALS.map((goal) => (
                      <label
                        key={goal}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="checkbox"
                          checked={form.primaryGoals.includes(goal)}
                          onChange={(e) =>
                            handleChange(
                              "primaryGoals",
                              e.target.checked
                                ? [...form.primaryGoals, goal]
                                : form.primaryGoals.filter((g) => g !== goal)
                            )
                          }
                          className="rounded border-gray-300 text-primary-600"
                        />
                        <span className="text-sm">{goal}</span>
                      </label>
                    ))}
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.primaryGoals.includes("Other")}
                        onChange={(e) =>
                          handleChange(
                            "primaryGoals",
                            e.target.checked
                              ? [...form.primaryGoals, "Other"]
                              : form.primaryGoals.filter((g) => g !== "Other")
                          )
                        }
                        className="rounded border-gray-300 text-primary-600"
                      />
                      <span className="text-sm">Other</span>
                      {form.primaryGoals.includes("Other") && (
                        <input
                          type="text"
                          value={form.primaryGoalsOther}
                          onChange={(e) =>
                            handleChange("primaryGoalsOther", e.target.value)
                          }
                          className="ml-1 px-2 py-1 border rounded text-sm w-40"
                          placeholder="Specify"
                        />
                      )}
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    What tools are you currently using?
                  </label>
                  <div className="space-y-2">
                    {TOOLS_OPTIONS.map((tool) => {
                      const toolsList = form.currentTools
                        ? form.currentTools
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean)
                        : [];
                      const isChecked = toolsList.includes(tool);
                      return (
                        <label
                          key={tool}
                          className="flex items-center gap-2"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const current = form.currentTools
                                ? form.currentTools
                                    .split(",")
                                    .map((t) => t.trim())
                                    .filter(Boolean)
                                : [];
                              if (e.target.checked) {
                                handleChange(
                                  "currentTools",
                                  [...current.filter((t) => t !== tool), tool].join(
                                    ", "
                                  )
                                );
                              } else {
                                handleChange(
                                  "currentTools",
                                  current.filter((t) => t !== tool).join(", ")
                                );
                              }
                            }}
                            className="rounded border-gray-300 text-primary-600"
                          />
                          <span className="text-sm">{tool}</span>
                        </label>
                      );
                    })}
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={(() => {
                          if (!form.currentTools) return false;
                          const list = form.currentTools
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean);
                          return (
                            list.includes("Other") ||
                            list.some(
                              (t) =>
                                !["SEMrush", "Ahrefs", "AgencyAnalytics"].includes(
                                  t
                                )
                            )
                          );
                        })()}
                        onChange={(e) => {
                          const current = form.currentTools
                            ? form.currentTools
                                .split(",")
                                .map((t) => t.trim())
                                .filter(Boolean)
                            : [];
                          const known = current.filter((t) =>
                            ["SEMrush", "Ahrefs", "AgencyAnalytics"].includes(t)
                          );
                          const other = current.filter(
                            (t) =>
                              !["SEMrush", "Ahrefs", "AgencyAnalytics", "Other"].includes(
                                t
                              )
                          );
                          if (e.target.checked) {
                            handleChange(
                              "currentTools",
                              [...known, ...other, "Other"].join(", ")
                            );
                          } else {
                            handleChange(
                              "currentTools",
                              known.join(", ")
                            );
                          }
                        }}
                        className="rounded border-gray-300 text-primary-600"
                      />
                      <span className="text-sm">Other</span>
                    </label>
                  </div>
                  {(() => {
                    if (!form.currentTools) return null;
                    const list = form.currentTools
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean);
                    const other = list.filter(
                      (t) =>
                        !["SEMrush", "Ahrefs", "AgencyAnalytics", "Other"].includes(
                          t
                        )
                    );
                    if (other.length === 0) return null;
                    return (
                      <input
                        type="text"
                        value={other.join(", ")}
                        onChange={(e) => {
                          const known = form.currentTools
                            ? form.currentTools
                                .split(",")
                                .map((t) => t.trim())
                                .filter((t) =>
                                  ["SEMrush", "Ahrefs", "AgencyAnalytics", "Other"].includes(
                                    t
                                  )
                                )
                            : [];
                          handleChange(
                            "currentTools",
                            [...known, e.target.value.trim()].filter(Boolean).join(", ")
                          );
                        }}
                        className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        placeholder="Enter other tools"
                      />
                    );
                  })()}
                </div>
              </div>
            </section>
          </div>

          <div className="flex gap-3 p-6 border-t border-gray-200 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                submitting ||
                !form.name.trim() ||
                !form.website.trim() ||
                !form.contactName.trim() ||
                !form.contactEmail.trim() ||
                !passwordsMatch ||
                !isPasswordValid
              }
              className="flex-1 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Creating account..." : "Create agency account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AgencyRegisterModal;
