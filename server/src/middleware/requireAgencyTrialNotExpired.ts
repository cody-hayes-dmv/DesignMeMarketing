import { Request, Response, NextFunction } from "express";
import { getAgencyTierContext } from "../lib/agencyLimits.js";

const TRIAL_EXPIRED_MESSAGE =
  "Your free trial has ended. Please choose a paid plan at Subscription to continue using the agency panel.";

/** Paths that are allowed when agency trial has expired (method + path prefix or exact). */
const ALLOWED_WHEN_TRIAL_EXPIRED: Array<{ path: string; methods: string[] }> = [
  { path: "/api/agencies/me", methods: ["GET", "PUT"] },
  { path: "/api/seo/agency/subscription", methods: ["GET"] },
  { path: "/api/agencies/billing-portal", methods: ["POST"] },
  { path: "/api/agencies/billing-invoices", methods: ["GET"] },
  { path: "/api/agencies/subscription/payment-method", methods: ["POST"] },
  { path: "/api/agencies/subscription/cancel", methods: ["POST"] },
  { path: "/api/agencies/subscription/reactivate", methods: ["POST"] },
  { path: "/api/agencies/activate-trial-subscription", methods: ["POST"] },
  { path: "/api/agencies/activate-free-account", methods: ["POST"] },
  { path: "/api/agencies/setup-intent-for-activation", methods: ["POST"] },
];

function isAllowedWhenTrialExpired(method: string, originalUrl: string): boolean {
  const path = originalUrl.split("?")[0];
  const apiNormalizedPath = path.startsWith("/api/") ? path : `/api${path.startsWith("/") ? "" : "/"}${path}`;
  return ALLOWED_WHEN_TRIAL_EXPIRED.some(
    (a) =>
      ((path === a.path || path.startsWith(a.path + "/")) ||
        (apiNormalizedPath === a.path || apiNormalizedPath.startsWith(a.path + "/"))) &&
      a.methods.includes(method)
  );
}

/**
 * Restrict access for AGENCY users whose trial has expired (billingType trial/free and trialEndsAt in the past).
 * Allowlisted paths: GET/PUT /api/agencies/me, GET /api/seo/agency/subscription,
 * POST /api/agencies/billing-portal, GET /api/agencies/billing-invoices,
 * POST /api/agencies/subscription/payment-method, /cancel, /reactivate,
 * POST /api/agencies/activate-trial-subscription, /activate-free-account,
 * POST /api/agencies/setup-intent-for-activation.
 * Must run after authenticateToken so req.user is set.
 */
export async function requireAgencyTrialNotExpired(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.user?.role !== "AGENCY") {
    next();
    return;
  }

  const ctx = await getAgencyTierContext(req.user.userId, req.user.role);
  if (!ctx.trialExpired) {
    next();
    return;
  }

  if (isAllowedWhenTrialExpired(req.method, req.originalUrl)) {
    next();
    return;
  }

  res.status(403).json({
    message: TRIAL_EXPIRED_MESSAGE,
    code: "TRIAL_EXPIRED",
  });
}
