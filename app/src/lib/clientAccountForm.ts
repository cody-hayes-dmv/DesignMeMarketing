/**
 * Shared client account form state and constants for Edit Client / View Client Information modals.
 */

import type { Client } from "@/store/slices/clientSlice";

export const INDUSTRY_OPTIONS = [
  "Healthcare",
  "Legal Services",
  "Home Services",
  "Retail",
  "Restaurants",
  "Financial Services",
  "Real Estate",
  "Professional Services",
  "Other",
] as const;

export type CampaignType = "" | "Local" | "National";

export type ClientFormState = {
  name: string;
  domain: string;
  industry: string;
  industryOther: string;
  businessNiche: string;
  businessNicheOther: string;
  businessDescription: string;
  businessAddress: string;
  primaryLocationCity: string;
  primaryLocationState: string;
  serviceRadius: string;
  serviceAreasServed: string;
  phoneNumber: string;
  emailAddress: string;
  loginUrl: string;
  loginUsername: string;
  loginPassword: string;
  campaignType: CampaignType;
  gbpPrimaryCategory: string;
  gbpSecondaryCategories: string;
  primaryServicesList: string;
  secondaryServicesList: string;
  servicesMarkedPrimary: string;
  targetKeywordCount: string;
  keywords: string;
  latitude: string;
  longitude: string;
  seoRoadmapStartMonth: string;
  pagesPerMonth: string;
  technicalHoursPerMonth: string;
  campaignDurationMonths: string;
  totalKeywordsToTarget: string;
  seoRoadmapSection: string;
  managedServicePackage: string;
  managedServiceStatus: string;
  serviceStartDate: string;
  managedServiceEndDate: string;
  clientStatus: string;
  canceledEndDate: string;
};

export const BUSINESS_NICHE_OPTIONS = [
  "Health & Wellness",
  "Emergency Locksmith",
  "Legal Services",
  "Home Services",
  "Retail",
  "Restaurants",
  "Financial Services",
  "Real Estate",
  "Professional Services",
  "Automotive",
  "Beauty & Personal Care",
  "Other",
] as const;

export const SERVICE_RADIUS_OPTIONS = [
  "5 miles",
  "10 miles",
  "15 miles",
  "20 miles",
  "25 miles",
  "50 miles",
  "Statewide",
  "National",
  "Custom",
] as const;

export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
];

export const EMPTY_CLIENT_FORM: ClientFormState = {
  name: "",
  domain: "",
  industry: "",
  industryOther: "",
  businessNiche: "",
  businessNicheOther: "",
  businessDescription: "",
  businessAddress: "",
  primaryLocationCity: "",
  primaryLocationState: "",
  serviceRadius: "",
  serviceAreasServed: "",
  phoneNumber: "",
  emailAddress: "",
  loginUrl: "",
  loginUsername: "",
  loginPassword: "",
  campaignType: "",
  gbpPrimaryCategory: "",
  gbpSecondaryCategories: "",
  primaryServicesList: "",
  secondaryServicesList: "",
  servicesMarkedPrimary: "",
  targetKeywordCount: "",
  keywords: "",
  latitude: "",
  longitude: "",
  seoRoadmapStartMonth: "",
  pagesPerMonth: "",
  technicalHoursPerMonth: "",
  campaignDurationMonths: "",
  totalKeywordsToTarget: "",
  seoRoadmapSection: "",
  managedServicePackage: "",
  managedServiceStatus: "none",
  serviceStartDate: "",
  managedServiceEndDate: "",
  clientStatus: "",
  canceledEndDate: "",
};

function safeParseObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Map client + accountInfo to form state (same logic as ClientsPage openEdit). */
export function clientToFormState(client: Client): ClientFormState {
  const currentIndustry = (client.industry ?? "").trim();
  const industryIsKnown = INDUSTRY_OPTIONS.includes(currentIndustry as (typeof INDUSTRY_OPTIONS)[number]);
  const info = safeParseObject((client as { accountInfo?: unknown }).accountInfo);
  const rawTargets = (client as { targets?: unknown }).targets;
  let targetsArr: string[] = [];
  if (Array.isArray(rawTargets)) {
    targetsArr = rawTargets.map((s: unknown) => String(s));
  } else if (typeof rawTargets === "string") {
    try {
      const parsed = JSON.parse(rawTargets);
      if (Array.isArray(parsed)) targetsArr = parsed.map((s: unknown) => String(s));
    } catch {
      targetsArr = rawTargets.split(/\r?\n|,/g).map((s) => s.trim()).filter(Boolean);
    }
  }
  const businessNicheVal = String(info.businessNiche ?? "");
  const businessNicheKnown = (INDUSTRY_OPTIONS as readonly string[]).includes(businessNicheVal);
  const fallbackIndustry = businessNicheKnown ? businessNicheVal
    : industryIsKnown ? currentIndustry
    : (businessNicheVal || currentIndustry) ? "Other" : "";
  const fallbackOther = businessNicheKnown ? ""
    : industryIsKnown ? ""
    : businessNicheVal || currentIndustry;

  return {
    ...EMPTY_CLIENT_FORM,
    name: client.name ?? "",
    domain: client.domain ?? "",
    industry: currentIndustry ? (industryIsKnown ? currentIndustry : "Other") : "",
    industryOther: currentIndustry && !industryIsKnown ? currentIndustry : "",
    keywords: targetsArr.join("\n"),
    loginUrl: String((client as { loginUrl?: string }).loginUrl ?? ""),
    loginUsername: String((client as { username?: string }).username ?? ""),
    loginPassword: "",
    businessNiche: fallbackIndustry,
    businessNicheOther: fallbackOther,
    businessDescription: String(info.businessDescription ?? ""),
    businessAddress: String(info.businessAddress ?? ""),
    primaryLocationCity: String(info.primaryLocationCity ?? ""),
    primaryLocationState: String(info.primaryLocationState ?? ""),
    serviceRadius: String(info.serviceRadius ?? ""),
    serviceAreasServed: String(info.serviceAreasServed ?? ""),
    phoneNumber: String(info.phoneNumber ?? ""),
    emailAddress: String(info.emailAddress ?? ""),
    campaignType: (String(info.campaignType ?? "") as CampaignType) || "",
    gbpPrimaryCategory: String(info.gbpPrimaryCategory ?? ""),
    gbpSecondaryCategories: String(info.gbpSecondaryCategories ?? ""),
    primaryServicesList: String(info.primaryServicesList ?? ""),
    secondaryServicesList: String(info.secondaryServicesList ?? ""),
    servicesMarkedPrimary: String(info.servicesMarkedPrimary ?? ""),
    targetKeywordCount: String(info.targetKeywordCount ?? ""),
    latitude: String(info.latitude ?? ""),
    longitude: String(info.longitude ?? ""),
    seoRoadmapStartMonth: String(info.seoRoadmapStartMonth ?? ""),
    pagesPerMonth: String(info.pagesPerMonth ?? ""),
    technicalHoursPerMonth: String(info.technicalHoursPerMonth ?? ""),
    campaignDurationMonths: String(info.campaignDurationMonths ?? ""),
    totalKeywordsToTarget: String(info.totalKeywordsToTarget ?? ""),
    seoRoadmapSection: String(info.seoRoadmapSection ?? ""),
    managedServicePackage: String((client as any).managedServicePackage ?? info.managedServicePackage ?? ""),
    managedServiceStatus: String((client as any).managedServiceStatus ?? "").trim() || (
      String((client as any).status ?? "") === "ACTIVE" ? "active"
        : String((client as any).status ?? "") === "PENDING" ? "pending"
          : String((client as any).status ?? "") === "CANCELED" ? "canceled"
            : String((client as any).status ?? "") === "SUSPENDED" ? "suspended"
              : String((client as any).status ?? "") === "ARCHIVED" ? "archived"
                : "none"
    ),
    serviceStartDate: ((client as any).managedServiceActivatedDate ?? info.serviceStartDate)
      ? String((client as any).managedServiceActivatedDate ?? info.serviceStartDate).slice(0, 10)
      : "",
    managedServiceEndDate: (client as any).managedServiceEndDate
      ? String((client as any).managedServiceEndDate).slice(0, 10)
      : "",
    clientStatus: String((client as { status?: string }).status ?? ""),
    canceledEndDate: (client as { canceledEndDate?: string }).canceledEndDate
      ? String((client as { canceledEndDate?: string }).canceledEndDate).slice(0, 10)
      : "",
  };
}

