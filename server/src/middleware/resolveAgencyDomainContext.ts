import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { normalizeDomainHost } from "../lib/domainProvisioning.js";

type AgencyDomainContext = {
  agencyId: string;
  customDomain: string;
  domainStatus: string;
};

declare global {
  namespace Express {
    interface Request {
      agencyDomainContext?: AgencyDomainContext;
    }
  }
}

const defaultFirstPartyHosts = [
  "localhost",
  "127.0.0.1",
  "yourmarketingdashboard.ai",
  "app.yourmarketingdashboard.ai",
];

function getRequestHostname(req: Request): string | null {
  const forwarded = String(req.headers["x-forwarded-host"] || "").trim();
  const hostHeader = forwarded || String(req.headers.host || "").trim();
  if (!hostHeader) return null;
  const hostOnly = hostHeader.split(",")[0]?.trim().split(":")[0]?.trim();
  if (!hostOnly) return null;
  return normalizeDomainHost(hostOnly) || hostOnly.toLowerCase();
}

export async function resolveAgencyDomainContext(req: Request, res: Response, next: NextFunction) {
  try {
    const host = getRequestHostname(req);
    if (!host) return next();

    const extraFirstPartyHosts = String(process.env.FIRST_PARTY_HOSTS || "")
      .split(",")
      .map((h) => normalizeDomainHost(h) || h.trim().toLowerCase())
      .filter(Boolean);
    const firstPartyHosts = new Set([...defaultFirstPartyHosts, ...extraFirstPartyHosts]);
    if (firstPartyHosts.has(host)) return next();

    const agency = await prisma.agency.findFirst({
      where: { customDomain: host },
      select: { id: true, customDomain: true, domainStatus: true },
    });
    if (!agency) return next();

    if (agency.domainStatus !== "ACTIVE") {
      return res.status(421).json({
        message: "Domain is not active yet. Complete verification and SSL provisioning in Agency Settings.",
      });
    }

    req.agencyDomainContext = {
      agencyId: agency.id,
      customDomain: agency.customDomain || host,
      domainStatus: agency.domainStatus,
    };
    return next();
  } catch (error) {
    console.error("Resolve agency domain context error:", error);
    return next();
  }
}

