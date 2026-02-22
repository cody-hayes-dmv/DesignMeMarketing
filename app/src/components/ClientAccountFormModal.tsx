import React from "react";
import { X, Loader2, Copy } from "lucide-react";
import toast from "react-hot-toast";
import {
  type ClientFormState,
  type CampaignType,
  EMPTY_CLIENT_FORM,
  INDUSTRY_OPTIONS,
  BUSINESS_NICHE_OPTIONS,
  US_STATES,
  SERVICE_RADIUS_OPTIONS,
} from "@/lib/clientAccountForm";

const inputClass = "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent";

interface ClientAccountFormModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  form: ClientFormState;
  setForm: React.Dispatch<React.SetStateAction<ClientFormState>>;
  canEdit: boolean;
  showStatus?: boolean;
  onClose: () => void;
  onSave?: () => void;
  saving?: boolean;
}

export default function ClientAccountFormModal({
  open,
  title,
  subtitle = "Account information",
  form,
  setForm,
  canEdit,
  showStatus = false,
  onClose,
  onSave,
  saving = false,
}: ClientAccountFormModalProps) {
  if (!open) return null;

  const copyAllToClipboard = () => {
    const industry = form.businessNiche === "Other" ? form.businessNicheOther : form.businessNiche;
    const lines = [
      "--- BUSINESS INFORMATION ---",
      `Business Name: ${form.name || ""}`,
      `Business Niche: ${industry || ""}`,
      `Business Description: ${form.businessDescription || ""}`,
      `Primary Domain: ${form.domain || ""}`,
      "",
      "--- LOCATION INFORMATION ---",
      `Business Address: ${form.businessAddress || ""}`,
      `Primary Location City: ${form.primaryLocationCity || ""}`,
      `Primary Location State: ${form.primaryLocationState || ""}`,
      `Service Radius: ${form.serviceRadius || ""}`,
      `Areas Served: ${form.serviceAreasServed || ""}`,
      "",
      "--- CONTACT INFORMATION ---",
      `Phone Number: ${form.phoneNumber || ""}`,
      `Email: ${form.emailAddress || ""}`,
      "",
      "--- WEBSITE LOGIN INFO ---",
      `Website Login URL: ${form.loginUrl || ""}`,
      `Website Username: ${form.loginUsername || ""}`,
      `Website Password: ${form.loginPassword ? "••••••••" : ""}`,
      "",
      "--- CAMPAIGN TYPE ---",
      `Campaign Type: ${form.campaignType || ""}`,
      "",
      "--- GOOGLE BUSINESS PROFILE ---",
      `Google Business Profile Category: ${form.gbpPrimaryCategory || ""}`,
      `Secondary GBP Categories: ${form.gbpSecondaryCategories || ""}`,
    ];
    if (showStatus) {
      lines.push("", "--- STATUS ---", `Status: ${form.clientStatus || ""}`);
    }
    const text = lines.join("\n");
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Failed to copy")
    );
  };

  const field = (label: string, required?: boolean, children: React.ReactNode) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        {label} {required ? "*" : ""}
      </label>
      {children}
    </div>
  );

  const ro = (value: string) => (
    <div className={`px-4 py-3 border border-gray-200 rounded-lg bg-gray-50 text-gray-900 min-h-[42px]`}>
      {value || "—"}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm overflow-y-auto z-50">
      <div className="min-h-full px-4 py-8 flex items-start justify-center">
        <div className="bg-white rounded-2xl shadow-2xl ring-2 ring-primary-200/80 w-full max-w-5xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
          <div className="flex items-start justify-between px-6 py-4 bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-600 border-b-2 border-primary-500/50 shrink-0">
            <div>
              <h2 className="text-xl font-bold text-white drop-shadow-sm">{title}</h2>
              <p className="text-sm text-white/90 mt-1">{subtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyAllToClipboard}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white/90 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
                title="Copy all information"
              >
                <Copy className="h-4 w-4" />
                Copy Text
              </button>
              <button type="button" onClick={onClose} className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-6 bg-gradient-to-b from-slate-50/50 to-white">
            {/* BUSINESS INFORMATION */}
            <section className="rounded-xl border-l-4 border-primary-500 bg-primary-50/50 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-primary-900 mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                BUSINESS INFORMATION (Required)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {field(
                  "Business Name",
                  true,
                  canEdit ? (
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className={inputClass}
                    />
                  ) : (
                    ro(form.name)
                  )
                )}
                {field(
                  "Business Niche",
                  true,
                  canEdit ? (
                    <>
                      <select
                        value={form.businessNiche}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            businessNiche: e.target.value,
                            businessNicheOther: e.target.value === "Other" ? prev.businessNicheOther : "",
                          }))
                        }
                        className={`${inputClass} bg-white`}
                      >
                        <option value="">Select business niche</option>
                        {INDUSTRY_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                      {form.businessNiche === "Other" && (
                        <input
                          type="text"
                          value={form.businessNicheOther}
                          onChange={(e) => setForm((f) => ({ ...f, businessNicheOther: e.target.value }))}
                          className={`mt-2 ${inputClass}`}
                          placeholder="Enter business niche"
                        />
                      )}
                    </>
                  ) : (
                    ro(form.businessNiche === "Other" ? form.businessNicheOther : form.businessNiche)
                  )
                )}
                <div className="md:col-span-2">
                {field(
                  "Business Description",
                  true,
                  canEdit ? (
                    <textarea
                      value={form.businessDescription}
                      onChange={(e) => setForm((f) => ({ ...f, businessDescription: e.target.value }))}
                      className={inputClass}
                      rows={3}
                      placeholder="Brief description of what the business does"
                    />
                  ) : (
                    ro(form.businessDescription)
                  )
                )}
                </div>
                {field(
                  "Primary Domain",
                  true,
                  canEdit ? (
                    <input
                      type="url"
                      value={form.domain}
                      onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
                      className={inputClass}
                      placeholder="https://example.com"
                    />
                  ) : (
                    ro(form.domain)
                  )
                )}
              </div>
            </section>

            {/* LOCATION INFORMATION */}
            <section className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/50 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-emerald-900 mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                LOCATION INFORMATION (Required)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  {field(
                  "Business Address",
                  true,
                  canEdit ? (
                    <input
                      type="text"
                      value={form.businessAddress}
                      onChange={(e) => setForm((f) => ({ ...f, businessAddress: e.target.value }))}
                      className={inputClass}
                      placeholder="e.g. 123 Main Street"
                    />
                  ) : (
                    ro(form.businessAddress)
                  )
                )}
                </div>
                {field(
                  "Primary Location City",
                  true,
                  canEdit ? (
                    <input
                      type="text"
                      value={form.primaryLocationCity}
                      onChange={(e) => setForm((f) => ({ ...f, primaryLocationCity: e.target.value }))}
                      className={inputClass}
                      placeholder="e.g. Huntington"
                    />
                  ) : (
                    ro(form.primaryLocationCity)
                  )
                )}
                {field(
                  "Primary Location State",
                  true,
                  canEdit ? (
                    <select
                      value={form.primaryLocationState}
                      onChange={(e) => setForm((f) => ({ ...f, primaryLocationState: e.target.value }))}
                      className={`${inputClass} bg-white`}
                    >
                      <option value="">Select state</option>
                      {US_STATES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    ro(form.primaryLocationState)
                  )
                )}
                {field(
                  "Service Radius",
                  false,
                  canEdit ? (
                    <>
                      <select
                        value={form.serviceRadius}
                        onChange={(e) => setForm((f) => ({ ...f, serviceRadius: e.target.value }))}
                        className={`${inputClass} bg-white`}
                      >
                        <option value="">Select...</option>
                        {SERVICE_RADIUS_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-gray-500">How far do you serve from your primary location?</p>
                    </>
                  ) : (
                    ro(form.serviceRadius)
                  )
                )}
                <div className="md:col-span-2">
                {field(
                  "Areas Served",
                  false,
                  canEdit ? (
                    <>
                      <textarea
                        value={form.serviceAreasServed}
                        onChange={(e) => setForm((f) => ({ ...f, serviceAreasServed: e.target.value }))}
                        className={inputClass}
                        rows={2}
                        placeholder="e.g. Huntington, Northport, Centerport"
                      />
                      <p className="mt-1 text-xs text-gray-500">List cities, towns, or regions you serve (comma-separated)</p>
                    </>
                  ) : (
                    ro(form.serviceAreasServed)
                  )
                )}
                </div>
              </div>
            </section>

            {/* CONTACT INFORMATION */}
            <section className="rounded-xl border-l-4 border-amber-500 bg-amber-50/50 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-amber-900 mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                CONTACT INFORMATION (Required)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {field(
                  "Phone Number",
                  true,
                  canEdit ? (
                    <input
                      type="tel"
                      value={form.phoneNumber}
                      onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))}
                      className={inputClass}
                      placeholder="+1 (631) 555-1234"
                    />
                  ) : (
                    ro(form.phoneNumber)
                  )
                )}
                {field(
                  "Email",
                  true,
                  canEdit ? (
                    <input
                      type="email"
                      value={form.emailAddress}
                      onChange={(e) => setForm((f) => ({ ...f, emailAddress: e.target.value }))}
                      className={inputClass}
                      placeholder="info@example.com"
                    />
                  ) : (
                    ro(form.emailAddress)
                  )
                )}
              </div>
            </section>

            {/* WEBSITE LOGIN INFO */}
            <section className="rounded-xl border-l-4 border-violet-500 bg-violet-50/50 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-violet-900 mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                WEBSITE LOGIN INFO (Optional)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                {field(
                  "Website Login URL",
                  false,
                  canEdit ? (
                    <input
                      type="url"
                      value={form.loginUrl}
                      onChange={(e) => setForm((f) => ({ ...f, loginUrl: e.target.value }))}
                      className={inputClass}
                      placeholder="https://example.com/wp-admin"
                    />
                  ) : (
                    form.loginUrl ? (
                      <a href={form.loginUrl} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline block py-2">
                        {form.loginUrl}
                      </a>
                    ) : (
                      ro("")
                    )
                  )
                )}
                </div>
                {field(
                  "Website Username",
                  false,
                  canEdit ? (
                    <input
                      type="text"
                      value={form.loginUsername}
                      onChange={(e) => setForm((f) => ({ ...f, loginUsername: e.target.value }))}
                      className={inputClass}
                      placeholder="admin"
                    />
                  ) : (
                    ro(form.loginUsername)
                  )
                )}
                {field(
                  "Website Password",
                  false,
                  canEdit ? (
                    <>
                      <input
                        type="password"
                        value={form.loginPassword}
                        onChange={(e) => setForm((f) => ({ ...f, loginPassword: e.target.value }))}
                        className={inputClass}
                        placeholder="Leave blank to keep current"
                      />
                      <p className="mt-1 text-xs text-gray-500">Stored securely. Leave blank to keep current.</p>
                    </>
                  ) : (
                    ro("••••••••")
                  )
                )}
              </div>
            </section>

            {/* CAMPAIGN TYPE */}
            <section className="rounded-xl border-l-4 border-blue-500 bg-blue-50/50 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-blue-900 mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                CAMPAIGN TYPE (Required)
              </h3>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Type *</label>
                {canEdit ? (
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="campaignType"
                        value="Local"
                        checked={form.campaignType === "Local"}
                        onChange={(e) => setForm((f) => ({ ...f, campaignType: e.target.value as CampaignType }))}
                        className="text-primary-600"
                      />
                      <span>Local (targeting specific geographic area)</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="campaignType"
                        value="National"
                        checked={form.campaignType === "National"}
                        onChange={(e) => setForm((f) => ({ ...f, campaignType: e.target.value as CampaignType }))}
                        className="text-primary-600"
                      />
                      <span>National (targeting entire country/multiple regions)</span>
                    </label>
                  </div>
                ) : (
                  ro(form.campaignType || "—")
                )}
              </div>
            </section>

            {/* GOOGLE BUSINESS PROFILE */}
            <section className="rounded-xl border-l-4 border-indigo-500 bg-indigo-50/50 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-indigo-900 mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                GOOGLE BUSINESS PROFILE (Optional)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                {field(
                  "Google Business Profile Category",
                  false,
                  canEdit ? (
                    <input
                      type="text"
                      value={form.gbpPrimaryCategory}
                      onChange={(e) => setForm((f) => ({ ...f, gbpPrimaryCategory: e.target.value }))}
                      className={inputClass}
                      placeholder="e.g. Day Spa"
                    />
                  ) : (
                    ro(form.gbpPrimaryCategory)
                  )
                )}
                </div>
                <div className="md:col-span-2">
                {field(
                  "Secondary GBP Categories",
                  false,
                  canEdit ? (
                    <input
                      type="text"
                      value={form.gbpSecondaryCategories}
                      onChange={(e) => setForm((f) => ({ ...f, gbpSecondaryCategories: e.target.value }))}
                      className={inputClass}
                      placeholder="e.g. Massage Therapist, Wellness Center"
                    />
                  ) : (
                    ro(form.gbpSecondaryCategories)
                  )
                )}
                </div>
              </div>
            </section>

            {/* Status (Admin / Super Admin only) */}
            {showStatus && (
              <section className="rounded-xl border-l-4 border-slate-500 bg-slate-50/50 p-4 sm:p-5">
                {field(
                  "Status",
                  false,
                  canEdit ? (
                    <select
                      value={form.clientStatus}
                      onChange={(e) => setForm((f) => ({ ...f, clientStatus: e.target.value }))}
                      className={`${inputClass} bg-white`}
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="PENDING">Pending</option>
                      <option value="DASHBOARD_ONLY">Dashboard Only</option>
                      <option value="CANCELED">Canceled</option>
                      <option value="SUSPENDED">Suspended</option>
                      <option value="ARCHIVED">Archived</option>
                    </select>
                  ) : (
                    ro(form.clientStatus)
                  )
                )}
              </section>
            )}
          </div>

          <div className="px-6 py-4 border-t-2 border-gray-200 flex justify-end gap-3 shrink-0 bg-gradient-to-r from-gray-50 to-slate-50">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl bg-white border-2 border-gray-200 text-gray-700 font-medium hover:bg-gray-100 hover:border-gray-300 transition-colors">
              {canEdit ? "Cancel" : "Close"}
            </button>
            {canEdit && onSave && (
              <button
                type="button"
                disabled={saving}
                onClick={onSave}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-primary-600 to-blue-600 text-white font-semibold hover:from-primary-700 hover:to-blue-700 disabled:opacity-50 transition-all shadow-md flex items-center gap-2"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Changes
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export { EMPTY_CLIENT_FORM };
