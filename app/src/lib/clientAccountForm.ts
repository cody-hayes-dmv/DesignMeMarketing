/**
 * Shared client account form state and constants for Edit Client / View Client Information modals.
 */

import type { Client } from "@/store/slices/clientSlice";

export const INDUSTRY_OPTIONS = [
  "Automotive Services",
  "Beauty and Personal Care",
  "Cleaning and Maintenance Services",
  "Construction and Contractors",
  "Dental",
  "E-commerce",
  "Education and Training",
  "Entertainment and Events",
  "Financial Services",
  "Fitness and Wellness",
  "Healthcare",
  "Home Services",
  "Hospitality and Lodging",
  "Insurance",
  "Legal Services",
  "Local Government or Municipality",
  "Logistics and Transportation",
  "Manufacturing",
  "Marketing and Advertising",
  "Nonprofit and Religious Organizations",
  "Other",
  "Professional Services",
  "Property Management",
  "Real Estate",
  "Restaurants and Food Services",
  "Retail",
  "Security Services",
  "Technology and IT Services",
  "Trades and Skilled Labor",
  "Travel and Tourism",
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
  serviceStartDate: string;
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
  serviceStartDate: "",
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
    managedServicePackage: String(info.managedServicePackage ?? ""),
    serviceStartDate: info.serviceStartDate ? String(info.serviceStartDate).slice(0, 10) : "",
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
  options: { includeStatus?: boolean }
): Record<string, unknown> {
  const selectedBusinessNiche = form.businessNiche === "Other" ? form.businessNicheOther.trim() : (form.businessNiche || "").trim();
  const selectedIndustry = selectedBusinessNiche;
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
    totalKeywordsToTarget: form.totalKeywordsToTarget || "",
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
  if (form.loginPassword) payload.password = form.loginPassword;
  if (options.includeStatus && form.clientStatus) payload.status = form.clientStatus;
  if (options.includeStatus && form.canceledEndDate !== undefined) payload.canceledEndDate = form.canceledEndDate || null;
  return payload;
}
