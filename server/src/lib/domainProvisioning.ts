import { randomBytes } from "crypto";
import { resolveTxt } from "dns/promises";

const DOMAIN_TXT_PREFIX = "_ymd-verify";
const DOMAIN_CNAME_PREFIX = "_ymd-ssl";
const DEFAULT_SSL_CNAME_TARGET = process.env.DOMAIN_SSL_CNAME_TARGET || "verify.yourmarketingdashboard.ai";

export type DomainVerificationInstructions = {
  txtHost: string;
  txtValue: string;
  cnameHost: string;
  cnameTarget: string;
};

export function generateDomainVerificationToken(): string {
  return randomBytes(16).toString("hex");
}

export function normalizeDomainHost(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim().toLowerCase();
  if (!raw) return null;

  let candidate = raw;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      candidate = new URL(candidate).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  candidate = candidate.replace(/\.$/, "");
  if (candidate.includes("/") || candidate.includes(" ")) return null;
  if (!/^[a-z0-9.-]+$/.test(candidate)) return null;
  if (!candidate.includes(".")) return null;
  if (candidate.startsWith(".") || candidate.endsWith(".")) return null;
  if (candidate.includes("..")) return null;
  return candidate;
}

export function getDomainVerificationInstructions(
  customDomain: string,
  token: string
): DomainVerificationInstructions {
  const normalized = normalizeDomainHost(customDomain);
  if (!normalized) {
    throw new Error("Invalid custom domain");
  }
  return {
    txtHost: `${DOMAIN_TXT_PREFIX}.${normalized}`,
    txtValue: `ymd-verification=${token}`,
    cnameHost: `${DOMAIN_CNAME_PREFIX}.${normalized}`,
    cnameTarget: DEFAULT_SSL_CNAME_TARGET,
  };
}

export async function verifyCustomDomainViaDns(
  customDomain: string,
  token: string
): Promise<{ verified: boolean; reason?: string }> {
  const normalized = normalizeDomainHost(customDomain);
  if (!normalized) {
    return { verified: false, reason: "Invalid custom domain format" };
  }
  const instructions = getDomainVerificationInstructions(normalized, token);
  try {
    const records = await resolveTxt(instructions.txtHost);
    const flattened = records.map((chunk) => chunk.join("")).map((v) => v.trim());
    const expected = instructions.txtValue.trim();
    const found = flattened.some((value) => value === expected);
    if (!found) {
      return { verified: false, reason: `TXT record not found for ${instructions.txtHost}` };
    }
    return { verified: true };
  } catch {
    return { verified: false, reason: `DNS lookup failed for ${instructions.txtHost}` };
  }
}

export async function requestSslProvisioning(
  customDomain: string
): Promise<{ accepted: boolean; reason?: string }> {
  const normalized = normalizeDomainHost(customDomain);
  if (!normalized) return { accepted: false, reason: "Invalid custom domain format" };

  // Adapter boundary for infra-specific provider integration.
  // Current implementation accepts request and relies on external provisioning.
  return { accepted: true };
}