function parseKeywordsText(raw: string): string[] {
  return String(raw ?? "")
    .split(/\r?\n|,/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Build update payload (accountInfo + top-level fields) for PUT /clients/:id. */
export function formStateToUpdatePayload(
  form: ClientFormState,
  options: { includeStatus?: boolean; includeManagedServiceFields?: boolean }
): Record<string, unknown> {
  const selectedBusinessNiche = (() => {
    const fromIndustry = form.industry === "Other" ? form.industryOther.trim() : (form.industry || "").trim();
    if (fromIndustry) return fromIndustry;
    return form.businessNiche === "Other" ? form.businessNicheOther.trim() : (form.businessNiche || "").trim();
  })();
  const selectedIndustry = form.industry === "Other" ? form.industryOther.trim() : (form.industry || "").trim();
  const accountInfo: Record<string, unknown> = {
    businessNiche: selectedBusinessNiche,
    businessDescription: form.businessDescription || "",
    businessAddress: form.businessAddress || "",
    primaryLocationCity: form.primaryLocationCity || "",
    primaryLocationState: form.primaryLocationState || "",
    serviceRadius: form.serviceRadius || "",
    serviceAreasServed: form.serviceAreasServed || "",
    phoneNumber: form.phoneNumber || "",
    emailAddress: form.emailAddress || "",
    campaignType: form.campaignType || "",
    gbpPrimaryCategory: form.gbpPrimaryCategory || "",
    gbpSecondaryCategories: form.gbpSecondaryCategories || "",
    primaryServicesList: form.primaryServicesList || "",
    secondaryServicesList: form.secondaryServicesList || "",
    servicesMarkedPrimary: form.servicesMarkedPrimary || "",
    targetKeywordCount: form.targetKeywordCount || "",
    latitude: form.latitude || "",
    longitude: form.longitude || "",
    seoRoadmapStartMonth: form.seoRoadmapStartMonth || "",
    pagesPerMonth: form.pagesPerMonth || "",
    technicalHoursPerMonth: form.technicalHoursPerMonth || "",
    campaignDurationMonths: form.campaignDurationMonths || "",
    seoRoadmapSection: form.seoRoadmapSection || "",
    managedServicePackage: form.managedServicePackage || "",
    serviceStartDate: form.serviceStartDate || "",
  };
  const payload: Record<string, unknown> = {
    name: form.name,
    domain: form.domain,
    industry: selectedIndustry,
    targets: parseKeywordsText(form.keywords),
    loginUrl: form.loginUrl || undefined,
    username: form.loginUsername || undefined,
    accountInfo,
  };
  if (options.includeManagedServiceFields) {
    payload.managedServiceStatus = form.managedServiceStatus || "none";
    payload.managedServicePackage = ["pending", "active", "canceled"].includes(form.managedServiceStatus || "")
      ? (form.managedServicePackage || null)
      : null;
    payload.managedServiceActivatedDate = form.managedServiceStatus === "active" ? (form.serviceStartDate || null) : null;
    payload.managedServiceEndDate = form.managedServiceStatus === "canceled" ? (form.managedServiceEndDate || null) : null;
  }
  if (form.loginPassword) payload.password = form.loginPassword;
  if (options.includeStatus && form.clientStatus) payload.status = form.clientStatus;
  if (options.includeStatus && form.canceledEndDate !== undefined) payload.canceledEndDate = form.canceledEndDate || null;
  return payload;
}

function getManagedServicePackageLabel(value: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "foundation") return "SEO Essentials + Automation($750/mo)";
  if (normalized === "growth") return "Growth & Automation ($1,500/mo)";
  if (normalized === "domination") return "Authority Builder ($3,000/mo)";
  if (normalized === "custom") return "Market Domination ($5,000/mo)";
  return value || "";
}

/** Build normalized copy text for client info modals. */
export function buildClientCopyText(
  form: ClientFormState,
  options?: {
    showStatus?: boolean;
    includeExtendedSuperAdminFields?: boolean;
    includeSeoRoadmapSection?: boolean;
  }
): string {
  const businessNiche = (() => {
    const fromIndustry = form.industry === "Other" ? form.industryOther : form.industry;
    if ((fromIndustry || "").trim()) return fromIndustry;
    const fromLegacyNiche = form.businessNiche === "Other" ? form.businessNicheOther : form.businessNiche;
    return fromLegacyNiche;
  })();
  const targetedKeywords = (form.keywords || "")
    .split(/\r?\n|,/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const lines: string[] = [
    "BUSINESS INFORMATION (Required)",
    `Business Name: ${form.name || ""}`,
    `Business Niche: ${businessNiche || ""}`,
    `Business Description: ${form.businessDescription || ""}`,
    `Primary Domain: ${form.domain || ""}`,
    "",
    "LOCATION INFORMATION (Required)",
    `Business Address: ${form.businessAddress || ""}`,
    `Primary Location City: ${form.primaryLocationCity || ""}`,
    `Primary Location State: ${form.primaryLocationState || ""}`,
    `Service Radius: ${form.serviceRadius || ""}`,
    `Areas Served: ${form.serviceAreasServed || ""}`,
    "",
    "CONTACT INFORMATION (Required)",
    `Phone Number: ${form.phoneNumber || ""}`,
    `Email: ${form.emailAddress || ""}`,
    "",
    "WEBSITE LOGIN INFO (Optional)",
    `Website Login URL: ${form.loginUrl || ""}`,
    `Website Username: ${form.loginUsername || ""}`,
    `Website Password: ${form.loginPassword ? form.loginPassword : "[hidden/blank]"}`,
    "",
    "CAMPAIGN TYPE (Required)",
    `Campaign Type: ${form.campaignType || ""}`,
    "",
    "GOOGLE BUSINESS PROFILE (Optional)",
    `Google Business Profile Category: ${form.gbpPrimaryCategory || ""}`,
    `Secondary GBP Categories: ${form.gbpSecondaryCategories || ""}`,
    `Google Business Profile Services: ${form.servicesMarkedPrimary || ""}`,
  ];

  if (options?.includeExtendedSuperAdminFields) {
    const includeSeoRoadmapSection = options?.includeSeoRoadmapSection !== false;
    const targetedKeywordLines =
      targetedKeywords.length > 0
        ? targetedKeywords.map((kw) => `- ${kw}`).join("\n")
        : "";
    lines.push(
      "",
      "KEYWORD ALLOCATION",
      `Number of Keywords for Campaign: ${form.targetKeywordCount || ""}`,
      `Targeted Keywords:\n${targetedKeywordLines}`,
      "",
      "GEOLOCATION DATA",
      `Latitude: ${form.latitude || ""}`,
      `Longitude: ${form.longitude || ""}`
    );
    if (includeSeoRoadmapSection) {
      lines.push(
        "",
        "SEO ROADMAP",
        `SEO Roadmap Section: ${form.seoRoadmapSection || ""}`
      );
    }
    lines.push(
      "",
      "MANAGED SERVICE STATUS",
      `Managed Service Status: ${form.managedServiceStatus || ""}`,
      `Managed Service Package: ${getManagedServicePackageLabel(form.managedServicePackage)}`,
      `Service Start Date: ${form.serviceStartDate || ""}`,
      `Service End Date: ${form.managedServiceEndDate || ""}`
    );
  }

  if (options?.showStatus) {
    lines.push("", "--- STATUS ---", `Status: ${form.clientStatus || ""}`);
  }
  return lines.join("\n");
}
