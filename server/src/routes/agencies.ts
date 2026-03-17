import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/email.js';
import { BRAND_DISPLAY_NAME } from "../lib/qualityContracts.js";
import { authenticateToken, optionalAuthenticateToken, getJwtSecret } from '../middleware/auth.js';
import { requireAgencyTrialNotExpired } from '../middleware/requireAgencyTrialNotExpired.js';
import { getStripe, isStripeConfigured } from '../lib/stripe.js';
import { getTierConfig, DEFAULT_TIER_ID, AGENCY_TIER_IDS, type TierId } from '../lib/tiers.js';
import {
  getPriceIdForTier,
  findBasePlanSubscriptionItem,
  getTierFromSubscriptionItems,
  syncAgencyTierFromStripe,
} from '../lib/stripeTierSync.js';
import {
  sendAgencyPlanActivationEmail,
  sendAgencyPlanChangeEmail,
} from '../lib/agencyPlanEmails.js';
import { renderBillingEmailTemplate } from '../lib/billingEmailTemplates.js';
import {
  generateDomainVerificationToken,
  getDomainVerificationInstructions,
  normalizeDomainHost,
  requestSslProvisioning,
  verifyCustomDomainViaDns,
} from '../lib/domainProvisioning.js';
import { resolveSuperAdminNotificationRecipients } from '../lib/superAdminNotifications.js';
import { buildSnapshotCreditPackNotificationContent } from '../lib/addOnNotifications.js';
import {
  applySnapshotCreditPackPurchase,
  parseSnapshotCheckoutSession,
  SnapshotPurchaseValidationError,
} from '../lib/snapshotCreditPurchase.js';

const router = express.Router();

const CHANGEABLE_TIER_IDS: TierId[] = [
  'solo',
  'starter',
  'growth',
  'pro',
  'enterprise',
  'business_lite',
  'business_pro',
];

const getCreditsResetAt = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth() + 1, 0, 23, 59, 59, 999);
};

// Restrict agency users with expired trial to subscription/me/activate only
router.use(optionalAuthenticateToken, requireAgencyTrialNotExpired);

const resolveSuperAdminNotificationEmails = async (): Promise<string[]> => {
  const superAdmins = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN' },
    select: { email: true, notificationPreferences: true },
  });

  return resolveSuperAdminNotificationRecipients(superAdmins, {
    superAdminNotifyEmail: process.env.SUPER_ADMIN_NOTIFY_EMAIL,
    managedServiceNotifyEmail: process.env.MANAGED_SERVICE_NOTIFY_EMAIL,
    johnnyEmail: process.env.JOHNNY_EMAIL,
  });
};

const notifySuperAdminsByEmail = async (options: { subject: string; html: string }) => {
  const recipients = await resolveSuperAdminNotificationEmails();
  if (!recipients.length) {
    console.warn('Super admin notification email skipped: no recipients found');
    return;
  }
  await Promise.all(
    recipients.map((to) =>
      sendEmail({
        to,
        subject: options.subject,
        html: options.html,
      }).catch((err: any) => {
        console.warn('Super admin notification email failed:', to, err?.message);
      })
    )
  );
};

const resolveAgencyEmailRecipient = async (agencyId: string, fallbackUserId?: string) => {
  const [agency, fallbackUser] = await Promise.all([
    prisma.agency.findUnique({
      where: { id: agencyId },
      select: { name: true, contactEmail: true, contactName: true },
    }),
    fallbackUserId
      ? prisma.user.findUnique({
          where: { id: fallbackUserId },
          select: { email: true, name: true },
        })
      : Promise.resolve(null),
  ]);

  const recipientEmail = String(agency?.contactEmail || fallbackUser?.email || '').trim().toLowerCase() || null;
  const recipientName = String(agency?.contactName || fallbackUser?.name || 'there').trim();
  const agencyName = String(agency?.name || 'your agency').trim();

  return { recipientEmail, recipientName, agencyName };
};

const createNotificationOnce = async (data: {
  agencyId: string | null;
  userId?: string | null;
  type: string;
  title: string;
  message: string;
  link?: string | null;
}, withinMs = 5 * 60 * 1000): Promise<boolean> => {
  const recent = await prisma.notification.findFirst({
    where: {
      agencyId: data.agencyId,
      userId: data.userId ?? null,
      type: data.type,
      title: data.title,
      message: data.message,
      createdAt: { gte: new Date(Date.now() - withinMs) },
    },
    select: { id: true },
  });
  if (recent) return false;
  await prisma.notification.create({ data }).catch((e) =>
    console.warn('Create notification failed:', e?.message)
  );
  return true;
};

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

const hexColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, "Primary color must be a valid hex value");
const httpUrlSchema = z.string().url("Must be a valid URL").refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "Only http(s) URLs are allowed");

const domainStatusOrder = [
  "NONE",
  "PENDING_VERIFICATION",
  "VERIFIED",
  "SSL_PENDING",
  "ACTIVE",
  "FAILED",
] as const;

type DomainStatus = (typeof domainStatusOrder)[number];

const toDomainStatus = (value: string | null | undefined): DomainStatus => {
  if (!value) return "NONE";
  const upper = value.toUpperCase();
  return (domainStatusOrder as readonly string[]).includes(upper) ? (upper as DomainStatus) : "NONE";
};

const parseAgencyOnboardingData = (raw: string | null | undefined) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, any> : null;
  } catch {
    return null;
  }
};

const markLegacyOnboardingSchema = z
  .object({
    cutoffDate: z.string().datetime().optional(),
    agencyIds: z.array(z.string().min(1)).optional(),
    dryRun: z.boolean().optional(),
  })
  .refine(
    (value) => Boolean(value.cutoffDate) || (Array.isArray(value.agencyIds) && value.agencyIds.length > 0),
    { message: "Provide cutoffDate or agencyIds." }
  );

// Get all agencies (Admin only)
router.get('/', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Fetch all agencies with member counts
    const agencies = await prisma.agency.findMany({
      include: {
        _count: {
          select: { members: true },
        },
        members: {
          select: { userId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const cancellationByAgencyId = new Map<string, { cancelAtPeriodEnd: boolean; cancellationEffectiveAt: string | null }>();
    const stripe = getStripe();
    if (stripe && isStripeConfigured()) {
      await Promise.all(
        agencies.map(async (agency) => {
          const subscriptionId = String(agency.stripeSubscriptionId || "").trim();
          if (!subscriptionId) return;
          try {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            const cancelAtPeriodEnd = subscription.cancel_at_period_end === true;
            const cancellationEffectiveAt = cancelAtPeriodEnd
              ? new Date(((subscription.cancel_at ?? subscription.current_period_end ?? Math.floor(Date.now() / 1000)) as number) * 1000).toISOString()
              : null;
            cancellationByAgencyId.set(agency.id, { cancelAtPeriodEnd, cancellationEffectiveAt });
          } catch (err: any) {
            console.warn(`[agencies] Failed to retrieve Stripe subscription for agency ${agency.id}:`, err?.message);
          }
        })
      );
    }

    // Collect all user IDs from all agencies
    const allUserIds = new Set<string>();
    agencies.forEach(agency => {
      agency.members.forEach(member => {
        allUserIds.add(member.userId);
      });
    });

    // Batch query: Get client counts for all users at once
    const userIdsArray = Array.from(allUserIds);
    const clientCountsByUserId = new Map<string, number>();
    
    if (userIdsArray.length > 0) {
      // Use groupBy to get counts per user
      const clientCounts = await prisma.client.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIdsArray },
        },
        _count: {
          id: true,
        },
      });

      // Build map of userId -> client count
      clientCounts.forEach(item => {
        clientCountsByUserId.set(item.userId, item._count.id);
      });
    }

    // Build map of agencyId -> user IDs for that agency
    const agencyUserIdsMap = new Map<string, string[]>();
    agencies.forEach(agency => {
      agencyUserIdsMap.set(agency.id, agency.members.map(m => m.userId));
    });

    // Calculate client count for each agency
    const formattedAgencies = agencies.map((agency) => {
      const userIds = agencyUserIdsMap.get(agency.id) || [];
      
      // Sum up client counts for all users in this agency
      const clientCount = userIds.reduce((sum, userId) => {
        return sum + (clientCountsByUserId.get(userId) || 0);
      }, 0);

      return {
        id: agency.id,
        name: agency.name,
        subdomain: agency.subdomain,
        subscriptionTier: agency.subscriptionTier ?? null,
        billingType: agency.billingType ?? null,
        trialEndsAt: agency.trialEndsAt ?? null,
        cancelAtPeriodEnd: cancellationByAgencyId.get(agency.id)?.cancelAtPeriodEnd ?? false,
        cancellationEffectiveAt: cancellationByAgencyId.get(agency.id)?.cancellationEffectiveAt ?? null,
        brandDisplayName: agency.brandDisplayName ?? null,
        customDomain: agency.customDomain ?? null,
        domainStatus: toDomainStatus(agency.domainStatus),
        createdAt: agency.createdAt,
        memberCount: agency._count.members,
        clientCount: clientCount,
      };
    });

    res.json(formattedAgencies);
  } catch (error) {
    console.error('Fetch agencies error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// One-time maintenance helper: mark legacy agencies as onboarding-complete.
router.post('/admin/mark-legacy-onboarding-complete', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied. Only Super Admin can run this operation.' });
    }

    const body = markLegacyOnboardingSchema.parse(req.body ?? {});
    const dryRun = body.dryRun ?? false;
    const nowIso = new Date().toISOString();

    const where: any = {};
    if (body.cutoffDate) {
      where.createdAt = { lte: new Date(body.cutoffDate) };
    }
    if (Array.isArray(body.agencyIds) && body.agencyIds.length > 0) {
      where.id = { in: body.agencyIds };
    }

    const agencies = await prisma.agency.findMany({
      where,
      select: {
        id: true,
        name: true,
        createdAt: true,
        onboardingData: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const toUpdate = agencies
      .map((agency) => {
        const existing = parseAgencyOnboardingData(agency.onboardingData) ?? {};
        const alreadyCompleted = Boolean(existing?.submittedAt);
        if (alreadyCompleted) return null;
        return {
          id: agency.id,
          name: agency.name,
          createdAt: agency.createdAt.toISOString(),
          onboardingData: JSON.stringify({
            ...existing,
            submittedAt: nowIso,
          }),
        };
      })
      .filter(Boolean) as Array<{ id: string; name: string; createdAt: string; onboardingData: string }>;

    if (!dryRun && toUpdate.length > 0) {
      await prisma.$transaction(
        toUpdate.map((item) =>
          prisma.agency.update({
            where: { id: item.id },
            data: { onboardingData: item.onboardingData },
          })
        )
      );
    }

    return res.json({
      success: true,
      dryRun,
      filters: {
        cutoffDate: body.cutoffDate ?? null,
        agencyIds: body.agencyIds ?? [],
      },
      scanned: agencies.length,
      updated: dryRun ? 0 : toUpdate.length,
      wouldUpdate: toUpdate.length,
      sample: toUpdate.slice(0, 20).map((item) => ({
        id: item.id,
        name: item.name,
        createdAt: item.createdAt,
      })),
    });
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      return res.status(400).json({ message: 'Invalid input', errors: error.errors });
    }
    console.error('Mark legacy onboarding complete error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Get included agencies for a client (for Assign modal). Must be before /:agencyId
router.get('/included-for-client/:clientId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const { clientId } = req.params;
    const inclusions = await prisma.clientAgencyIncluded.findMany({
      where: { clientId },
      select: { agencyId: true },
    });
    res.json(inclusions.map(i => i.agencyId));
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (msg.includes('does not exist') || msg.includes('ER_NO_SUCH_TABLE') || error?.code === 'P2021') {
      return res.json([]);
    }
    console.error('Get included for client error:', error);
    return res.json([]);
  }
});

// Get included client IDs only (lightweight, for Clients page metric). No enrichment - avoids 500 from missing tables.
router.get('/included-clients/ids', authenticateToken, async (req, res) => {
  try {
    if (!req.user?.role) {
      return res.json([]);
    }
    let clientIds: string[] = [];
    if (req.user.role === 'SUPER_ADMIN') {
      const rows = await prisma.clientAgencyIncluded.findMany({
        select: { clientId: true },
      });
      clientIds = Array.from(new Set(rows.map((r) => r.clientId)));
    } else if (req.user.role === 'AGENCY' || req.user.role === 'ADMIN') {
      const memberships = await prisma.userAgency.findMany({
        where: { userId: req.user.userId },
        select: { agencyId: true },
      });
      const agencyIds = memberships.map((m) => m.agencyId);
      if (agencyIds.length > 0) {
        const rows = await prisma.clientAgencyIncluded.findMany({
          where: { agencyId: { in: agencyIds } },
          select: { clientId: true },
        });
        const unique = new Set(rows.map((r) => r.clientId));
        clientIds = Array.from(unique);
      }
    }
    res.json(clientIds);
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (msg.includes('does not exist') || msg.includes('ER_NO_SUCH_TABLE') || error?.code === 'P2021') {
      return res.json([]);
    }
    console.error('Get included client IDs error:', error);
    // Return empty array on any error so Clients page loads; metric will show 0
    return res.json([]);
  }
});

// Check if any included clients exist (for conditional tab visibility). Must be before /:agencyId
router.get('/included-clients/exists', authenticateToken, async (req, res) => {
  try {
    if (!req.user?.role) {
      return res.json({ hasIncluded: false });
    }
    if (req.user.role === 'SUPER_ADMIN') {
      const count = await prisma.clientAgencyIncluded.count();
      return res.json({ hasIncluded: count > 0 });
    }
    if (req.user.role === 'AGENCY' || req.user.role === 'ADMIN') {
      const memberships = await prisma.userAgency.findMany({
        where: { userId: req.user.userId },
        select: { agencyId: true },
      });
      const agencyIds = memberships.map(m => m.agencyId);
      if (agencyIds.length === 0) {
        return res.json({ hasIncluded: false });
      }
      const count = await prisma.clientAgencyIncluded.count({
        where: { agencyId: { in: agencyIds } },
      });
      return res.json({ hasIncluded: count > 0 });
    }
    return res.json({ hasIncluded: false });
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (msg.includes('does not exist') || msg.includes('ER_NO_SUCH_TABLE') || error?.code === 'P2021') {
      return res.json({ hasIncluded: false });
    }
    console.error('Check has included error:', error);
    return res.json({ hasIncluded: false });
  }
});

// Get included clients - Super Admin: all; Agency: their agency only. Returns client data with stats like Clients page.
router.get('/included-clients', authenticateToken, async (req, res) => {
  try {
    const agencyIdParam = req.query.agencyId as string | undefined;
    let inclusions: { id: string; clientId: string; agencyId: string; client: any; agency: any }[];
    if (req.user.role === 'SUPER_ADMIN') {
      const agencyId = agencyIdParam || undefined;
      const where: any = {};
      if (agencyId) where.agencyId = agencyId;
      inclusions = await prisma.clientAgencyIncluded.findMany({
        where,
        include: {
          client: { select: { id: true, name: true, domain: true, status: true, industry: true, createdAt: true } },
          agency: { select: { id: true, name: true } },
        },
      });
    } else if (req.user.role === 'AGENCY' || req.user.role === 'ADMIN') {
      const memberships = await prisma.userAgency.findMany({
        where: { userId: req.user.userId },
        select: { agencyId: true },
      });
      const agencyIds = memberships.map(m => m.agencyId);
      const whereAgency = agencyIdParam && agencyIds.includes(agencyIdParam)
        ? agencyIdParam
        : agencyIds;
      inclusions = await prisma.clientAgencyIncluded.findMany({
        where: { agencyId: { in: Array.isArray(whereAgency) ? whereAgency : [whereAgency] } },
        include: {
          client: { select: { id: true, name: true, domain: true, status: true, industry: true, createdAt: true } },
          agency: { select: { id: true, name: true } },
        },
      });
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Add stats (keywords, avgPosition, topRankings, traffic) like Clients page. Defensive: skip null client, catch per-row errors.
    const enriched = await Promise.all(inclusions.map(async (row) => {
      const c = row.client;
      if (!c?.id) return null;
      let keywords = 0;
      let avgPosition: number | null = null;
      let topRankingsCount = 0;
      let traffic = 0;
      let traffic30d: number | null = null;
      try {
        const [keywordStats, topRankings, trafficSource, ga4Metrics] = await Promise.all([
          prisma.keyword.aggregate({ where: { clientId: c.id }, _count: { id: true }, _avg: { currentPosition: true } }).catch(() => ({ _count: { id: 0 }, _avg: { currentPosition: null } })),
          prisma.keyword.count({ where: { clientId: c.id, currentPosition: { lte: 10, not: null } } }).catch(() => 0),
          prisma.trafficSource.findFirst({ where: { clientId: c.id }, select: { totalEstimatedTraffic: true, organicEstimatedTraffic: true } }).catch(() => null),
          prisma.ga4Metrics.findUnique({ where: { clientId: c.id }, select: { totalSessions: true } }).catch(() => null),
        ]);
        keywords = keywordStats._count?.id || 0;
        avgPosition = keywordStats._avg?.currentPosition != null ? Math.round(keywordStats._avg.currentPosition * 10) / 10 : null;
        topRankingsCount = topRankings || 0;
        traffic = trafficSource?.organicEstimatedTraffic ?? trafficSource?.totalEstimatedTraffic ?? 0;
        traffic30d = ga4Metrics?.totalSessions ?? null;
      } catch (err) {
        console.warn('Enrich included client', c.id, err);
      }
      return {
        ...row,
        client: {
          ...c,
          keywords,
          avgPosition: avgPosition ?? 0,
          topRankings: topRankingsCount,
          traffic,
          traffic30d,
          agencyNames: [row.agency?.name ?? ''],
        },
      };
    }));

    res.json(enriched.filter(Boolean));
  } catch (error: any) {
    console.error('Get included clients error:', error);
    res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// Create agency directly (Super Admin only). Contact email required; no password — we send "Set your password" link.
const createAgencySchema = z.object({
  name: z.string().min(1, 'Agency name is required'),
  website: z.string().min(1, 'Agency website is required'),
  industry: z.string().optional(),
  agencySize: z.string().optional(),
  numberOfClients: z.coerce.number().int().min(0).optional().nullable(),
  contactName: z.string().min(1, 'Primary contact name is required'),
  contactEmail: z.string().email('Valid contact email is required'),
  contactPhone: z.string().optional(),
  contactJobTitle: z.string().optional(),
  streetAddress: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  subdomain: z.string().optional(),
  billingOption: z.enum(['free_account', 'charge', 'no_charge', 'manual_invoice']),
  paymentMethodId: z.string().optional(), // required when billingOption === 'charge' (Stripe Payment Element)
  tier: z.enum(['solo', 'starter', 'growth', 'pro', 'enterprise', 'business_lite', 'business_pro']).optional(),
  customPricing: z.coerce.number().optional().nullable(),
  internalNotes: z.string().optional(),
  enterpriseMaxDashboards: z.coerce.number().int().min(1).optional().nullable(),
  enterpriseKeywordsTotal: z.coerce.number().int().min(1).optional().nullable(),
  enterpriseCreditsPerMonth: z.coerce.number().int().min(0).optional().nullable(),
  enterpriseMaxTeamUsers: z.coerce.number().int().min(1).optional().nullable(),
  referralSource: z.string().optional(),
  referralSourceOther: z.string().optional(),
  primaryGoals: z.array(z.string()).optional(),
  primaryGoalsOther: z.string().optional(),
  currentTools: z.string().optional(),
  resetPassword: z.string().min(6, 'Password must be at least 6 characters').optional(),
  resetPasswordConfirm: z.string().optional(),
}).refine((data) => {
  const w = data.website?.trim();
  if (!w) return false;
  try {
    new URL(w.startsWith('http') ? w : `https://${w}`);
    return true;
  } catch {
    return false;
  }
}, { message: 'Agency website must be a valid URL', path: ['website'] }).refine((data) => {
  if (!data.resetPassword && !data.resetPasswordConfirm) return true;
  return data.resetPassword === data.resetPasswordConfirm;
}, { message: 'Passwords do not match', path: ['resetPasswordConfirm'] });

// Self-registration: same fields as create (sections A–D, F), plus payment method to activate 7-day reporting trial; password required.
// paymentMethodId is required so the agency activates with CC on file; after 7-day trial they are auto-billed for the reporting plan.
const registerAgencySchema = z.object({
  name: z.string().min(1, 'Agency name is required'),
  website: z.string().min(1, 'Agency website is required'),
  industry: z.string().optional(),
  agencySize: z.string().optional(),
  numberOfClients: z.coerce.number().int().min(0).optional().nullable(),
  contactName: z.string().min(1, 'Primary contact name is required'),
  contactEmail: z.string().email('Valid contact email is required'),
  contactPhone: z.string().optional(),
  contactJobTitle: z.string().optional(),
  streetAddress: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  subdomain: z.string().optional(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  passwordConfirm: z.string().min(1, 'Please confirm your password'),
  paymentMethodId: z.string().min(1, 'Payment method is required to activate your 7-day free trial'),
  tier: z.enum(['solo', 'starter', 'growth', 'pro', 'enterprise', 'business_lite', 'business_pro']).optional(),
  referralSource: z.string().optional(),
  referralSourceOther: z.string().optional(),
  primaryGoals: z.array(z.string()).optional(),
  primaryGoalsOther: z.string().optional(),
  currentTools: z.string().optional(),
}).refine((data) => {
  const w = data.website?.trim();
  if (!w) return false;
  try {
    new URL(w.startsWith('http') ? w : `https://${w}`);
    return true;
  } catch {
    return false;
  }
}, { message: 'Agency website must be a valid URL', path: ['website'] }).refine((data) => data.password === data.passwordConfirm, {
  message: 'Passwords do not match',
  path: ['passwordConfirm'],
});

// Public SetupIntent for agency self-registration (no auth). Used to collect CC so the 7-day reporting trial can auto-bill after trial.
router.post('/setup-intent-public', async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(503).json({
        message: 'Signup is temporarily unavailable. Payment setup is in progress. Please try again later or contact support.',
      });
    }
    const setupIntent = await stripe.setupIntents.create({
      usage: 'off_session',
      payment_method_types: ['card'],
    });
    res.json({ clientSecret: setupIntent.client_secret });
  } catch (err: any) {
    console.error('SetupIntent (public) error:', err);
    res.status(500).json({ message: err?.message || 'Failed to create setup intent' });
  }
});

// Free Trial plan signup schema: no payment, just verification email.
const registerFreeTrialSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  contactEmail: z.string().email('Valid email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

// Public: Start Free Trial plan (no credit card). Sends verification email.
router.post('/register-free-trial', async (req, res) => {
  try {
    const body = registerFreeTrialSchema.parse(req.body);
    const { firstName, lastName, contactEmail: rawEmail, password } = body;
    const contactEmail = rawEmail.trim().toLowerCase();
    const contactName = `${firstName.trim()} ${lastName.trim()}`.trim();

    const existingUser = await prisma.user.findUnique({ where: { email: contactEmail } });
    if (existingUser) {
      return res.status(400).json({
        message: 'This email is already registered. Sign in instead or use a different email.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const agencyName = `${contactName}'s Agency`;

    let agencyUser: { id: string; email: string };
    try {
      agencyUser = await prisma.user.create({
        data: {
          email: contactEmail,
          name: contactName,
          passwordHash,
          role: 'AGENCY',
          verified: false,
          invited: false,
        },
      });
    } catch (userErr: any) {
      if (userErr?.code === 'P2002' && userErr?.meta?.target?.includes?.('email')) {
        return res.status(409).json({
          message: 'An account with this email was just created or already exists. Try signing in.',
        });
      }
      throw userErr;
    }

    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const agency = await prisma.agency.create({
      data: {
        name: agencyName,
        billingType: 'trial',
        subscriptionTier: 'free',
        trialEndsAt,
        contactName,
        contactEmail,
        website: null,
      },
      include: { _count: { select: { members: true } } },
    });

    await prisma.userAgency.create({
      data: {
        userId: agencyUser.id,
        agencyId: agency.id,
        agencyRole: 'OWNER',
      },
    });

    const agencyDashboardName = `${agencyName} - Agency Website`;
    const agencyDashboardDomain = `agency-${agency.id}.internal`;
    try {
      const agencyDashboardClient = await prisma.client.create({
        data: {
          name: agencyDashboardName,
          domain: agencyDashboardDomain,
          userId: agencyUser.id,
          belongsToAgencyId: agency.id,
          isAgencyOwnDashboard: true,
          status: 'DASHBOARD_ONLY',
          managedServiceStatus: 'none',
        },
      });
      await prisma.clientAgencyIncluded.upsert({
        where: { clientId_agencyId: { clientId: agencyDashboardClient.id, agencyId: agency.id } },
        update: {},
        create: { clientId: agencyDashboardClient.id, agencyId: agency.id },
      });
    } catch (dashboardErr: any) {
      console.warn('Agency register-free-trial: auto dashboard create failed', dashboardErr?.message);
    }

    const verificationToken = jwt.sign(
      { userId: agencyUser.id },
      getJwtSecret(),
      { expiresIn: '24h' }
    );
    await prisma.token.create({
      data: {
        type: 'EMAIL_VERIFY',
        email: agencyUser.email,
        token: verificationToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        userId: agencyUser.id,
      },
    });

    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/verify?token=${encodeURIComponent(verificationToken)}`;
    try {
      await sendEmail({
        to: contactEmail,
        subject: `Verify your email - ${BRAND_DISPLAY_NAME}`,
        html: `
          <h1>Verify your ${BRAND_DISPLAY_NAME} account</h1>
          <p>Hi ${contactName},</p>
          <p>Thanks for signing up. Please verify your email by clicking the link below (expires in 24 hours):</p>
          <p><a href="${verifyUrl}">Verify my email</a></p>
          <p>If the link doesn't work, copy and paste this URL into your browser:</p>
          <p style="word-break:break-all">${verifyUrl}</p>
        `,
      });
    } catch (emailErr: any) {
      console.warn('Agency register-free-trial: verification email failed', emailErr?.message);
    }

    // Notify agency + super admins about signup status (new agency sign-up milestone)
    const currentStatusLabel = 'Pending Verification - Free Trial Plan';
    await createNotificationOnce({
      agencyId: null,
      userId: null,
      type: 'free_trial_started',
      title: 'New Agency signup',
      message: `${agencyName} signed up. Status: ${currentStatusLabel}.`,
      link: '/agency/agencies',
    }).catch((e) => console.warn('Create signup notification failed:', e?.message));

    await notifySuperAdminsByEmail({
      subject: `New Agency signup - ${agencyName}`,
      html: `
        <h2>New agency signup</h2>
        <p><strong>Agency:</strong> ${agencyName}</p>
        <p><strong>Contact:</strong> ${contactName}</p>
        <p><strong>Email:</strong> ${contactEmail}</p>
        <p><strong>Created:</strong> ${new Date().toISOString()}</p>
      `,
    });

    res.status(201).json({
      message: 'Please check your email to verify your account. After verification, you can sign in and start using your Free Trial plan.',
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      const first = error.errors?.[0];
      const msg = first ? (first.path?.join('.') + ' ' + first.message) : 'Invalid input';
      return res.status(400).json({ message: msg });
    }
    console.error('Agency register-free-trial error:', error);
    res.status(500).json({ message: 'Failed to create account. Please try again.' });
  }
});

// After 3DS redirect: retrieve payment method from a succeeded SetupIntent (public, no auth). Used to complete registration after redirect.
router.post('/setup-intent-public/retrieve', async (req, res) => {
  try {
    const { setupIntentId } = req.body;
    if (!setupIntentId || typeof setupIntentId !== 'string' || !setupIntentId.startsWith('seti_')) {
      return res.status(400).json({ message: 'Valid setupIntentId is required' });
    }
    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(503).json({ message: 'Payment setup is in progress. Please try again later.' });
    }
    const si = await stripe.setupIntents.retrieve(setupIntentId);
    if (si.status !== 'succeeded') {
      return res.status(400).json({ message: 'Setup was not completed. Please try again.' });
    }
    const pm = si.payment_method;
    const paymentMethodId = typeof pm === 'string' ? pm : (pm as { id?: string } | null)?.id;
    if (!paymentMethodId) {
      return res.status(400).json({ message: 'No payment method found. Please try again.' });
    }
    res.json({ paymentMethodId });
  } catch (err: any) {
    console.error('SetupIntent (public) retrieve error:', err);
    res.status(500).json({ message: err?.message || 'Failed to retrieve payment method' });
  }
});

// SetupIntent for trial activation (Agency/Admin) - used when activating subscription from 7-day trial
router.post('/setup-intent-for-activation', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'AGENCY' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ message: 'Billing is not configured. Set STRIPE_SECRET_KEY.' });
    }
    const setupIntent = await stripe.setupIntents.create({
      usage: 'off_session',
      payment_method_types: ['card'],
    });
    res.json({ clientSecret: setupIntent.client_secret });
  } catch (err: any) {
    console.error('SetupIntent for activation error:', err);
    res.status(500).json({ message: err?.message || 'Failed to create setup intent' });
  }
});

// After Stripe redirect/3DS: retrieve payment method from a SetupIntent created for activation.
router.post('/setup-intent-for-activation/retrieve', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'AGENCY' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const setupIntentId = String(req.body?.setupIntentId || "");
    if (!setupIntentId || !setupIntentId.startsWith('seti_')) {
      return res.status(400).json({ message: 'Valid setupIntentId is required' });
    }

    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ message: 'Billing is not configured. Contact support.' });
    }

    const si = await stripe.setupIntents.retrieve(setupIntentId);
    if (si.status !== 'succeeded' && si.status !== 'processing') {
      return res.status(400).json({ message: 'Card setup is not complete yet. Please try again.' });
    }
    const pm = si.payment_method;
    const paymentMethodId = typeof pm === 'string' ? pm : (pm as { id?: string } | null)?.id;
    if (!paymentMethodId) {
      return res.status(400).json({ message: 'SetupIntent has no payment method' });
    }
    res.json({ paymentMethodId });
  } catch (err: any) {
    console.error('SetupIntent for activation retrieve error:', err);
    res.status(500).json({ message: err?.message || 'Failed to retrieve payment method' });
  }
});

// Create a SetupIntent for collecting a payment method when creating an agency with "Charge to Card"
// Super Admin only. No customer yet; payment method will be attached to the new agency's Stripe customer on create.
router.post('/setup-intent', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ message: 'Billing is not configured. Set STRIPE_SECRET_KEY.' });
    }
    const setupIntent = await stripe.setupIntents.create({
      usage: 'off_session',
      payment_method_types: ['card'],
    });
    res.json({ clientSecret: setupIntent.client_secret });
  } catch (err: any) {
    console.error('SetupIntent error:', err);
    res.status(500).json({ message: err?.message || 'Failed to create setup intent' });
  }
});

// After Stripe redirect (e.g. 3DS), retrieve SetupIntent and return payment_method so frontend can complete agency creation
router.post('/setup-intent/retrieve', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const { setupIntentId } = req.body;
    if (!setupIntentId || typeof setupIntentId !== 'string' || !setupIntentId.startsWith('seti_')) {
      return res.status(400).json({ message: 'Valid setupIntentId is required' });
    }
    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ message: 'Stripe is not configured' });
    }
    const si = await stripe.setupIntents.retrieve(setupIntentId);
    const pm = si.payment_method;
    const paymentMethodId = typeof pm === 'string' ? pm : (pm as { id?: string } | null)?.id;
    if (!paymentMethodId) {
      return res.status(400).json({ message: 'SetupIntent has no payment method' });
    }
    res.json({ paymentMethodId });
  } catch (err: any) {
    console.error('SetupIntent retrieve error:', err);
    res.status(500).json({ message: err?.message || 'Failed to retrieve setup intent' });
  }
});

// Public agency self-registration (no auth). Requires CC to activate 7-day free trial (reporting only); after trial, auto-bills reporting plan.
router.post('/register', async (req, res) => {
  try {
    const body = registerAgencySchema.parse(req.body);
    const {
      name,
      website,
      industry,
      agencySize,
      numberOfClients,
      contactName,
      contactEmail: rawContactEmail,
      contactPhone,
      contactJobTitle,
      streetAddress,
      city,
      state,
      zip,
      country,
      subdomain,
      password,
      paymentMethodId,
      tier,
      referralSource,
      referralSourceOther,
      primaryGoals,
      primaryGoalsOther,
      currentTools,
    } = body;

    // Normalize email so "New@Email.com" and "new@email.com" are treated the same (emails are case-insensitive).
    const contactEmail = typeof rawContactEmail === 'string' ? rawContactEmail.trim().toLowerCase() : '';

    const existingAgency = await prisma.agency.findFirst({ where: { name } });
    if (existingAgency) {
      return res.status(400).json({ message: 'Agency with this name already exists' });
    }

    if (subdomain && subdomain.trim()) {
      const existingSubdomain = await prisma.agency.findUnique({ where: { subdomain: subdomain.trim() } });
      if (existingSubdomain) {
        return res.status(400).json({ message: 'Subdomain already taken' });
      }
    }

    const existingUser = await prisma.user.findUnique({ where: { email: contactEmail } });
    if (existingUser) {
      return res.status(400).json({
        message: 'This email is already registered. Sign in instead or use a different email.',
      });
    }

    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(503).json({
        message: 'Signup is temporarily unavailable. Payment setup is in progress. Please try again later or contact support.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const websiteNormalized = website.trim().startsWith('http') ? website.trim() : `https://${website.trim()}`;
    const onboardingPayload: Record<string, unknown> = {};
    if (referralSource || referralSourceOther) {
      onboardingPayload.referralSource = referralSource === 'referral' ? referralSourceOther : referralSource;
    }
    if (primaryGoals && primaryGoals.length) onboardingPayload.primaryGoals = primaryGoals;
    if (primaryGoalsOther) onboardingPayload.primaryGoalsOther = primaryGoalsOther;
    if (currentTools) onboardingPayload.currentTools = currentTools;
    const onboardingData = Object.keys(onboardingPayload).length ? JSON.stringify(onboardingPayload) : null;

    // Create user first (unique email). Prevents double-submit from creating two Stripe customers:
    // a second request fails here and never reaches Stripe, so no orphan customer without payment method.
    let agencyUser: { id: string; email: string };
    try {
      agencyUser = await prisma.user.create({
        data: {
          email: contactEmail,
          name: contactName ?? name,
          passwordHash,
          role: 'AGENCY',
          verified: false,
          invited: false,
        },
      });
    } catch (userErr: any) {
      if (userErr?.code === 'P2002' && userErr?.meta?.target?.includes?.('email')) {
        // Likely double submit: first request created the user, second hit unique constraint.
        // Tell user to try signing in so they don't think signup failed.
        return res.status(409).json({
          message: 'An account with this email was just created or already exists. Try signing in.',
        });
      }
      throw userErr;
    }

    // 7-day free trial with selected plan; CC required so we can auto-bill after trial.
    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const reportingTier: TierId = (tier as TierId | undefined) ?? 'solo';
    const tierPriceId = getPriceIdForTier(reportingTier);
    if (!tierPriceId || !tierPriceId.startsWith('price_')) {
      await prisma.user.delete({ where: { id: agencyUser.id } }).catch(() => {});
      console.error('[agencies] register: missing Stripe price for selected tier', reportingTier);
      return res.status(503).json({ message: 'Signup is temporarily unavailable. Please try again later or contact support.' });
    }

    let stripeCustomerId: string | null = null;
    let stripeSubscriptionId: string | null = null;
    try {
      const customer = await stripe.customers.create({
        email: contactEmail,
        name: contactName || name,
      });
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
      await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: paymentMethodId } });
      stripeCustomerId = customer.id;

      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: tierPriceId, quantity: 1 }],
        default_payment_method: paymentMethodId,
        trial_period_days: 7,
        payment_settings: { save_default_payment_method: 'on_subscription' },
      });
      if (subscription.status !== 'active' && subscription.status !== 'trialing') {
        await stripe.subscriptions.cancel(subscription.id).catch(() => {});
        await prisma.user.delete({ where: { id: agencyUser.id } }).catch(() => {});
        return res.status(400).json({
          message: 'Could not set up your trial. Try a different card or use test card 4242 4242 4242 4242.',
        });
      }
      stripeSubscriptionId = subscription.id;
    } catch (stripeErr: any) {
      await prisma.user.delete({ where: { id: agencyUser.id } }).catch(() => {});
      const code = stripeErr?.code || stripeErr?.type;
      const rawMsg = String(stripeErr?.message || stripeErr?.raw?.message || '');
      console.error('Agency register Stripe failed:', code, rawMsg);
      if (stripeErr?.decline_code || code === 'card_declined') {
        return res.status(400).json({ message: rawMsg || 'Card was declined. Try a different card.' });
      }
      if (/No such payment_method|invalid|already been attached/i.test(rawMsg)) {
        return res.status(400).json({ message: 'Payment method invalid or already used. Please enter your card again.' });
      }
      return res.status(400).json({ message: rawMsg || 'Failed to save card. Please try again.' });
    }

    const agency = await prisma.agency.create({
      data: {
        name,
        subdomain: subdomain?.trim() || null,
        billingType: 'paid',
        stripeCustomerId,
        stripeSubscriptionId,
        subscriptionTier: reportingTier,
        website: websiteNormalized,
        industry: industry || null,
        agencySize: agencySize || null,
        numberOfClients: numberOfClients ?? null,
        contactName: contactName || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        contactJobTitle: contactJobTitle || null,
        streetAddress: streetAddress || null,
        city: city || null,
        state: state || null,
        zip: zip || null,
        country: country || null,
        customPricing: null,
        internalNotes: null,
        onboardingData,
        trialEndsAt,
      },
      include: { _count: { select: { members: true } } },
    });

    if (stripeCustomerId) {
      stripe.customers.update(stripeCustomerId, { metadata: { agencyId: agency.id } }).catch((e: any) =>
        console.warn('Stripe customer metadata update failed:', e?.message)
      );
    }

    await prisma.userAgency.create({
      data: {
        userId: agencyUser.id,
        agencyId: agency.id,
        agencyRole: 'OWNER',
      },
    });

    const agencyDashboardName = `${name} - Agency Website`;
    const agencyDashboardDomain = `agency-${agency.id}.internal`;
    try {
      const agencyDashboardClient = await prisma.client.create({
        data: {
          name: agencyDashboardName,
          domain: agencyDashboardDomain,
          userId: agencyUser.id,
          belongsToAgencyId: agency.id,
          isAgencyOwnDashboard: true,
          status: 'DASHBOARD_ONLY',
          managedServiceStatus: 'none',
        },
      });
      await prisma.clientAgencyIncluded.upsert({
        where: { clientId_agencyId: { clientId: agencyDashboardClient.id, agencyId: agency.id } },
        update: {},
        create: { clientId: agencyDashboardClient.id, agencyId: agency.id },
      });
    } catch (dashboardErr: any) {
      console.warn('Agency register: auto dashboard create failed', dashboardErr?.message);
    }

    const verificationToken = jwt.sign(
      { userId: agencyUser.id },
      getJwtSecret(),
      { expiresIn: '24h' }
    );
    await prisma.token.create({
      data: {
        type: 'EMAIL_VERIFY',
        email: agencyUser.email,
        token: verificationToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        userId: agencyUser.id,
      },
    });

    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify?token=${encodeURIComponent(verificationToken)}`;
    try {
      await sendEmail({
        to: contactEmail,
        subject: `Verify your email - ${BRAND_DISPLAY_NAME}`,
        html: `
          <h1>Verify your ${BRAND_DISPLAY_NAME} account</h1>
          <p>Hi ${contactName || 'there'},</p>
          <p>Thanks for signing up <strong>${name}</strong>. Please verify your email by clicking the link below (expires in 24 hours):</p>
          <p><a href="${verifyUrl}">Verify my email</a></p>
          <p>If the link doesn't work, copy and paste this URL into your browser:</p>
          <p style="word-break:break-all">${verifyUrl}</p>
        `,
      });
    } catch (emailErr: any) {
      console.warn('Agency register: verification email failed', emailErr?.message);
    }

    // Notify super admins
    await prisma.notification.create({
      data: {
        agencyId: null,
        type: 'new_signup',
        title: 'New agency sign-up',
        message: `${name} signed up with a paid account.`,
        link: '/agency/agencies',
      },
    }).catch((e) => console.warn('Create signup notification failed:', e?.message));

    await notifySuperAdminsByEmail({
      subject: `New agency sign-up (${reportingTier}) - ${name}`,
      html: `
        <h2>New agency signed up with paid account</h2>
        <p><strong>Agency:</strong> ${name}</p>
        <p><strong>Contact:</strong> ${contactName || '-'}</p>
        <p><strong>Email:</strong> ${contactEmail}</p>
        <p><strong>Plan:</strong> ${reportingTier}</p>
        <p><strong>Created:</strong> ${new Date().toISOString()}</p>
      `,
    });

    res.status(201).json({
      message: 'Agency account created. Please check your email to verify your account.',
      agencyId: agency.id,
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      const first = error.errors?.[0];
      const msg = first ? (first.path?.join('.') + ' ' + first.message) : 'Invalid input';
      return res.status(400).json({ message: msg });
    }
    console.error('Agency register error:', error);
    res.status(500).json({ message: 'Failed to create agency account' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    console.log('[agencies] POST / – create agency attempt');
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Access denied. Only Super Admin can create agencies directly.' });
    }

    const body = createAgencySchema.parse(req.body);
    const {
      name,
      website,
      industry,
      agencySize,
      numberOfClients,
      contactName,
      contactEmail,
      contactPhone,
      contactJobTitle,
      streetAddress,
      city,
      state,
      zip,
      country,
      subdomain,
      billingOption,
      paymentMethodId,
      tier,
      customPricing,
      internalNotes,
      referralSource,
      referralSourceOther,
      primaryGoals,
      primaryGoalsOther,
      currentTools,
      resetPassword,
    } = body;

    if ((billingOption === 'charge' || billingOption === 'manual_invoice') && !paymentMethodId) {
      return res.status(400).json({
        message: billingOption === 'charge'
          ? 'Payment method is required when billing type is Charge to Card.'
          : 'Payment method is required when billing type is Enterprise.',
      });
    }
    if (billingOption === 'charge' || billingOption === 'manual_invoice') {
      const stripe = getStripe();
      if (!stripe || !isStripeConfigured()) {
        return res.status(400).json({
          message: 'Stripe is not configured. Set STRIPE_SECRET_KEY on the server for Charge to Card and Enterprise billing.',
        });
      }
    }
    if (!tier && billingOption !== 'manual_invoice' && billingOption !== 'no_charge' && billingOption !== 'free_account') {
      return res.status(400).json({ message: 'Subscription tier is required' });
    }

    const existingAgency = await prisma.agency.findFirst({ where: { name } });
    if (existingAgency) {
      return res.status(400).json({ message: 'Agency with this name already exists' });
    }

    if (subdomain && subdomain.trim()) {
      const existingSubdomain = await prisma.agency.findUnique({ where: { subdomain: subdomain.trim() } });
      if (existingSubdomain) {
        return res.status(400).json({ message: 'Subdomain already taken' });
      }
    }

    const existingUser = await prisma.user.findUnique({ where: { email: contactEmail } });
    if (existingUser) {
      return res.status(400).json({ message: 'A user with this contact email already exists' });
    }

    const billingType =
      billingOption === 'charge' ? 'paid'
      : billingOption === 'free_account' ? 'free'
      : billingOption === 'no_charge' ? 'trial'
      : 'custom';
    const onboardingPayload: Record<string, unknown> = {};
    if (referralSource || referralSourceOther) {
      onboardingPayload.referralSource = referralSource === 'referral' ? referralSourceOther : referralSource;
    }
    if (primaryGoals && primaryGoals.length) onboardingPayload.primaryGoals = primaryGoals;
    if (primaryGoalsOther) onboardingPayload.primaryGoalsOther = primaryGoalsOther;
    if (currentTools) onboardingPayload.currentTools = currentTools;
    // Super Admin "Charge to Card" agencies are already provisioned with billing + plan,
    // so onboarding should be considered complete at first login.
    if (billingOption === 'charge') onboardingPayload.submittedAt = new Date().toISOString();
    const onboardingData = Object.keys(onboardingPayload).length ? JSON.stringify(onboardingPayload) : null;

    // Super Admin–created agencies: 7-day trial only when "No Charge during 7 days trial" (free_account = free forever, no trial)
    const trialEndsAt =
      billingOption === "no_charge"
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        : null;

    // When "Charge to Card" or "Enterprise": create Stripe customer, attach payment method. Charge to Card also creates subscription.
    let stripeCustomerId: string | null = null;
    let stripeSubscriptionId: string | null = null;
    if (billingOption === 'charge' || billingOption === 'manual_invoice') {
      if (!paymentMethodId) {
        return res.status(400).json({
          message: 'Payment method is required.',
        });
      }
      if (billingOption === 'charge' && !tier) {
        return res.status(400).json({
          message: 'Subscription tier is required for Charge to Card.',
        });
      }
      const stripe = getStripe();
      if (!stripe || !isStripeConfigured()) {
        return res.status(400).json({ message: 'Stripe is not configured. Set STRIPE_SECRET_KEY on the server.' });
      }
      try {
        console.log('[agencies] Creating Stripe customer for', billingOption === 'charge' ? 'Charge to Card' : 'Enterprise');
        const customer = await stripe.customers.create({
          email: contactEmail,
          name: contactName || name,
        });
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
        await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: paymentMethodId } });
        stripeCustomerId = customer.id;

        if (billingOption === 'charge') {
          // Create subscription for the selected tier
          const tierPriceEnvKey = `STRIPE_PRICE_PLAN_${tier!.toUpperCase().replace(/-/g, '_')}`;
          const tierPriceId = (process.env as Record<string, string | undefined>)[tierPriceEnvKey];
          if (!tierPriceId || typeof tierPriceId !== 'string' || !tierPriceId.startsWith('price_')) {
            console.error('[agencies] Missing or invalid Stripe price for tier:', tierPriceEnvKey, tierPriceId ? '(set but not a price id)' : '(not set)');
            return res.status(400).json({
              message: `Billing is not configured for tier "${tier}". Add ${tierPriceEnvKey} to server .env with the Stripe Price ID (starts with price_).`,
            });
          }
          console.log('[agencies] Creating Stripe subscription for tier:', tier);
          const subscription = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: tierPriceId }],
            default_payment_method: paymentMethodId,
            payment_behavior: 'error_if_incomplete',
            payment_settings: { save_default_payment_method: 'on_subscription' },
          });
          if (subscription.status !== 'active' && subscription.status !== 'trialing') {
            await stripe.subscriptions.cancel(subscription.id).catch(() => {});
            return res.status(400).json({
              message: 'The first payment could not be completed. Try a different card or use test card 4242 4242 4242 4242. If your card requires verification, complete it and try again.',
            });
          }
          stripeSubscriptionId = subscription.id;
          console.log('[agencies] Stripe subscription created:', subscription.id, 'status=', subscription.status);
        }
        // Enterprise: customer + payment method only, no subscription (manual invoicing)
      } catch (stripeErr: any) {
        const code = stripeErr?.code || stripeErr?.type;
        const rawMsg = String(stripeErr?.message || stripeErr?.raw?.message || '');
        console.error('Stripe customer/subscription failed:', code, rawMsg, stripeErr?.raw?.decline_code);
        let userMessage: string;
        if (/connection|ENOTFOUND|network|timeout/i.test(rawMsg)) {
          userMessage = 'Could not reach Stripe. Check your internet connection and try again.';
        } else if (code === 'resource_missing' || /No such payment_method|payment_method.*invalid/i.test(rawMsg)) {
          userMessage = 'Payment method expired or invalid. Please close this form, open it again, and enter card details again.';
        } else if (/already been attached|already attached/i.test(rawMsg)) {
          userMessage = 'This card was already used. Please use a different card or try again in a moment.';
        } else if (stripeErr?.decline_code || code === 'card_declined') {
          userMessage = rawMsg || 'Card was declined. Try a different card or use test card 4242 4242 4242 4242 in test mode.';
        } else {
          userMessage = rawMsg || 'Failed to save card or create subscription. Please try again.';
        }
        return res.status(400).json({ message: userMessage });
      }
    }

    // Safeguard: Charge to Card must have Stripe customer + subscription; Enterprise must have customer
    if (billingOption === 'charge' && (!stripeCustomerId || !stripeSubscriptionId)) {
      console.error('[agencies] Charge to Card selected but Stripe customer or subscription missing');
      return res.status(500).json({ message: 'Could not set up billing. Please try again or contact support.' });
    }
    if (billingOption === 'manual_invoice' && !stripeCustomerId) {
      console.error('[agencies] Enterprise selected but Stripe customer missing');
      return res.status(500).json({ message: 'Could not set up Stripe. Please try again or contact support.' });
    }

    const agency = await prisma.agency.create({
      data: {
        name,
        subdomain: subdomain?.trim() || null,
        billingType,
        stripeCustomerId,
        stripeSubscriptionId,
        website: website || null,
        industry: industry || null,
        agencySize: agencySize || null,
        numberOfClients: numberOfClients ?? null,
        contactName: contactName || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        contactJobTitle: contactJobTitle || null,
        streetAddress: streetAddress || null,
        city: city || null,
        state: state || null,
        zip: zip || null,
        country: country || null,
        subscriptionTier: (billingOption === 'no_charge' || billingOption === 'free_account') ? 'free' : (tier || null),
        customPricing: customPricing ?? null,
        internalNotes: internalNotes || null,
        enterpriseMaxDashboards: body.enterpriseMaxDashboards ?? null,
        enterpriseKeywordsTotal: body.enterpriseKeywordsTotal ?? null,
        enterpriseCreditsPerMonth: body.enterpriseCreditsPerMonth ?? null,
        enterpriseMaxTeamUsers: body.enterpriseMaxTeamUsers ?? null,
        onboardingData,
        trialEndsAt,
      },
      include: { _count: { select: { members: true } } },
    });
    console.log('[agencies] Agency created:', agency.id, agency.name);

    // Set Stripe customer metadata now that we have agency.id
    if (stripeCustomerId) {
      const stripe = getStripe();
      if (stripe) {
        stripe.customers.update(stripeCustomerId, { metadata: { agencyId: agency.id } }).catch((e) => console.warn('Stripe customer metadata update failed:', e?.message));
      }
    }

    const passwordHash = resetPassword ? await bcrypt.hash(resetPassword, 12) : null;
    const agencyUser = await prisma.user.create({
      data: {
        email: contactEmail,
        name: contactName,
        passwordHash,
        role: 'AGENCY',
        verified: Boolean(passwordHash),
        invited: !passwordHash,
      },
    });

    await prisma.userAgency.create({
      data: {
        userId: agencyUser.id,
        agencyId: agency.id,
        agencyRole: 'OWNER',
      },
    });

    // Automatic agency dashboard: one client dashboard for the agency itself (does not count toward tier limit)
    const agencyDashboardName = `${name} - Agency Website`;
    const agencyDashboardDomain = `agency-${agency.id}.internal`;
    try {
      const agencyDashboardClient = await prisma.client.create({
        data: {
          name: agencyDashboardName,
          domain: agencyDashboardDomain,
          userId: agencyUser.id,
          belongsToAgencyId: agency.id,
          isAgencyOwnDashboard: true,
          status: 'DASHBOARD_ONLY',
          managedServiceStatus: 'none',
        },
      });
      await prisma.clientAgencyIncluded.upsert({
        where: { clientId_agencyId: { clientId: agencyDashboardClient.id, agencyId: agency.id } },
        update: {},
        create: { clientId: agencyDashboardClient.id, agencyId: agency.id },
      });
    } catch (dashboardErr: any) {
      console.warn('Auto agency dashboard create failed:', dashboardErr?.message);
    }

    if (!passwordHash) {
      const inviteToken = jwt.sign(
        { userId: agencyUser.id, email: agencyUser.email },
        getJwtSecret(),
        { expiresIn: '24h' }
      );
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.token.create({
        data: {
          type: 'INVITE',
          email: agencyUser.email,
          token: inviteToken,
          expiresAt,
          userId: agencyUser.id,
          agencyId: agency.id,
          role: 'AGENCY',
        },
      });

      const inviteUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/invite?token=${encodeURIComponent(inviteToken)}`;
      try {
        await sendEmail({
          to: contactEmail,
          subject: `Set your password - ${BRAND_DISPLAY_NAME}`,
          html: `
            <h1>Your ${BRAND_DISPLAY_NAME} account is ready</h1>
            <p>Hi ${contactName || 'there'},</p>
            <p>An agency account for <strong>${name}</strong> has been created. Set your password using the link below (expires in 24 hours):</p>
            <p><a href="${inviteUrl}">Set your password</a></p>
            <p>If the link doesn't work, copy and paste this URL into your browser:</p>
            <p style="word-break:break-all">${inviteUrl}</p>
          `,
        });
      } catch (emailErr: any) {
        console.warn('Set-password email failed:', emailErr?.message);
      }
    } else if (billingOption === 'free_account' || billingOption === 'no_charge') {
      const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/login`;
      const defaultStep4PathLabel =
        billingOption === 'free_account'
          ? 'Continue with free account'
          : 'Add credit card + choose a plan (7-day free trial)';
      const currentStatusLabel =
        billingOption === 'free_account'
          ? 'Active - Free Account'
          : 'Trial - No Charge (7 days)';
      try {
        await sendEmail({
          to: contactEmail,
          subject: `Your agency account is ready - ${BRAND_DISPLAY_NAME}`,
          html: `
            <h1>Your ${BRAND_DISPLAY_NAME} agency account is ready</h1>
            <p>Hi ${contactName || 'there'},</p>
            <p>A Super Admin created your agency account. You can sign in immediately with the credentials below.</p>
            <h3>Account details</h3>
            <p><strong>Agency:</strong> ${name}</p>
            <p><strong>Email:</strong> ${contactEmail}</p>
            <p><strong>Password:</strong> ${resetPassword}</p>
            <p><strong>Billing setup:</strong> ${billingOption === 'free_account' ? 'Free Account' : 'No Charge during 7 days trial'}</p>
            <p><strong>Current status:</strong> ${currentStatusLabel}</p>
            <p><a href="${loginUrl}">Sign in</a></p>
            <p>If the button doesn't work, copy and paste this URL into your browser:</p>
            <p style="word-break:break-all">${loginUrl}</p>
          `,
        });
      } catch (emailErr: any) {
        console.warn('Agency credentials email failed:', emailErr?.message);
      }
    }

    await prisma.notification.create({
      data: {
        agencyId: null,
        userId: null,
        type: 'agency_created',
        title: 'Agency created',
        message: `${name} was created from Super Admin panel.`,
        link: '/agency/agencies',
      },
    }).catch((e) => console.warn('Create Super Admin agency-created notification failed:', e?.message));

    const billingLabel =
      billingOption === 'charge'
        ? `Paid (${tier || 'tier not set'})`
        : billingOption === 'free_account'
          ? 'Free account'
          : billingOption === 'no_charge'
            ? '7-day no-charge trial'
            : 'Enterprise / manual invoice';
    await notifySuperAdminsByEmail({
      subject: `Agency created by Super Admin - ${name}`,
      html: `
        <h2>New agency created from Super Admin panel</h2>
        <p><strong>Agency:</strong> ${name}</p>
        <p><strong>Contact:</strong> ${contactName || '-'}</p>
        <p><strong>Email:</strong> ${contactEmail}</p>
        <p><strong>Billing:</strong> ${billingLabel}</p>
        <p><strong>Created:</strong> ${new Date().toISOString()}</p>
      `,
    });

    res.status(201).json({
      id: agency.id,
      name: agency.name,
      subdomain: agency.subdomain,
      createdAt: agency.createdAt,
      memberCount: (agency as unknown as { _count: { members: number } })._count.members,
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      console.log('[agencies] Create failed: validation', error.errors?.map((e: any) => e.path?.join('.') + ' ' + e.message));
      return res.status(400).json({ message: 'Invalid input', errors: error.errors });
    }
    if (error.code === 'P2002') {
      const field = error.meta?.target?.[0];
      return res.status(400).json({ 
        message: `Agency with this ${field} already exists`,
        field 
      });
    }
    console.error('Create agency error:', error);
    res.status(500).json({ message: 'Failed to create agency' });
  }
});

// Get current user's agency (includes tier for UI). Must be BEFORE /:agencyId so "me" is not captured.
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = req.user;

    // SUPER_ADMIN users don't have agency memberships - return null gracefully
    if (user.role === 'SUPER_ADMIN') {
      return res.json(null);
    }

    // Get user's first agency membership
    const membership = await prisma.userAgency.findFirst({
      where: { userId: user.userId },
      include: {
        agency: true,
      },
    });

    if (!membership) {
      return res.status(404).json({ message: 'No agency found for user' });
    }

    const tierConfig = getTierConfig(membership.agency.subscriptionTier);
    const trialEndsAt = membership.agency.trialEndsAt ?? null;
    const now = new Date();
    const trialActive = trialEndsAt && trialEndsAt > now;
    const trialDaysLeft =
      trialEndsAt && trialEndsAt > now
        ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86400000))
        : null;
    const billingType = membership.agency.billingType ?? null;
    const trialExpired =
      trialEndsAt != null &&
      trialEndsAt <= now &&
      (billingType === 'free' || (billingType as string) === 'trial');

    const tierId = tierConfig?.id ?? null;
    const accountActivated = !!(membership.agency as { stripeCustomerId?: string | null }).stripeCustomerId;
    let onboardingData = parseAgencyOnboardingData(membership.agency.onboardingData);
    // Legacy agencies created before onboarding rollout should not be blocked by onboarding modal.
    // Use env override when needed; default cutoff keeps all already-existing agencies treated as legacy.
    const legacyOnboardingCutoffIso = process.env.LEGACY_ONBOARDING_CUTOFF_ISO || '2026-03-03T00:00:00.000Z';
    const legacyOnboardingCutoff = new Date(legacyOnboardingCutoffIso);
    const hasValidLegacyCutoff = !Number.isNaN(legacyOnboardingCutoff.getTime());
    const isLegacyAgency =
      hasValidLegacyCutoff &&
      membership.agency.createdAt <= legacyOnboardingCutoff;

    // Onboarding is considered complete only after explicit submission.
    // For legacy agencies, auto-backfill submittedAt once so they never see onboarding unexpectedly.
    let onboardingCompleted = Boolean(onboardingData?.submittedAt);
    if (!onboardingCompleted && isLegacyAgency && user.role === 'AGENCY') {
      const submittedAt = new Date().toISOString();
      const patchedOnboardingData = {
        ...(onboardingData ?? {}),
        submittedAt,
      };
      try {
        await prisma.agency.update({
          where: { id: membership.agency.id },
          data: { onboardingData: JSON.stringify(patchedOnboardingData) },
        });
        onboardingData = patchedOnboardingData;
        onboardingCompleted = true;
      } catch (patchErr: any) {
        console.warn('Legacy onboarding backfill failed:', membership.agency.id, patchErr?.message);
      }
    }
    const domainInstructions =
      membership.agency.customDomain && membership.agency.domainVerificationToken
        ? getDomainVerificationInstructions(membership.agency.customDomain, membership.agency.domainVerificationToken)
        : null;
    res.json({
      id: membership.agency.id,
      name: membership.agency.name,
      subdomain: membership.agency.subdomain,
      brandDisplayName: membership.agency.brandDisplayName ?? null,
      logoUrl: membership.agency.logoUrl ?? null,
      primaryColor: membership.agency.primaryColor ?? null,
      customDomain: membership.agency.customDomain ?? null,
      domainStatus: toDomainStatus(membership.agency.domainStatus),
      domainVerifiedAt: membership.agency.domainVerifiedAt?.toISOString() ?? null,
      sslIssuedAt: membership.agency.sslIssuedAt?.toISOString() ?? null,
      sslError: membership.agency.sslError ?? null,
      domainInstructions,
      createdAt: membership.agency.createdAt,
      agencyRole: membership.agencyRole,
      subscriptionTier: membership.agency.subscriptionTier ?? null,
      tierId,
      isBusinessTier: tierConfig?.type === "business",
      maxDashboards: tierConfig?.maxDashboards ?? null,
      trialEndsAt: trialEndsAt?.toISOString() ?? null,
      trialActive: !!trialActive,
      trialDaysLeft,
      trialExpired: trialExpired || undefined,
      billingType: billingType ?? undefined,
      accountActivated,
      website: membership.agency.website ?? null,
      industry: membership.agency.industry ?? null,
      agencySize: membership.agency.agencySize ?? null,
      numberOfClients: membership.agency.numberOfClients ?? null,
      contactName: membership.agency.contactName ?? null,
      contactEmail: membership.agency.contactEmail ?? null,
      contactPhone: membership.agency.contactPhone ?? null,
      contactJobTitle: membership.agency.contactJobTitle ?? null,
      streetAddress: membership.agency.streetAddress ?? null,
      city: membership.agency.city ?? null,
      state: membership.agency.state ?? null,
      zip: membership.agency.zip ?? null,
      country: membership.agency.country ?? null,
      onboardingData,
      onboardingCompleted,
      allowedAddOns: getAllowedAddOnOptions(tierId as TierId | null),
      basePriceMonthlyUsd: tierConfig?.priceMonthlyUsd ?? null,
    });
  } catch (error) {
    console.error('Get user agency error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Agency in-app notifications (for bell dropdown). Must be BEFORE /:agencyId.
router.get('/me/notifications', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    if (user.role === 'SUPER_ADMIN') {
      return res.json({ unreadCount: 0, items: [] });
    }

    // Build OR conditions: user-targeted notifications + agency-scoped ones
    const orConditions: any[] = [{ userId: user.userId }];

    const membership = await prisma.userAgency.findFirst({
      where: { userId: user.userId },
      select: { agencyId: true },
    });
    if (membership) {
      orConditions.push({ agencyId: membership.agencyId, userId: null });
    }

    const notifications = await prisma.notification.findMany({
      where: { OR: orConditions },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const unreadCount = notifications.filter((n) => !n.read).length;
    return res.json({
      unreadCount,
      items: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        link: n.link ?? '',
        createdAt: n.createdAt.toISOString(),
        read: n.read,
      })),
    });
  } catch (err: any) {
    console.error('Agency notifications error:', err);
    res.status(500).json({ message: err?.message || 'Failed to load notifications' });
  }
});

// Mark agency notifications as read
router.post('/me/notifications/mark-read', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    if (user.role === 'SUPER_ADMIN') {
      return res.json({ success: true });
    }

    const orConditions: any[] = [{ userId: user.userId }];
    const membership = await prisma.userAgency.findFirst({
      where: { userId: user.userId },
      select: { agencyId: true },
    });
    if (membership) {
      orConditions.push({ agencyId: membership.agencyId, userId: null });
    }

    const { ids } = req.body;
    if (Array.isArray(ids) && ids.length > 0) {
      await prisma.notification.updateMany({
        where: { id: { in: ids }, OR: orConditions },
        data: { read: true },
      });
    } else {
      await prisma.notification.updateMany({
        where: { OR: orConditions, read: false },
        data: { read: true },
      });
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error('Mark agency notifications read error:', err);
    res.status(500).json({ message: err?.message || 'Failed to mark notifications as read' });
  }
});

// Update agency settings (current user's agency). Must be BEFORE /:agencyId.
const updateAgencyMeSchema = z.object({
  name: z.string().min(1).optional(),
  website: z.string().optional(),
  industry: z.string().optional(),
  agencySize: z.string().optional(),
  numberOfClients: z.coerce.number().int().min(0).optional().nullable(),
  contactName: z.string().optional(),
  contactEmail: z.union([z.string().email(), z.literal(""), z.null()]).optional(),
  contactPhone: z.string().optional(),
  contactJobTitle: z.string().optional(),
  streetAddress: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  referralSource: z.string().optional(),
  referralSourceOther: z.string().optional(),
  primaryGoals: z.array(z.string()).optional(),
  primaryGoalsOther: z.string().optional(),
  currentTools: z.string().optional(),
  onboardingCompleted: z.boolean().optional(),
  subdomain: z.string().optional().nullable(),
  brandDisplayName: z.string().max(255).optional().nullable(),
  logoUrl: z.union([httpUrlSchema, z.literal(""), z.null()]).optional(),
  primaryColor: z.union([hexColorSchema, z.literal(""), z.null()]).optional(),
  customDomain: z.string().max(255).optional().nullable(),
});

router.put('/me', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const updateData = updateAgencyMeSchema.parse(req.body);

    // SUPER_ADMIN users don't have agency memberships
    if (user.role === 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'SUPER_ADMIN users cannot update agency settings' });
    }

    // Get user's first agency membership
    const membership = await prisma.userAgency.findFirst({
      where: { userId: user.userId },
      include: {
        agency: true,
      },
    });

    if (!membership) {
      return res.status(404).json({ message: 'No agency found for user' });
    }

    // Check permissions - only OWNER, ADMIN, or SUPER_ADMIN can update
    if (
      membership.agencyRole !== 'OWNER' &&
      user.role !== 'ADMIN' &&
      user.role !== 'SUPER_ADMIN'
    ) {
      return res.status(403).json({ message: 'Access denied. Only agency owners can update settings.' });
    }

    const nextSubdomain =
      updateData.subdomain === undefined
        ? undefined
        : (String(updateData.subdomain || "").trim() || null);
    const normalizedCustomDomain =
      updateData.customDomain === undefined
        ? undefined
        : normalizeDomainHost(updateData.customDomain);
    if (updateData.customDomain !== undefined && updateData.customDomain !== null && !normalizedCustomDomain) {
      return res.status(400).json({ message: "Custom domain must be a valid hostname (e.g. portal.example.com)" });
    }

    // Check if subdomain is already taken (if being updated)
    if (nextSubdomain && nextSubdomain !== membership.agency.subdomain) {
      const existingAgency = await prisma.agency.findUnique({
        where: { subdomain: nextSubdomain },
      });

      if (existingAgency) {
        return res.status(400).json({ message: 'Subdomain already taken' });
      }
    }

    // Check if custom domain is already taken (if being updated)
    if (normalizedCustomDomain && normalizedCustomDomain !== membership.agency.customDomain) {
      const existingCustomDomain = await prisma.agency.findFirst({
        where: { customDomain: normalizedCustomDomain },
        select: { id: true },
      });
      if (existingCustomDomain) {
        return res.status(400).json({ message: "Custom domain already taken" });
      }
    }

    const payload: Record<string, unknown> = {};
    if (updateData.name !== undefined) payload.name = updateData.name.trim();
    if (updateData.website !== undefined) payload.website = updateData.website?.trim() || null;
    if (updateData.industry !== undefined) payload.industry = updateData.industry?.trim() || null;
    if (updateData.agencySize !== undefined) payload.agencySize = updateData.agencySize?.trim() || null;
    if (updateData.numberOfClients !== undefined) payload.numberOfClients = updateData.numberOfClients ?? null;
    if (updateData.contactName !== undefined) payload.contactName = updateData.contactName?.trim() || null;
    if (updateData.contactEmail !== undefined) payload.contactEmail = String(updateData.contactEmail || "").trim().toLowerCase() || null;
    if (updateData.contactPhone !== undefined) payload.contactPhone = updateData.contactPhone?.trim() || null;
    if (updateData.contactJobTitle !== undefined) payload.contactJobTitle = updateData.contactJobTitle?.trim() || null;
    if (updateData.streetAddress !== undefined) payload.streetAddress = updateData.streetAddress?.trim() || null;
    if (updateData.city !== undefined) payload.city = updateData.city?.trim() || null;
    if (updateData.state !== undefined) payload.state = updateData.state?.trim() || null;
    if (updateData.zip !== undefined) payload.zip = updateData.zip?.trim() || null;
    if (updateData.country !== undefined) payload.country = updateData.country?.trim() || null;
    if (updateData.subdomain !== undefined) payload.subdomain = nextSubdomain;
    if (updateData.brandDisplayName !== undefined) payload.brandDisplayName = updateData.brandDisplayName?.trim() || null;
    if (updateData.logoUrl !== undefined) payload.logoUrl = updateData.logoUrl?.trim() || null;
    if (updateData.primaryColor !== undefined) payload.primaryColor = updateData.primaryColor || null;
    if (updateData.customDomain !== undefined) {
      payload.customDomain = normalizedCustomDomain ?? null;

      // Any domain change (including clear) resets verification/SSL state.
      if ((normalizedCustomDomain ?? null) !== (membership.agency.customDomain ?? null)) {
        payload.domainStatus = normalizedCustomDomain ? "PENDING_VERIFICATION" : "NONE";
        payload.domainVerificationToken = normalizedCustomDomain ? generateDomainVerificationToken() : null;
        payload.domainVerifiedAt = null;
        payload.sslIssuedAt = null;
        payload.sslError = null;
      }
    }

    const onboardingPatchRequested =
      updateData.referralSource !== undefined ||
      updateData.referralSourceOther !== undefined ||
      updateData.primaryGoals !== undefined ||
      updateData.primaryGoalsOther !== undefined ||
      updateData.currentTools !== undefined ||
      updateData.onboardingCompleted !== undefined;
    if (onboardingPatchRequested) {
      const existingOnboarding = parseAgencyOnboardingData(membership.agency.onboardingData) ?? {};
      const referralSourceRaw =
        updateData.referralSource !== undefined
          ? updateData.referralSource
          : String(existingOnboarding.referralSource || "");
      const referralSourceNormalized = String(referralSourceRaw || "").trim();
      const referralSourceOther =
        updateData.referralSourceOther !== undefined
          ? updateData.referralSourceOther
          : String(existingOnboarding.referralSourceOther || "");
      const primaryGoals =
        updateData.primaryGoals !== undefined
          ? updateData.primaryGoals
          : Array.isArray(existingOnboarding.primaryGoals)
            ? existingOnboarding.primaryGoals.map((goal: any) => String(goal))
            : [];
      const primaryGoalsOther =
        updateData.primaryGoalsOther !== undefined
          ? updateData.primaryGoalsOther
          : String(existingOnboarding.primaryGoalsOther || "");
      const currentTools =
        updateData.currentTools !== undefined
          ? updateData.currentTools
          : String(existingOnboarding.currentTools || "");
      const shouldMarkSubmitted =
        updateData.onboardingCompleted === true || Boolean(existingOnboarding.submittedAt);

      payload.onboardingData = JSON.stringify({
        referralSource: referralSourceNormalized || undefined,
        referralSourceOther: referralSourceNormalized === "referral" ? (String(referralSourceOther || "").trim() || undefined) : undefined,
        primaryGoals: Array.isArray(primaryGoals) ? primaryGoals.filter(Boolean) : [],
        primaryGoalsOther: String(primaryGoalsOther || "").trim() || undefined,
        currentTools: String(currentTools || "").trim() || undefined,
        submittedAt: shouldMarkSubmitted ? (existingOnboarding.submittedAt || new Date().toISOString()) : undefined,
      });
    }

    // Update agency
    const updatedAgency = await prisma.agency.update({
      where: { id: membership.agency.id },
      data: payload,
    });
    const onboardingData = parseAgencyOnboardingData(updatedAgency.onboardingData);
    const onboardingCompleted = Boolean(onboardingData?.submittedAt);
    const domainInstructions =
      updatedAgency.customDomain && updatedAgency.domainVerificationToken
        ? getDomainVerificationInstructions(updatedAgency.customDomain, updatedAgency.domainVerificationToken)
        : null;

    res.json({
      id: updatedAgency.id,
      name: updatedAgency.name,
      subdomain: updatedAgency.subdomain,
      brandDisplayName: updatedAgency.brandDisplayName ?? null,
      logoUrl: updatedAgency.logoUrl ?? null,
      primaryColor: updatedAgency.primaryColor ?? null,
      customDomain: updatedAgency.customDomain ?? null,
      domainStatus: toDomainStatus(updatedAgency.domainStatus),
      domainVerifiedAt: updatedAgency.domainVerifiedAt?.toISOString() ?? null,
      sslIssuedAt: updatedAgency.sslIssuedAt?.toISOString() ?? null,
      sslError: updatedAgency.sslError ?? null,
      domainInstructions,
      createdAt: updatedAgency.createdAt,
      website: updatedAgency.website ?? null,
      industry: updatedAgency.industry ?? null,
      agencySize: updatedAgency.agencySize ?? null,
      numberOfClients: updatedAgency.numberOfClients ?? null,
      contactName: updatedAgency.contactName ?? null,
      contactEmail: updatedAgency.contactEmail ?? null,
      contactPhone: updatedAgency.contactPhone ?? null,
      contactJobTitle: updatedAgency.contactJobTitle ?? null,
      streetAddress: updatedAgency.streetAddress ?? null,
      city: updatedAgency.city ?? null,
      state: updatedAgency.state ?? null,
      zip: updatedAgency.zip ?? null,
      country: updatedAgency.country ?? null,
      onboardingData,
      onboardingCompleted,
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ message: 'Invalid input', errors: error.errors });
    }
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'Subdomain already taken' });
    }
    console.error('Update agency error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Verify custom domain ownership for current user's agency.
router.post('/me/domain/verify', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'SUPER_ADMIN users cannot verify agency custom domains' });
    }

    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership) return res.status(404).json({ message: 'No agency found for user' });

    const customDomain = membership.agency.customDomain;
    if (!customDomain) {
      return res.status(400).json({ message: 'Set a custom domain before running verification.' });
    }

    let verificationToken = membership.agency.domainVerificationToken;
    if (!verificationToken) {
      verificationToken = generateDomainVerificationToken();
      await prisma.agency.update({
        where: { id: membership.agency.id },
        data: {
          domainVerificationToken: verificationToken,
          domainStatus: "PENDING_VERIFICATION",
          domainVerifiedAt: null,
          sslIssuedAt: null,
          sslError: null,
        },
      });
    }

    const verification = await verifyCustomDomainViaDns(customDomain, verificationToken);
    const instructions = getDomainVerificationInstructions(customDomain, verificationToken);
    if (!verification.verified) {
      const failed = await prisma.agency.update({
        where: { id: membership.agency.id },
        data: {
          domainStatus: "PENDING_VERIFICATION",
          sslError: verification.reason || "Domain verification failed",
        },
      });
      return res.json({
        verified: false,
        message: verification.reason || 'Domain verification failed',
        domainStatus: toDomainStatus(failed.domainStatus),
        customDomain: failed.customDomain,
        instructions,
      });
    }

    const now = new Date();
    const updated = await prisma.agency.update({
      where: { id: membership.agency.id },
      data: {
        domainStatus: "VERIFIED",
        domainVerifiedAt: now,
        sslError: null,
      },
    });

    return res.json({
      verified: true,
      message: 'Domain verified successfully.',
      customDomain: updated.customDomain,
      domainStatus: toDomainStatus(updated.domainStatus),
      domainVerifiedAt: updated.domainVerifiedAt?.toISOString() ?? null,
      instructions,
    });
  } catch (error: any) {
    console.error('Verify custom domain error:', error);
    return res.status(500).json({ message: error?.message || 'Failed to verify custom domain' });
  }
});

// Request SSL provisioning after domain verification.
router.post('/me/domain/provision-ssl', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'SUPER_ADMIN users cannot provision agency custom domains' });
    }

    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership) return res.status(404).json({ message: 'No agency found for user' });

    const customDomain = membership.agency.customDomain;
    if (!customDomain) {
      return res.status(400).json({ message: 'Set a custom domain before provisioning SSL.' });
    }
    if (membership.agency.domainStatus !== "VERIFIED" && membership.agency.domainStatus !== "ACTIVE") {
      return res.status(400).json({ message: 'Verify your custom domain before provisioning SSL.' });
    }

    await prisma.agency.update({
      where: { id: membership.agency.id },
      data: {
        domainStatus: "SSL_PENDING",
        sslError: null,
      },
    });

    const provisioning = await requestSslProvisioning(customDomain);
    if (!provisioning.accepted) {
      const failed = await prisma.agency.update({
        where: { id: membership.agency.id },
        data: {
          domainStatus: "FAILED",
          sslError: provisioning.reason || "SSL provisioning failed",
        },
      });
      return res.status(400).json({
        message: provisioning.reason || 'SSL provisioning failed',
        domainStatus: toDomainStatus(failed.domainStatus),
      });
    }

    if (!provisioning.issued) {
      const pending = await prisma.agency.update({
        where: { id: membership.agency.id },
        data: {
          domainStatus: "SSL_PENDING",
          sslError: null,
        },
      });
      return res.json({
        message: 'DNS records look good. SSL issuance request accepted and is pending. Please allow up to 24 hours.',
        customDomain: pending.customDomain,
        domainStatus: toDomainStatus(pending.domainStatus),
        sslIssuedAt: pending.sslIssuedAt?.toISOString() ?? null,
      });
    }

    const now = new Date();
    const updated = await prisma.agency.update({
      where: { id: membership.agency.id },
      data: {
        domainStatus: "ACTIVE",
        sslIssuedAt: now,
        sslError: null,
      },
    });

    return res.json({
      message: 'SSL provisioned successfully.',
      customDomain: updated.customDomain,
      domainStatus: toDomainStatus(updated.domainStatus),
      sslIssuedAt: updated.sslIssuedAt?.toISOString() ?? null,
    });
  } catch (error: any) {
    console.error('Provision SSL error:', error);
    return res.status(500).json({ message: error?.message || 'Failed to provision SSL' });
  }
});

// Static routes must be before /:agencyId to avoid "managed-services", "add-ons" etc. being captured as agencyId.

// Managed Services: list active for current user's agency (AGENCY, ADMIN, SUPER_ADMIN only; no SPECIALIST)
router.get('/managed-services', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    if (user.role === 'SPECIALIST') {
      return res.status(403).json({ message: 'Access denied. Specialists cannot view managed services.' });
    }
    const membership = await prisma.userAgency.findFirst({
      where: { userId: user.userId },
      select: { agencyId: true },
    });
    if (!membership && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      return res.json([]);
    }
    const pendingOnly = req.query.pendingOnly === 'true' && (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN');
    const agencyId = membership?.agencyId;

    if (pendingOnly) {
      const list = await prisma.managedService.findMany({
        where: { status: 'PENDING' },
        include: {
          client: { select: { id: true, name: true } },
          agency: { select: { id: true, name: true } },
        },
        orderBy: { startDate: 'desc' },
      });
      return res.json(list.map((m) => ({
        id: m.id,
        clientId: m.clientId,
        clientName: m.client.name,
        packageId: m.packageId,
        packageName: m.packageName,
        monthlyPrice: m.monthlyPrice,
        commissionPercent: m.commissionPercent,
        monthlyCommission: m.monthlyCommission,
        startDate: m.startDate,
        status: m.status,
        agencyId: m.agency.id,
        agencyName: m.agency.name,
      })));
    }

    if (!agencyId && (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN')) {
      return res.json([]);
    }
    const list = await prisma.managedService.findMany({
      where: { agencyId, status: { in: ['ACTIVE', 'PENDING'] } },
      include: { client: { select: { id: true, name: true, status: true } } },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }], // ACTIVE before PENDING (asc), then newest first
    });
    // One row per client: prefer ACTIVE over PENDING so approved status always shows after Super Admin approval
    const byClient = new Map<string, typeof list[0]>();
    for (const m of list) {
      const existing = byClient.get(m.clientId);
      if (!existing || m.status === 'ACTIVE') byClient.set(m.clientId, m);
    }
    const deduped = Array.from(byClient.values());
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(deduped.map((m) => {
      const client = m.client as { id: string; name: string; status?: string };
      const clientActive = client.status === 'ACTIVE';
      const status = (m.status === 'ACTIVE' || clientActive) ? 'ACTIVE' : m.status;
      return {
        id: m.id,
        clientId: m.clientId,
        clientName: m.client.name,
        packageId: m.packageId,
        packageName: m.packageName,
        monthlyPrice: m.monthlyPrice,
        commissionPercent: m.commissionPercent,
        monthlyCommission: m.monthlyCommission,
        startDate: m.startDate,
        status,
      };
    }));
  } catch (err: any) {
    console.error('List managed services error:', err);
    res.status(500).json({ message: err?.message || 'Failed to list managed services' });
  }
});

// Add-Ons: list active for current user's agency
router.get('/add-ons', authenticateToken, async (req, res) => {
  try {
    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    if (!membership && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.json([]);
    }
    const agencyId = membership?.agencyId;
    if (!agencyId && (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN')) {
      return res.json([]);
    }
    const list = await prisma.agencyAddOn.findMany({
      where: { agencyId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(list.map((a) => ({
      id: a.id,
      addOnType: a.addOnType,
      addOnOption: a.addOnOption,
      displayName: a.displayName,
      details: a.details,
      priceCents: a.priceCents,
      billingInterval: a.billingInterval,
      createdAt: a.createdAt,
    })));
  } catch (err: any) {
    console.error('List add-ons error:', err);
    res.status(500).json({ message: err?.message || 'Failed to list add-ons' });
  }
});

const adjustResearchCreditsSchema = z.object({
  operation: z.enum(['grant', 'consume', 'set_used', 'set_remaining']).default('grant'),
  amount: z.coerce.number().int().min(0).optional(),
  used: z.coerce.number().int().min(0).optional(),
  remaining: z.coerce.number().int().min(0).optional(),
  reason: z.string().max(500).optional(),
}).superRefine((data, ctx) => {
  if ((data.operation === 'grant' || data.operation === 'consume') && data.amount === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['amount'],
      message: 'amount is required for grant/consume operations',
    });
  }
  if (data.operation === 'set_used' && data.used === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['used'],
      message: 'used is required for set_used operation',
    });
  }
  if (data.operation === 'set_remaining' && data.remaining === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['remaining'],
      message: 'remaining is required for set_remaining operation',
    });
  }
});

async function calculateAgencyResearchCreditsLimit(agencyId: string): Promise<number> {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: {
      subscriptionTier: true,
      billingType: true,
      enterpriseCreditsPerMonth: true,
    },
  });
  if (!agency) return 0;

  const tierConfig =
    getTierConfig(agency.subscriptionTier) ??
    (agency.billingType === 'free' || agency.billingType === 'trial'
      ? getTierConfig('free')
      : getTierConfig(DEFAULT_TIER_ID));

  let creditsLimit = agency.enterpriseCreditsPerMonth ?? tierConfig?.researchCreditsPerMonth ?? 0;

  const addOns = await prisma.agencyAddOn.findMany({
    where: { agencyId, addOnType: 'extra_keyword_lookups' },
    select: { addOnOption: true },
  });
  for (const a of addOns) {
    if (a.addOnOption === '50') creditsLimit += 50;
    else if (a.addOnOption === '150') creditsLimit += 150;
    else if (a.addOnOption === '300') creditsLimit += 300;
    // Legacy options
    else if (a.addOnOption === '100') creditsLimit += 100;
    else if (a.addOnOption === '500') creditsLimit += 500;
  }

  return Math.max(0, creditsLimit);
}

// Super Admin/Admin: adjust research credits for an agency (top-up, consume, or set values)
router.post('/:agencyId/research-credits/adjust', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied. Only Super Admin can adjust research credits.' });
    }

    const { agencyId } = req.params;
    const body = adjustResearchCreditsSchema.parse(req.body ?? {});

    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: {
        id: true,
        name: true,
        subscriptionTier: true,
        billingType: true,
        keywordResearchCreditsUsed: true,
        keywordResearchCreditsResetAt: true,
      },
    });
    if (!agency) {
      return res.status(404).json({ message: 'Agency not found' });
    }

    const tierConfig =
      getTierConfig(agency.subscriptionTier) ??
      (agency.billingType === 'free' || agency.billingType === 'trial'
        ? getTierConfig('free')
        : getTierConfig(DEFAULT_TIER_ID));
    const isFreeOnetime = tierConfig?.id === 'free';
    const creditsLimit = await calculateAgencyResearchCreditsLimit(agencyId);

    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    let effectiveUsed = Number.isFinite(agency.keywordResearchCreditsUsed)
      ? Number(agency.keywordResearchCreditsUsed)
      : 0;
    let effectiveResetAt = agency.keywordResearchCreditsResetAt;

    // For paid tiers, align to the same reset behavior used by runtime checks.
    if (!isFreeOnetime && (!effectiveResetAt || now > effectiveResetAt)) {
      effectiveUsed = 0;
      effectiveResetAt = endOfMonth;
    }

    const beforeUsed = effectiveUsed;
    let afterUsed = effectiveUsed;

    if (body.operation === 'grant') {
      // Allow "top-up" beyond base monthly cap by carrying negative used credits this period.
      afterUsed = effectiveUsed - (body.amount ?? 0);
    } else if (body.operation === 'consume') {
      afterUsed = Math.max(0, effectiveUsed + (body.amount ?? 0));
    } else if (body.operation === 'set_used') {
      afterUsed = Math.max(0, body.used ?? 0);
    } else if (body.operation === 'set_remaining') {
      const desiredRemaining = Math.max(0, body.remaining ?? 0);
      afterUsed = Math.max(0, creditsLimit - desiredRemaining);
    }

    await prisma.agency.update({
      where: { id: agencyId },
      data: {
        keywordResearchCreditsUsed: afterUsed,
        ...(effectiveResetAt ? { keywordResearchCreditsResetAt: effectiveResetAt } : {}),
      },
    });

    if (body.reason?.trim()) {
      console.log('[Research Credits Adjusted]', {
        byUserId: req.user.userId,
        role: req.user.role,
        agencyId,
        agencyName: agency.name,
        operation: body.operation,
        amount: body.amount ?? null,
        used: body.used ?? null,
        remaining: body.remaining ?? null,
        beforeUsed,
        afterUsed,
        reason: body.reason.trim(),
      });
    }

    const beforeRemaining = Math.max(0, creditsLimit - beforeUsed);
    const afterRemaining = Math.max(0, creditsLimit - afterUsed);

    // Notify agency members in-app when Super Admin grants credits.
    if (body.operation === 'grant') {
      const grantedCredits = Math.max(0, Number(body.amount ?? 0));
      const reasonText = body.reason?.trim() ? body.reason.trim() : 'No reason provided.';
      await prisma.notification.create({
        data: {
          agencyId: agency.id,
          type: 'research_credits_granted',
          title: `Research credits granted (+${grantedCredits})`,
          message: `Super Admin granted ${grantedCredits} research credits. Reason: ${reasonText}`,
          link: '/agency/dashboard',
        },
      }).catch((e) => console.warn('Create research credits notification failed:', e?.message));
    }

    return res.json({
      message: 'Research credits updated',
      agency: {
        id: agency.id,
        name: agency.name,
      },
      operation: body.operation,
      creditsLimit,
      before: {
        used: beforeUsed,
        remaining: beforeRemaining,
      },
      after: {
        used: afterUsed,
        remaining: afterRemaining,
      },
      resetAt: effectiveResetAt,
    });
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      return res.status(400).json({ message: 'Invalid input', errors: error.errors });
    }
    console.error('Adjust research credits error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Get single agency - full details for edit form
router.get('/:agencyId([a-zA-Z0-9]{16,})', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const { agencyId } = req.params;
    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
    });
    if (!agency) {
      return res.status(404).json({ message: 'Agency not found' });
    }
    res.json({
      id: agency.id,
      name: agency.name,
      subdomain: agency.subdomain,
      brandDisplayName: agency.brandDisplayName ?? null,
      logoUrl: agency.logoUrl ?? null,
      primaryColor: agency.primaryColor ?? null,
      customDomain: agency.customDomain ?? null,
      domainStatus: toDomainStatus(agency.domainStatus),
      domainVerifiedAt: agency.domainVerifiedAt?.toISOString() ?? null,
      sslIssuedAt: agency.sslIssuedAt?.toISOString() ?? null,
      sslError: agency.sslError ?? null,
      website: agency.website,
      industry: agency.industry,
      agencySize: agency.agencySize,
      numberOfClients: agency.numberOfClients,
      contactName: agency.contactName,
      contactEmail: agency.contactEmail,
      contactPhone: agency.contactPhone,
      contactJobTitle: agency.contactJobTitle,
      streetAddress: agency.streetAddress,
      city: agency.city,
      state: agency.state,
      zip: agency.zip,
      country: agency.country,
      billingType: agency.billingType ?? null,
      subscriptionTier: agency.subscriptionTier ?? null,
      customPricing: agency.customPricing ? Number(agency.customPricing) : null,
      internalNotes: agency.internalNotes,
      enterpriseMaxDashboards: agency.enterpriseMaxDashboards,
      enterpriseKeywordsTotal: agency.enterpriseKeywordsTotal,
      enterpriseCreditsPerMonth: agency.enterpriseCreditsPerMonth,
      enterpriseMaxTeamUsers: agency.enterpriseMaxTeamUsers,
      createdAt: agency.createdAt,
      hasStripeCustomer: !!agency.stripeCustomerId,
    });
  } catch (error) {
    console.error('Get agency error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update agency (Super Admin only)
const updateAgencySuperAdminSchema = z.object({
  name: z.string().min(1).optional(),
  website: z.string().optional(),
  industry: z.string().optional(),
  agencySize: z.string().optional(),
  numberOfClients: z.coerce.number().int().min(0).optional().nullable(),
  contactName: z.string().optional(),
  contactEmail: z.union([z.string().email(), z.literal('')]).optional(),
  contactPhone: z.string().optional(),
  contactJobTitle: z.string().optional(),
  streetAddress: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  subdomain: z.string().optional().nullable(),
  billingType: z.enum(['paid', 'free', 'trial', 'custom']).optional().nullable(),
  subscriptionTier: z.string().optional().nullable(),
  customPricing: z.coerce.number().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  enterpriseMaxDashboards: z.coerce.number().int().min(1).optional().nullable(),
  enterpriseKeywordsTotal: z.coerce.number().int().min(1).optional().nullable(),
  enterpriseCreditsPerMonth: z.coerce.number().int().min(0).optional().nullable(),
  enterpriseMaxTeamUsers: z.coerce.number().int().min(1).optional().nullable(),
  brandDisplayName: z.string().max(255).optional().nullable(),
  logoUrl: z.union([httpUrlSchema, z.literal(''), z.null()]).optional(),
  primaryColor: z.union([hexColorSchema, z.literal(''), z.null()]).optional(),
  customDomain: z.string().max(255).optional().nullable(),
  domainStatus: z.enum(domainStatusOrder).optional(),
  paymentMethodId: z.string().optional(), // required when billingType is paid or custom and agency has no Stripe customer
  resetPassword: z.string().min(6, 'Password must be at least 6 characters').optional(),
  resetPasswordConfirm: z.string().optional(),
}).refine((data) => {
  const w = data.website;
  if (!w || w === '') return true;
  try {
    new URL(w.startsWith('http') ? w : `https://${w}`);
    return true;
  } catch {
    return false;
  }
}, { message: 'Agency website must be a valid URL', path: ['website'] }).refine((data) => {
  if (!data.resetPassword && !data.resetPasswordConfirm) return true;
  return data.resetPassword === data.resetPasswordConfirm;
}, { message: 'Passwords do not match', path: ['resetPasswordConfirm'] });

router.put('/:agencyId([a-zA-Z0-9]{16,})', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const { agencyId } = req.params;
    const updateData = updateAgencySuperAdminSchema.parse(req.body);

    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
    });
    if (!agency) {
      return res.status(404).json({ message: 'Agency not found' });
    }

    // When subdomain key is present (including "" or null), update to trimmed value or null; when key is undefined, leave DB unchanged
    const newSubdomain =
      updateData.subdomain === undefined
        ? undefined
        : (String(updateData.subdomain).trim() || null);
    const normalizedCustomDomain =
      updateData.customDomain === undefined
        ? undefined
        : normalizeDomainHost(updateData.customDomain);
    if (updateData.customDomain !== undefined && updateData.customDomain !== null && !normalizedCustomDomain) {
      return res.status(400).json({ message: 'Custom domain must be a valid hostname (e.g. portal.example.com)' });
    }
    if (newSubdomain !== undefined && newSubdomain !== agency.subdomain && newSubdomain) {
      const existing = await prisma.agency.findFirst({
        where: { subdomain: newSubdomain },
      });
      if (existing) {
        return res.status(400).json({ message: 'Subdomain already taken' });
      }
    }
    if (normalizedCustomDomain !== undefined && normalizedCustomDomain !== agency.customDomain && normalizedCustomDomain) {
      const existingCustomDomain = await prisma.agency.findFirst({
        where: {
          customDomain: normalizedCustomDomain,
          id: { not: agencyId },
        },
        select: { id: true },
      });
      if (existingCustomDomain) {
        return res.status(400).json({ message: 'Custom domain already taken' });
      }
    }

    const payload: Record<string, unknown> = {};
    const needsStripe = updateData.billingType === 'paid' || updateData.billingType === 'custom';
    const hasStripeCustomer = !!agency.stripeCustomerId;
    if (needsStripe && !hasStripeCustomer && !updateData.paymentMethodId) {
      return res.status(400).json({
        message: 'Payment method is required when setting billing to Charge to Card or Enterprise. Please add card details.',
      });
    }
    if (updateData.paymentMethodId && needsStripe) {
      const stripe = getStripe();
      if (!stripe || !isStripeConfigured()) {
        return res.status(400).json({
          message: 'Stripe is not configured. Set STRIPE_SECRET_KEY on the server for Charge to Card and Enterprise billing.',
        });
      }
      try {
        let stripeCustomerId: string;
        if (agency.stripeCustomerId) {
          stripeCustomerId = agency.stripeCustomerId;
          await stripe.paymentMethods.attach(updateData.paymentMethodId, { customer: stripeCustomerId });
          await stripe.customers.update(stripeCustomerId, { invoice_settings: { default_payment_method: updateData.paymentMethodId } });
          console.log('[agencies] Updated payment method for agency', agencyId);
        } else {
          const customer = await stripe.customers.create({
            email: agency.contactEmail ?? undefined,
            name: agency.contactName ?? agency.name ?? undefined,
            metadata: { agencyId },
          });
          await stripe.paymentMethods.attach(updateData.paymentMethodId, { customer: customer.id });
          await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: updateData.paymentMethodId } });
          stripeCustomerId = customer.id;
          payload.stripeCustomerId = stripeCustomerId;
          console.log('[agencies] Created Stripe customer for agency', agencyId);
        }
      } catch (stripeErr: any) {
        const code = stripeErr?.code || stripeErr?.type;
        const rawMsg = String(stripeErr?.message || stripeErr?.raw?.message || '');
        console.error('Stripe update failed:', code, rawMsg);
        let userMessage: string;
        if (/connection|ENOTFOUND|network|timeout/i.test(rawMsg)) {
          userMessage = 'Could not reach Stripe. Check your internet connection and try again.';
        } else if (code === 'resource_missing' || /No such payment_method|payment_method.*invalid/i.test(rawMsg)) {
          userMessage = 'Payment method expired or invalid. Please try again.';
        } else if (/already been attached|already attached/i.test(rawMsg)) {
          userMessage = 'This card was already used. Please use a different card.';
        } else if (stripeErr?.decline_code || code === 'card_declined') {
          userMessage = rawMsg || 'Card was declined. Try a different card.';
        } else {
          userMessage = rawMsg || 'Failed to save card. Please try again.';
        }
        return res.status(400).json({ message: userMessage });
      }
    }
    if (updateData.name !== undefined) payload.name = updateData.name;
    if (updateData.website !== undefined) payload.website = updateData.website;
    if (updateData.industry !== undefined) payload.industry = updateData.industry;
    if (updateData.agencySize !== undefined) payload.agencySize = updateData.agencySize;
    if (updateData.numberOfClients !== undefined) payload.numberOfClients = updateData.numberOfClients;
    if (updateData.contactName !== undefined) payload.contactName = updateData.contactName;
    if (updateData.contactEmail !== undefined) {
      const email = String(updateData.contactEmail).trim();
      payload.contactEmail = email || null;
    }
    if (updateData.contactPhone !== undefined) payload.contactPhone = updateData.contactPhone;
    if (updateData.contactJobTitle !== undefined) payload.contactJobTitle = updateData.contactJobTitle;
    if (updateData.streetAddress !== undefined) payload.streetAddress = updateData.streetAddress;
    if (updateData.city !== undefined) payload.city = updateData.city;
    if (updateData.state !== undefined) payload.state = updateData.state;
    if (updateData.zip !== undefined) payload.zip = updateData.zip;
    if (updateData.country !== undefined) payload.country = updateData.country;
    if (updateData.subdomain !== undefined) payload.subdomain = newSubdomain ?? null;
    if (updateData.brandDisplayName !== undefined) payload.brandDisplayName = updateData.brandDisplayName?.trim() || null;
    if (updateData.logoUrl !== undefined) payload.logoUrl = updateData.logoUrl?.trim() || null;
    if (updateData.primaryColor !== undefined) payload.primaryColor = updateData.primaryColor || null;
    if (updateData.customDomain !== undefined) {
      payload.customDomain = normalizedCustomDomain ?? null;
      if ((normalizedCustomDomain ?? null) !== (agency.customDomain ?? null)) {
        payload.domainStatus = normalizedCustomDomain ? "PENDING_VERIFICATION" : "NONE";
        payload.domainVerificationToken = normalizedCustomDomain ? generateDomainVerificationToken() : null;
        payload.domainVerifiedAt = null;
        payload.sslIssuedAt = null;
        payload.sslError = null;
      }
    }
    if (updateData.domainStatus !== undefined) {
      payload.domainStatus = updateData.domainStatus;
      if (updateData.domainStatus === "NONE") {
        payload.customDomain = null;
        payload.domainVerificationToken = null;
        payload.domainVerifiedAt = null;
        payload.sslIssuedAt = null;
        payload.sslError = null;
      } else if (updateData.domainStatus === "VERIFIED") {
        payload.domainVerifiedAt = new Date();
        payload.sslError = null;
      } else if (updateData.domainStatus === "ACTIVE") {
        payload.domainVerifiedAt = agency.domainVerifiedAt ?? new Date();
        payload.sslIssuedAt = new Date();
        payload.sslError = null;
      }
    }
    if (updateData.billingType !== undefined) {
      payload.billingType = updateData.billingType;
      // When switching to trial: set trialEndsAt to 7 days from now if null or expired
      if (updateData.billingType === 'trial') {
        const now = new Date();
        const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const currentTrialEndsAt = agency.trialEndsAt;
        if (!currentTrialEndsAt || currentTrialEndsAt <= now) {
          payload.trialEndsAt = sevenDays;
        }
        payload.subscriptionTier = 'free';
      } else if (updateData.billingType === 'free') {
        // Free Account: no trial, free forever
        payload.trialEndsAt = null;
        payload.subscriptionTier = 'free';
      } else if (updateData.billingType === 'paid' || updateData.billingType === 'custom') {
        payload.trialEndsAt = null;
      }
    }
    if (updateData.subscriptionTier !== undefined && payload.billingType !== 'trial') payload.subscriptionTier = updateData.subscriptionTier;
    if (updateData.customPricing !== undefined) payload.customPricing = updateData.customPricing;
    if (updateData.internalNotes !== undefined) payload.internalNotes = updateData.internalNotes;
    if (updateData.enterpriseMaxDashboards !== undefined) payload.enterpriseMaxDashboards = updateData.enterpriseMaxDashboards;
    if (updateData.enterpriseKeywordsTotal !== undefined) payload.enterpriseKeywordsTotal = updateData.enterpriseKeywordsTotal;
    if (updateData.enterpriseCreditsPerMonth !== undefined) payload.enterpriseCreditsPerMonth = updateData.enterpriseCreditsPerMonth;
    if (updateData.enterpriseMaxTeamUsers !== undefined) payload.enterpriseMaxTeamUsers = updateData.enterpriseMaxTeamUsers;

    const updated = await prisma.agency.update({
      where: { id: agencyId },
      data: payload,
    });

    // Sync Primary Contact (contactName, contactEmail) to agency owner User so Team's Agency Access shows matching Full Name and Email
    const syncContact = updateData.contactName !== undefined || updateData.contactEmail !== undefined;
    if (syncContact) {
      const ownerMembership = await prisma.userAgency.findFirst({
        where: { agencyId, agencyRole: 'OWNER' },
        select: { userId: true },
      });
      if (ownerMembership) {
        const userPayload: { name?: string; email?: string } = {};
        if (updateData.contactName !== undefined) userPayload.name = updateData.contactName.trim() || undefined;
        if (updateData.contactEmail !== undefined) userPayload.email = updateData.contactEmail.trim().toLowerCase();
        if (Object.keys(userPayload).length > 0) {
          try {
            await prisma.user.update({
              where: { id: ownerMembership.userId },
              data: userPayload,
            });
          } catch (userErr: any) {
            if (userErr?.code === 'P2002') {
              return res.status(400).json({
                message: 'Contact email is already used by another account. Please use a different email.',
              });
            }
            throw userErr;
          }
        }
      }
    }

    if (updateData.resetPassword) {
      const ownerMembership = await prisma.userAgency.findFirst({
        where: { agencyId, agencyRole: 'OWNER' },
        select: { userId: true },
      });
      if (!ownerMembership) {
        return res.status(400).json({ message: 'Agency owner account not found for password reset.' });
      }
      const newPasswordHash = await bcrypt.hash(updateData.resetPassword, 12);
      await prisma.user.update({
        where: { id: ownerMembership.userId },
        data: {
          passwordHash: newPasswordHash,
          invited: false,
          verified: true,
        },
      });
    }

    res.json({
      id: updated.id,
      name: updated.name,
      subdomain: updated.subdomain,
      brandDisplayName: updated.brandDisplayName ?? null,
      logoUrl: updated.logoUrl ?? null,
      primaryColor: updated.primaryColor ?? null,
      customDomain: updated.customDomain ?? null,
      domainStatus: toDomainStatus(updated.domainStatus),
      domainVerifiedAt: updated.domainVerifiedAt?.toISOString() ?? null,
      sslIssuedAt: updated.sslIssuedAt?.toISOString() ?? null,
      sslError: updated.sslError ?? null,
      website: updated.website,
      industry: updated.industry,
      agencySize: updated.agencySize,
      numberOfClients: updated.numberOfClients,
      contactName: updated.contactName,
      contactEmail: updated.contactEmail,
      contactPhone: updated.contactPhone,
      contactJobTitle: updated.contactJobTitle,
      streetAddress: updated.streetAddress,
      city: updated.city,
      state: updated.state,
      zip: updated.zip,
      country: updated.country,
      billingType: updated.billingType,
      subscriptionTier: updated.subscriptionTier,
      customPricing: updated.customPricing ? Number(updated.customPricing) : null,
      internalNotes: updated.internalNotes,
      enterpriseMaxDashboards: updated.enterpriseMaxDashboards,
      enterpriseKeywordsTotal: updated.enterpriseKeywordsTotal,
      enterpriseCreditsPerMonth: updated.enterpriseCreditsPerMonth,
      enterpriseMaxTeamUsers: updated.enterpriseMaxTeamUsers,
      createdAt: updated.createdAt,
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ message: 'Invalid input', errors: error.errors });
    }
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'Subdomain already taken' });
    }
    console.error('Update agency error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get agency members
router.get('/:agencyId/members', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { agencyId } = req.params;

    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                verified: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!agency) {
      return res.status(404).json({ message: 'Agency not found' });
    }

    const members = agency.members.map(member => ({
      id: member.id,
      userId: member.user.id,
      name: member.user.name,
      email: member.user.email,
      role: member.user.role,
      agencyRole: member.agencyRole,
      verified: member.user.verified,
      joinedAt: member.user.createdAt,
    }));

    res.json(members);
  } catch (error) {
    console.error('Get agency members error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Invite agency (Admin only)
router.post('/invite', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { email, name } = inviteSchema.parse(req.body);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Create agency (public invite = 14-day free trial)
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const agency = await prisma.agency.create({
      data: { name, trialEndsAt },
    });

    // Generate invitation token
    const inviteToken = jwt.sign(
      { email, agencyId: agency.id, role: 'AGENCY' },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    // Store token
    await prisma.token.create({
      data: {
        type: 'INVITE',
        email,
        token: inviteToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        agencyId: agency.id,
        role: 'AGENCY',
      },
    });

    // Send invitation email
    await sendEmail({
      to: email,
      subject: `You're invited to ${BRAND_DISPLAY_NAME}`,
      html: `
        <h1>You're invited to join ${BRAND_DISPLAY_NAME}!</h1>
        <p>You've been invited to create an agency account: <strong>${name}</strong></p>
        <p>Click the link below to accept the invitation:</p>
        <a href="${process.env.FRONTEND_URL}/invite?token=${inviteToken}">Accept Invitation</a>
        <p>This invitation expires in 7 days.</p>
      `,
    });

    res.json({ message: 'Invitation sent successfully' });
  } catch (error) {
    console.error('Invite agency error:', error);
    res.status(500).json({ message: 'Failed to send invitation' });
  }
});

// Invite specialist (Agency owners only)
router.post('/:agencyId/invite-specialist', authenticateToken, async (req, res) => {
  try {
    const { agencyId } = req.params;
    const { email, name } = inviteSchema.parse(req.body);

    // Check if user has permission to invite for this agency
    const membership = await prisma.userAgency.findFirst({
      where: {
        userId: req.user.userId,
        agencyId,
        agencyRole: { in: ['SPECIALIST', 'OWNER', 'MANAGER'] },
      },
      include: { agency: true },
    });

    if (!membership && (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN')) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Generate invitation token
    const inviteToken = jwt.sign(
      { email, agencyId, role: 'SPECIALIST' },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    // Store token
    await prisma.token.create({
      data: {
        type: 'INVITE',
        email,
        token: inviteToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        agencyId,
        role: 'SPECIALIST',
      },
    });

    // Send invitation email
    await sendEmail({
      to: email,
      subject: `You're invited to join an agency on ${BRAND_DISPLAY_NAME}`,
      html: `
        <h1>You're invited to join ${BRAND_DISPLAY_NAME}!</h1>
        <p>You've been invited to join <strong>${membership?.agency.name || 'an agency'}</strong>.</p>
        <p>Click the link below to accept the invitation:</p>
        <a href="${process.env.FRONTEND_URL}/invite?token=${inviteToken}">Accept Invitation</a>
        <p>This invitation expires in 7 days.</p>
      `,
    });

    res.json({ message: 'Specialist invitation sent successfully' });
  } catch (error) {
    console.error('Invite specialist error:', error);
    res.status(500).json({ message: 'Failed to send invitation' });
  }
});

// Validate whether the agency can change to a target plan (used before downgrade).
// Tier, add-ons, and managed services are separate: downgrade is only allowed if total clients and
// clients with active managed services are within the target plan's client limit.
router.post('/validate-plan-change', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'AGENCY' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const targetPlan = typeof req.body?.targetPlan === 'string' ? req.body.targetPlan.trim().toLowerCase() : '';
    if (!targetPlan || !CHANGEABLE_TIER_IDS.includes(targetPlan as TierId)) {
      return res.status(400).json({ message: 'Invalid target plan. Use one of: solo, starter, growth, pro, enterprise, business_lite, business_pro.' });
    }
    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership?.agency) {
      return res.status(404).json({ message: 'No agency found.' });
    }
    const agencyId = membership.agency.id;
    const targetConfig = getTierConfig(targetPlan);
    if (!targetConfig) {
      return res.status(400).json({ message: 'Invalid target plan.' });
    }
    const targetLimit = targetConfig.maxDashboards;
    const targetName = targetConfig.name;
    if (targetLimit === null) {
      return res.json({ allowed: true });
    }
    const agencyUserIds = await prisma.userAgency.findMany({
      where: { agencyId },
      select: { userId: true },
    }).then((rows) => rows.map((r) => r.userId));
    const totalClients = await prisma.client.count({
      where: { userId: { in: agencyUserIds } },
    });
    const clientsWithActiveManagedServices = await prisma.managedService
      .findMany({
        where: { agencyId, status: 'ACTIVE' },
        select: { clientId: true },
      })
      .then((rows) => new Set(rows.map((r) => r.clientId)).size);
    if (totalClients > targetLimit) {
      return res.json({
        allowed: false,
        reason: 'too_many_clients',
        message: `You have ${totalClients} clients. The ${targetName} plan allows up to ${targetLimit}. Remove or reassign ${totalClients - targetLimit} clients before downgrading.`,
      });
    }
    if (clientsWithActiveManagedServices > targetLimit) {
      return res.json({
        allowed: false,
        reason: 'managed_services_over_limit',
        message: `You have managed service active on ${clientsWithActiveManagedServices} clients. The ${targetName} plan allows up to ${targetLimit}. Please cancel managed services on ${clientsWithActiveManagedServices - targetLimit} clients before downgrading.`,
      });
    }
    return res.json({ allowed: true });
  } catch (err: any) {
    console.error('Validate plan change error:', err);
    res.status(500).json({ message: err?.message || 'Validation failed' });
  }
});

// Preview proration amount due today for a plan change (used by Upgrade confirmation modal).
router.post('/change-plan-preview', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'AGENCY' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const targetPlan = typeof req.body?.targetPlan === 'string' ? req.body.targetPlan.trim().toLowerCase() : '';
    if (!targetPlan || !CHANGEABLE_TIER_IDS.includes(targetPlan as TierId)) {
      return res.status(400).json({ message: 'Invalid target plan. Use one of: solo, starter, growth, pro, enterprise, business_lite, business_pro.' });
    }

    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ message: 'Billing is not configured. Contact support.' });
    }

    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership?.agency) {
      return res.status(404).json({ message: 'No agency found.' });
    }
    const agency = membership.agency as { id: string; stripeSubscriptionId: string | null; stripeCustomerId?: string | null; billingType?: string | null };
    const subId = agency.stripeSubscriptionId;
    const billingType = agency.billingType ?? null;
    if (!subId) {
      if (billingType === 'free' || billingType === 'custom') {
        return res.status(400).json({
          message: 'Your account uses No Charge or Manual Invoice billing. Plan changes are managed by your administrator.',
        });
      }
      return res.status(400).json({ message: 'No active subscription. Subscribe to a plan first.' });
    }
    const targetPriceId = getPriceIdForTier(targetPlan as TierId);
    if (!targetPriceId) {
      return res.status(400).json({ message: `Plan "${targetPlan}" is not configured in billing. Contact support.` });
    }

    const sub = await stripe.subscriptions.retrieve(subId, { expand: ['items.data.price'] }) as any;
    const items = sub.items?.data ?? [];
    const basePlan = findBasePlanSubscriptionItem(items);
    if (!basePlan) {
      return res.status(400).json({ message: 'No plan found on this subscription.' });
    }
    if (basePlan.priceId === targetPriceId) {
      return res.json({ amountDueTodayCents: 0, currency: 'usd', isUpgrade: false });
    }

    const oldTier = await prisma.agency.findUnique({ where: { id: agency.id }, select: { subscriptionTier: true } });
    const oldPrice = getTierConfig(oldTier?.subscriptionTier)?.priceMonthlyUsd ?? 0;
    const newPrice = getTierConfig(targetPlan)?.priceMonthlyUsd ?? 0;
    const isUpgrade = newPrice > oldPrice;

    const basePlanItemIds = items
      .filter((item: any) => getTierFromSubscriptionItems([item]) != null)
      .map((item: any) => item.id);
    const extraBasePlanItemIds = basePlanItemIds.filter((id: string) => id !== basePlan.itemId);

    const customerId =
      (typeof sub.customer === 'string' ? sub.customer : sub.customer?.id) ??
      agency.stripeCustomerId ??
      null;

    const upcoming = await stripe.invoices.retrieveUpcoming({
      customer: customerId ?? undefined,
      subscription: subId,
      subscription_items: [
        { id: basePlan.itemId, price: targetPriceId },
        ...extraBasePlanItemIds.map((id: string) => ({ id, deleted: true })),
      ],
      subscription_proration_behavior: isUpgrade ? 'always_invoice' : 'none',
    } as any);

    const amountDueTodayCents = Number(upcoming?.amount_due ?? upcoming?.total ?? 0);
    const currency = String(upcoming?.currency || 'usd').toLowerCase();

    return res.json({
      isUpgrade,
      amountDueTodayCents,
      currency,
    });
  } catch (err: any) {
    console.error('Change plan preview error:', err);
    return res.status(500).json({ message: err?.message || 'Failed to preview plan change' });
  }
});

// Change base plan directly via Stripe API (works with multi-item subscriptions: only the plan item is updated).
// Validates downgrade (client counts, managed services) then updates the subscription item for the base plan.
router.post('/change-plan', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'AGENCY' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const targetPlan = typeof req.body?.targetPlan === 'string' ? req.body.targetPlan.trim().toLowerCase() : '';
    if (!targetPlan || !CHANGEABLE_TIER_IDS.includes(targetPlan as TierId)) {
      return res.status(400).json({ message: 'Invalid target plan. Use one of: solo, starter, growth, pro, enterprise, business_lite, business_pro.' });
    }
    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ message: 'Billing is not configured. Contact support.' });
    }
    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership?.agency) {
      return res.status(404).json({ message: 'No agency found.' });
    }
    const agency = membership.agency as { id: string; stripeSubscriptionId: string | null; billingType?: string | null };
    const subId = agency.stripeSubscriptionId;
    const billingType = agency.billingType ?? null;
    if (!subId) {
      if (billingType === 'free' || billingType === 'custom') {
        return res.status(400).json({
          message: 'Your account uses No Charge or Manual Invoice billing. Plan changes are managed by your administrator. Contact your administrator or support.',
        });
      }
      return res.status(400).json({ message: 'No active subscription. Subscribe to a plan first.' });
    }
    const targetPriceId = getPriceIdForTier(targetPlan as TierId);
    if (!targetPriceId) {
      return res.status(400).json({ message: `Plan "${targetPlan}" is not configured in billing. Contact support.` });
    }
    const targetConfig = getTierConfig(targetPlan);
    if (targetConfig?.maxDashboards != null) {
      const agencyId = agency.id;
      const agencyUserIds = await prisma.userAgency.findMany({
        where: { agencyId },
        select: { userId: true },
      }).then((rows) => rows.map((r) => r.userId));
      const totalClients = await prisma.client.count({ where: { userId: { in: agencyUserIds } } });
      const clientsWithManaged = await prisma.managedService
        .findMany({ where: { agencyId, status: 'ACTIVE' }, select: { clientId: true } })
        .then((rows) => new Set(rows.map((r) => r.clientId)).size);
      if (totalClients > targetConfig.maxDashboards) {
        return res.status(400).json({
          message: `You have ${totalClients} clients. The ${targetConfig.name} plan allows up to ${targetConfig.maxDashboards}. Remove or reassign clients before downgrading.`,
        });
      }
      if (clientsWithManaged > targetConfig.maxDashboards) {
        return res.status(400).json({
          message: `You have managed service on ${clientsWithManaged} clients. The ${targetConfig.name} plan allows up to ${targetConfig.maxDashboards}. Cancel managed services on ${clientsWithManaged - targetConfig.maxDashboards} clients before downgrading.`,
        });
      }
    }
    let sub: { items: { data: import('stripe').Stripe.SubscriptionItem[] } };
    try {
      sub = await stripe.subscriptions.retrieve(subId, { expand: ['items.data.price'] }) as any;
    } catch (e: any) {
      return res.status(400).json({ message: 'Could not load subscription. It may have been canceled.' });
    }
    const items = sub.items?.data ?? [];
    const basePlan = findBasePlanSubscriptionItem(items);
    if (!basePlan) {
      return res.status(400).json({ message: 'No plan found on this subscription. Use Manage Billing to change plan.' });
    }
    if (basePlan.priceId === targetPriceId) {
      return res.status(400).json({ message: 'You are already on this plan.' });
    }
    const oldTier = await prisma.agency.findUnique({ where: { id: agency.id }, select: { subscriptionTier: true } });
    const oldTierName = getTierConfig(oldTier?.subscriptionTier)?.name ?? oldTier?.subscriptionTier ?? 'Free';
    const oldPrice = getTierConfig(oldTier?.subscriptionTier)?.priceMonthlyUsd ?? 0;

    const newPrice = getTierConfig(targetPlan)?.priceMonthlyUsd ?? 0;
    const isUpgrade = newPrice > oldPrice;

    // Keep only one base-plan item on the subscription:
    // - update the primary base item to the target price
    // - delete any extra base-plan items so old/new plans are never stacked
    const basePlanItemIds = items
      .filter((item) => getTierFromSubscriptionItems([item]) != null)
      .map((item) => item.id);
    const extraBasePlanItemIds = basePlanItemIds.filter((id) => id !== basePlan.itemId);

    await stripe.subscriptions.update(subId, {
      items: [
        { id: basePlan.itemId, price: targetPriceId },
        ...extraBasePlanItemIds.map((id) => ({ id, deleted: true })),
      ],
      // Upgrade: bill prorated difference now.
      // Downgrade: do not bill/credit immediately; adjustment is applied on the next cycle.
      proration_behavior: isUpgrade ? 'always_invoice' : 'none',
      billing_cycle_anchor: 'unchanged',
    });
    if (isUpgrade) {
      await prisma.agency.update({
        where: { id: agency.id },
        data: {
          keywordResearchCreditsUsed: 0,
          keywordResearchCreditsResetAt: getCreditsResetAt(),
        },
      });
    }
    await syncAgencyTierFromStripe(agency.id);

    const updatedAgency = await prisma.agency.findUnique({
      where: { id: agency.id },
      select: { name: true, subscriptionTier: true, billingType: true, trialEndsAt: true },
    });
    const newTierName = getTierConfig(targetPlan)?.name ?? targetPlan;
    const trialDaysLeft = updatedAgency?.trialEndsAt
      ? Math.max(0, Math.ceil((updatedAgency.trialEndsAt.getTime() - Date.now()) / 86400000))
      : null;
    const currentStatusLabel =
      updatedAgency?.billingType === 'paid'
        ? (trialDaysLeft != null && trialDaysLeft > 0 ? 'Active - Trialing' : 'Active - Paid')
        : updatedAgency?.billingType === 'free'
          ? 'Free'
          : updatedAgency?.billingType === 'trial'
            ? 'Trial'
            : String(updatedAgency?.billingType || 'Unknown');

    const agencyNotifMessage = isUpgrade
      ? `Your subscription has been upgraded to ${newTierName}.`
      : `Your subscription has been changed to ${newTierName}.`;
    const saNotifMessage = isUpgrade
      ? `${updatedAgency?.name ?? 'An agency'} upgraded from ${oldTierName} to ${newTierName}.`
      : `${updatedAgency?.name ?? 'An agency'} downgraded from ${oldTierName} to ${newTierName}.`;

    const createdAgencyNotif = await createNotificationOnce({
      agencyId: agency.id,
      userId: null,
      type: isUpgrade ? 'plan_upgrade' : 'plan_downgrade',
      title: isUpgrade ? 'Plan upgraded' : 'Plan downgraded',
      message: agencyNotifMessage,
      link: '/agency/subscription',
    });

    const createdSaNotif = await createNotificationOnce({
      agencyId: null,
      userId: null,
      type: isUpgrade ? 'plan_upgrade' : 'plan_downgrade',
      title: isUpgrade ? 'Agency upgraded' : 'Agency downgraded',
      message: saNotifMessage,
      link: '/agency/agencies',
    });

    if (createdAgencyNotif) {
      await sendAgencyPlanChangeEmail({
        agencyId: agency.id,
        oldTierName,
        newTierName,
        isUpgrade,
        billingType: String(updatedAgency?.billingType || 'paid'),
        statusLabel: currentStatusLabel,
        trialEndsAtIso: updatedAgency?.trialEndsAt?.toISOString() ?? null,
        trialDaysLeft,
        fallbackUserId: req.user.userId,
      });
    }

    if (createdSaNotif) {
      await notifySuperAdminsByEmail({
        subject: `${isUpgrade ? 'Agency plan upgraded' : 'Agency plan downgraded'} - ${updatedAgency?.name ?? 'Agency'}`,
        html: renderBillingEmailTemplate({
          title: isUpgrade ? 'Agency plan upgraded' : 'Agency plan downgraded',
          introLines: [
            `${updatedAgency?.name ?? 'An agency'} has ${isUpgrade ? 'upgraded' : 'downgraded'} their plan.`,
          ],
          sections: [
            {
              title: 'Current account status',
              rows: [
                { label: 'Agency', value: updatedAgency?.name ?? agency.id },
                { label: 'Previous Plan', value: oldTierName },
                { label: 'Current Plan', value: newTierName },
                { label: 'Current Status', value: currentStatusLabel },
                { label: 'Billing Type', value: String(updatedAgency?.billingType ?? '-') },
                { label: 'Trial Ends', value: updatedAgency?.trialEndsAt ? updatedAgency.trialEndsAt.toLocaleString("en-US") : 'N/A' },
                { label: 'Days Until First Charge', value: trialDaysLeft != null ? String(trialDaysLeft) : 'N/A' },
                { label: 'Changed At', value: new Date().toISOString() },
              ],
            },
          ],
        }),
      });
    }

    return res.json({
      success: true,
      message: isUpgrade
        ? 'Plan upgraded. Prorated difference has been applied today.'
        : 'Plan downgrade scheduled. New pricing will apply on your next billing date.',
    });
  } catch (err: any) {
    console.error('Change plan error:', err);
    res.status(500).json({ message: err?.message || 'Failed to change plan' });
  }
});

// Create Stripe billing portal session (for Subscription page: Manage Billing / Upgrade / Downgrade)
// Uses the current user's agency.stripeCustomerId (or creates one if missing). Never uses req.body for customer id.
// Plan changes (upgrade/downgrade) are handled by Stripe's portal. Configure in Dashboard: Billing → Customer portal →
// "Subscription plan changes": enable "Proration" so upgrades are charged immediately; set downgrades to "Take effect at end of billing period".
router.post('/billing-portal', authenticateToken, async (req, res) => {
  let agency: { id: string; stripeCustomerId: string | null; stripeSubscriptionId: string | null; [key: string]: any } | null = null;
  try {
    if (req.user.role !== 'AGENCY' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const returnUrl = (req.body && req.body.returnUrl) || `${req.body?.origin || req.get('origin') || 'http://localhost:3000'}/agency/subscription`;
    const openToSubscriptionUpdate = !!(req.body && req.body.flow === 'subscription_update');
    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ url: null, message: 'Billing is not configured. Contact support.' });
    }

    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership?.agency) {
      return res.status(404).json({ url: null, message: 'No agency found.' });
    }

    agency = membership.agency;

    const billingType = (agency as { billingType?: string | null }).billingType ?? null;
    if (billingType === 'free' || billingType === 'custom') {
      return res.status(200).json({
        url: null,
        message: 'Billing is managed by your administrator (No Charge or Manual Invoice account). Contact your administrator for billing or plan questions.',
      });
    }

    const resolvedBillingEmail = agency.contactEmail ?? (await prisma.user.findUnique({
      where: { id: membership.userId },
      select: { email: true },
    }).then((u) => u?.email ?? undefined));
    const resolvedBillingName = agency.name ?? agency.contactName ?? undefined;

    let customerId = agency.stripeCustomerId ?? null;
    let didCreateCustomer = false;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: resolvedBillingEmail ?? undefined,
        name: resolvedBillingName,
        metadata: { agencyId: agency.id },
      });
      customerId = customer.id;
      didCreateCustomer = true;
      // Do NOT persist stripeCustomerId here. Only persist after we successfully create the portal session,
      // so that a failed "Choose a plan" click does not unlock Managed Services / Add-Ons (accountActivated).
    } else {
      // Keep customer-facing Stripe profile aligned to the current agency identity.
      // Prevents stale names from appearing in hosted Stripe pages.
      await stripe.customers.update(customerId, {
        email: resolvedBillingEmail ?? undefined,
        name: resolvedBillingName,
        metadata: {
          agencyId: agency.id,
        },
      }).catch(() => {});
    }

    const sessionParams: Parameters<typeof stripe.billingPortal.sessions.create>[0] = {
      customer: customerId,
      return_url: returnUrl,
    };
    let useSubscriptionUpdateFlow = false;
    if (openToSubscriptionUpdate && agency.stripeSubscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(agency.stripeSubscriptionId, {
          expand: ['items.data'],
        });
        const itemCount = sub.items?.data?.length ?? 0;
        if (itemCount === 1) {
          useSubscriptionUpdateFlow = true;
          sessionParams.flow_data = {
            type: 'subscription_update',
            subscription_update: { subscription: agency.stripeSubscriptionId },
          };
        }
      } catch (e) {
        // If we can't fetch subscription, skip flow_data and open general portal
      }
    }
    let session: { url: string };
    try {
      session = await stripe.billingPortal.sessions.create(sessionParams);
    } catch (portalErr: any) {
      if (openToSubscriptionUpdate) {
        try {
          session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
          });
          const msg = String(portalErr?.message || portalErr?.raw?.message || '');
          let warning: string;
          if (/no price in the portal configuration|quantity cannot be changed/i.test(msg)) {
            warning =
              'Plan changes are not configured in the billing portal. Opening the main billing page. To allow plan changes, add your plan prices in Stripe Dashboard → Settings → Billing → Customer portal → Subscription plan changes.';
          } else if (/multiple\s*[`']?items[`']?/i.test(msg)) {
            warning =
              'Your subscription has add-ons or managed services, so the portal will open to the main billing page. You can update your plan, payment method, or manage items there.';
          } else if (/subscription update.*disabled|subscription_update.*disabled/i.test(msg)) {
            warning =
              'Subscription plan changes are disabled in your Stripe Customer Portal. Enable "Subscription plan changes" in Stripe Dashboard → Settings → Billing → Customer portal to open directly to plan change.';
          } else {
            warning =
              'Opening the billing portal. You can update your plan, payment method, or view invoices there.';
          }
          if (didCreateCustomer) {
            await prisma.agency.update({
              where: { id: agency.id },
              data: { stripeCustomerId: customerId },
            });
          }
          return res.json({ url: session.url, warning });
        } catch (fallbackErr: any) {
          console.error('Billing portal fallback error:', fallbackErr);
          return res.status(200).json({
            url: null,
            message:
              'Your subscription has add-ons or managed services. Use "Manage Billing" to open the billing portal, where you can update your plan or payment method.',
          });
        }
      }
      throw portalErr;
    }
    // Only persist new Stripe customer after we successfully created the portal session.
    // This prevents a failed "Choose a plan" from unlocking Managed Services / Add-Ons (accountActivated).
    if (didCreateCustomer) {
      await prisma.agency.update({
        where: { id: agency.id },
        data: { stripeCustomerId: customerId },
      });
    }
    if (openToSubscriptionUpdate && !useSubscriptionUpdateFlow) {
      return res.json({
        url: session.url,
        warning:
          'Your subscription has add-ons or managed services. The portal will open to the main billing page where you can update your plan, payment method, or manage items.',
      });
    }
    res.json({ url: session.url });
  } catch (err: any) {
    console.error('Billing portal error:', err);
    const rawMsg = String(err?.message || err?.raw?.message || '');
    const isFreeTrialNoSubscription = !agency?.stripeSubscriptionId && !agency?.stripeCustomerId;
    const message =
      isFreeTrialNoSubscription && rawMsg
        ? `Could not open billing portal. Your account is on a free trial with no payment method. Ensure Stripe Customer Portal allows customers to add a payment method and subscribe (Stripe Dashboard → Settings → Billing → Customer portal). If the problem persists, contact support. (${rawMsg})`
        : err?.message || 'Failed to open billing portal';
    res.status(500).json({
      url: null,
      message,
    });
  }
});

// Native invoice history for Subscription page (avoids opening Stripe portal for invoice downloads).
router.get('/billing-invoices', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'AGENCY' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ items: [], message: 'Billing is not configured. Contact support.' });
    }

    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership?.agency) {
      return res.status(404).json({ items: [], message: 'No agency found.' });
    }

    const agency = membership.agency as { stripeCustomerId?: string | null; stripeSubscriptionId?: string | null; billingType?: string | null };
    if (agency.billingType === 'free' || agency.billingType === 'custom') {
      return res.json({ items: [] });
    }

    let customerId = agency.stripeCustomerId ?? null;
    if (!customerId && agency.stripeSubscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(agency.stripeSubscriptionId);
        customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
      } catch {
        // If subscription is not retrievable, return empty invoices list.
      }
    }
    if (!customerId) {
      return res.json({ items: [] });
    }

    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 24,
    });

    const items = invoices.data.map((inv) => ({
      id: inv.id,
      number: inv.number ?? null,
      createdAt: new Date(inv.created * 1000).toISOString(),
      status: inv.status ?? null,
      totalCents: inv.total ?? 0,
      amountDueCents: inv.amount_due ?? 0,
      amountPaidCents: inv.amount_paid ?? 0,
      currency: inv.currency ?? 'usd',
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdfUrl: inv.invoice_pdf ?? null,
      periodStart: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
      periodEnd: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
    }));

    return res.json({ items });
  } catch (err: any) {
    console.error('Billing invoices error:', err);
    return res.status(500).json({ items: [], message: err?.message || 'Failed to load invoices' });
  }
});

// Download invoice PDF through our backend so users stay on platform domain.
router.get('/billing-invoices/:invoiceId/download', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'AGENCY' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const invoiceId = String(req.params.invoiceId || '').trim();
    if (!invoiceId.startsWith('in_')) {
      return res.status(400).json({ message: 'Invalid invoice id.' });
    }

    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ message: 'Billing is not configured. Contact support.' });
    }

    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership?.agency) {
      return res.status(404).json({ message: 'No agency found.' });
    }
    const agency = membership.agency as { stripeCustomerId?: string | null; stripeSubscriptionId?: string | null };

    let customerId = agency.stripeCustomerId ?? null;
    if (!customerId && agency.stripeSubscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(agency.stripeSubscriptionId);
        customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
      } catch {
        // no-op
      }
    }
    if (!customerId) {
      return res.status(400).json({ message: 'No active billing customer found for this account.' });
    }

    const invoice = await stripe.invoices.retrieve(invoiceId);
    const invoiceCustomerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
    if (!invoiceCustomerId || invoiceCustomerId !== customerId) {
      return res.status(403).json({ message: 'Access denied to this invoice.' });
    }
    if (!invoice.invoice_pdf) {
      return res.status(404).json({ message: 'Invoice PDF is not available for this invoice.' });
    }

    const upstreamRes = await fetch(invoice.invoice_pdf);
    if (!upstreamRes.ok) {
      return res.status(502).json({ message: 'Could not fetch invoice PDF from billing provider.' });
    }

    const arrayBuffer = await upstreamRes.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const safeInvoiceNumber = String(invoice.number || invoice.id).replace(/[^a-zA-Z0-9_-]/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${safeInvoiceNumber}.pdf"`);
    return res.status(200).send(fileBuffer);
  } catch (err: any) {
    console.error('Billing invoice download error:', err);
    return res.status(500).json({ message: err?.message || 'Failed to download invoice' });
  }
});

const updateSubscriptionPaymentMethodSchema = z.object({
  paymentMethodId: z.string().min(1, 'Payment method is required'),
});

// Update default payment method for the agency's Stripe customer/subscription.
router.post('/subscription/payment-method', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'AGENCY' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ message: 'Billing is not configured. Contact support.' });
    }

    const body = updateSubscriptionPaymentMethodSchema.parse(req.body || {});
    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership?.agency) {
      return res.status(404).json({ message: 'No agency found.' });
    }

    const agency = membership.agency as {
      id: string;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      contactEmail?: string | null;
      name?: string | null;
      contactName?: string | null;
    };
    let customerId = agency.stripeCustomerId ?? null;
    const fallbackEmail = await prisma.user.findUnique({
      where: { id: membership.userId },
      select: { email: true },
    }).then((u) => u?.email ?? undefined);

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: agency.contactEmail ?? fallbackEmail ?? undefined,
        name: agency.name ?? agency.contactName ?? undefined,
        metadata: { agencyId: agency.id },
      });
      customerId = customer.id;
      await prisma.agency.update({
        where: { id: agency.id },
        data: { stripeCustomerId: customerId },
      });
    }

    await stripe.paymentMethods.attach(body.paymentMethodId, { customer: customerId }).catch((err: any) => {
      const msg = String(err?.message || '').toLowerCase();
      if (!msg.includes('already') || !msg.includes('attached')) {
        throw err;
      }
    });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: body.paymentMethodId },
      metadata: { agencyId: agency.id },
      email: agency.contactEmail ?? fallbackEmail ?? undefined,
      name: agency.name ?? agency.contactName ?? undefined,
    });

    if (agency.stripeSubscriptionId) {
      await stripe.subscriptions.update(agency.stripeSubscriptionId, {
        default_payment_method: body.paymentMethodId,
      }).catch(() => {});
    }

    return res.json({ success: true, message: 'Payment method updated.' });
  } catch (err: any) {
    console.error('Update subscription payment method error:', err);
    return res.status(500).json({ message: err?.message || 'Failed to update payment method' });
  }
});

// Schedule cancellation at period end.
router.post('/subscription/cancel', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'AGENCY' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ message: 'Billing is not configured. Contact support.' });
    }

    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership?.agency) {
      return res.status(404).json({ message: 'No agency found.' });
    }
    const subId = membership.agency.stripeSubscriptionId;
    if (!subId) {
      return res.status(400).json({ message: 'No active subscription found.' });
    }

    const updated = await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
    const cancelTs = updated.cancel_at ?? updated.current_period_end ?? null;
    const cancellationEffectiveAt = cancelTs ? new Date(cancelTs * 1000).toISOString() : null;
    const cancellationEffectiveText = cancelTs ? new Date(cancelTs * 1000).toLocaleString('en-US') : 'N/A';
    const oldTierName =
      getTierConfig(membership.agency.subscriptionTier)?.name ??
      membership.agency.subscriptionTier ??
      'Current plan';
    const agencyName = membership.agency.name ?? 'Your agency';

    const agencyTitle = 'Cancellation scheduled';
    const agencyMessage = `Your ${oldTierName} subscription is scheduled to cancel on ${cancellationEffectiveText}.`;
    const saTitle = 'Agency cancellation scheduled';
    const saMessage = `${agencyName} scheduled cancellation of their ${oldTierName} subscription on ${cancellationEffectiveText}.`;

    const createdAgencyNotif = await createNotificationOnce({
      agencyId: membership.agency.id,
      userId: null,
      type: 'subscription_canceled',
      title: agencyTitle,
      message: agencyMessage,
      link: '/agency/subscription',
    }, 24 * 60 * 60 * 1000);

    const createdSaNotif = await createNotificationOnce({
      agencyId: null,
      userId: null,
      type: 'subscription_canceled',
      title: saTitle,
      message: saMessage,
      link: '/agency/agencies',
    }, 24 * 60 * 60 * 1000);

    if (createdAgencyNotif) {
      const recipient = await resolveAgencyEmailRecipient(membership.agency.id, req.user.userId);
      if (recipient.recipientEmail) {
        await sendEmail({
          to: recipient.recipientEmail,
          subject: `Subscription cancellation scheduled - ${BRAND_DISPLAY_NAME}`,
          html: renderBillingEmailTemplate({
            title: 'Your subscription cancellation is scheduled',
            introLines: [
              `Hi ${recipient.recipientName},`,
              `Your ${BRAND_DISPLAY_NAME} subscription for ${recipient.agencyName} is scheduled to cancel.`,
            ],
            sections: [
              {
                title: 'Cancellation details',
                rows: [
                  { label: 'Current Plan', value: oldTierName },
                  { label: 'Effective Date', value: cancellationEffectiveText },
                  { label: 'Current Status', value: 'Cancellation Scheduled' },
                ],
              },
            ],
          }),
        }).catch((e: any) => console.warn('Agency cancellation scheduled email failed:', e?.message));
      }
    }

    if (createdSaNotif) {
      await notifySuperAdminsByEmail({
        subject: `Agency cancellation scheduled - ${agencyName}`,
        html: renderBillingEmailTemplate({
          title: 'Agency cancellation scheduled',
          introLines: [`${agencyName} scheduled subscription cancellation.`],
          sections: [
            {
              title: 'Cancellation details',
              rows: [
                { label: 'Agency', value: agencyName },
                { label: 'Current Plan', value: oldTierName },
                { label: 'Effective Date', value: cancellationEffectiveText },
                { label: 'Current Status', value: 'Cancellation Scheduled' },
              ],
            },
          ],
        }),
      });
    }

    return res.json({
      success: true,
      message: 'Subscription cancellation scheduled.',
      cancellationEffectiveAt,
    });
  } catch (err: any) {
    console.error('Cancel subscription error:', err);
    return res.status(500).json({ message: err?.message || 'Failed to schedule cancellation' });
  }
});

// Remove scheduled cancellation before period end.
router.post('/subscription/reactivate', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'AGENCY' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ message: 'Billing is not configured. Contact support.' });
    }

    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership?.agency) {
      return res.status(404).json({ message: 'No agency found.' });
    }
    const subId = membership.agency.stripeSubscriptionId;
    if (!subId) {
      return res.status(400).json({ message: 'No active subscription found.' });
    }

    await stripe.subscriptions.update(subId, { cancel_at_period_end: false });

    const tierName =
      getTierConfig(membership.agency.subscriptionTier)?.name ??
      membership.agency.subscriptionTier ??
      'Current plan';
    const agencyName = membership.agency.name ?? 'Your agency';

    const createdAgencyNotif = await createNotificationOnce({
      agencyId: membership.agency.id,
      userId: null,
      type: 'subscription_activated',
      title: 'Subscription reactivated',
      message: `Your ${tierName} subscription has been reactivated and will continue renewing.`,
      link: '/agency/subscription',
    });

    const createdSaNotif = await createNotificationOnce({
      agencyId: null,
      userId: null,
      type: 'subscription_activated',
      title: 'Agency subscription reactivated',
      message: `${agencyName} reactivated their ${tierName} subscription.`,
      link: '/agency/agencies',
    });

    if (createdAgencyNotif) {
      const recipient = await resolveAgencyEmailRecipient(membership.agency.id, req.user.userId);
      if (recipient.recipientEmail) {
        await sendEmail({
          to: recipient.recipientEmail,
          subject: `Subscription reactivated - ${BRAND_DISPLAY_NAME}`,
          html: renderBillingEmailTemplate({
            title: 'Your subscription has been reactivated',
            introLines: [
              `Hi ${recipient.recipientName},`,
              `Your ${BRAND_DISPLAY_NAME} subscription for ${recipient.agencyName} is now active.`,
            ],
            sections: [
              {
                title: 'Current account status',
                rows: [
                  { label: 'Plan', value: tierName },
                  { label: 'Status', value: 'Active - Paid' },
                  { label: 'Reactivated At', value: new Date().toISOString() },
                ],
              },
            ],
          }),
        }).catch((e: any) => console.warn('Agency reactivation email failed:', e?.message));
      }
    }

    if (createdSaNotif) {
      await notifySuperAdminsByEmail({
        subject: `Agency subscription reactivated - ${agencyName}`,
        html: renderBillingEmailTemplate({
          title: 'Agency subscription reactivated',
          introLines: [`${agencyName} reactivated their subscription.`],
          sections: [
            {
              title: 'Current account status',
              rows: [
                { label: 'Agency', value: agencyName },
                { label: 'Plan', value: tierName },
                { label: 'Status', value: 'Active - Paid' },
                { label: 'Reactivated At', value: new Date().toISOString() },
              ],
            },
          ],
        }),
      });
    }

    return res.json({ success: true, message: 'Subscription reactivated.' });
  } catch (err: any) {
    console.error('Reactivate subscription error:', err);
    return res.status(500).json({ message: err?.message || 'Failed to reactivate subscription' });
  }
});

const activateTrialSubscriptionSchema = z.object({
  paymentMethodId: z.string().min(1, 'Payment method is required'),
  tier: z.enum(['solo', 'starter', 'growth', 'pro', 'enterprise', 'business_lite', 'business_pro']),
});

// Activate subscription from onboarding/trial/free: attach card + selected plan, give 7-day free trial, charge starts after trial.
router.post('/activate-trial-subscription', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'AGENCY' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const body = activateTrialSubscriptionSchema.parse(req.body);
    const { paymentMethodId, tier } = body;

    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership?.agency) {
      return res.status(404).json({ message: 'Agency not found' });
    }
    const agency = membership.agency;

    if (agency.billingType !== 'trial' && agency.billingType !== 'free') {
      return res.status(400).json({
        message: 'This endpoint is only for agencies on the 7-day trial or Free account. Your account is not eligible.',
      });
    }
    if (agency.stripeCustomerId && agency.stripeSubscriptionId) {
      return res.status(400).json({
        message: 'Your subscription is already active. Use Manage Billing to change your plan.',
      });
    }

    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ message: 'Billing is not configured. Contact support.' });
    }

    const tierPriceId = getPriceIdForTier(tier as import('../lib/tiers.js').TierId);
    if (!tierPriceId || !tierPriceId.startsWith('price_')) {
      return res.status(400).json({
        message: `Plan "${tier}" is not configured. Contact support.`,
      });
    }

    let stripeCustomerId = agency.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: agency.contactEmail ?? undefined,
        name: agency.contactName ?? agency.name ?? undefined,
        metadata: { agencyId: agency.id },
      });
      stripeCustomerId = customer.id;
      await stripe.paymentMethods.attach(paymentMethodId, { customer: stripeCustomerId });
      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
    } else {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: stripeCustomerId });
      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
    }

    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: tierPriceId }],
      default_payment_method: paymentMethodId,
      trial_period_days: 7,
      payment_settings: { save_default_payment_method: 'on_subscription' },
    });

    if (subscription.status !== 'active' && subscription.status !== 'trialing') {
      await stripe.subscriptions.cancel(subscription.id).catch(() => {});
      return res.status(400).json({
        message: 'The first payment could not be completed. Try a different card or use test card 4242 4242 4242 4242.',
      });
    }

    const trialEndsAt =
      typeof subscription.trial_end === 'number'
        ? new Date(subscription.trial_end * 1000)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const trialDaysLeft = Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86400000));
    const currentStatusLabel = trialDaysLeft > 0 ? 'Active - Trialing' : 'Active - Paid';

    // Move agency to selected paid tier immediately while deferring first charge by 7 days.
    await prisma.agency.update({
      where: { id: agency.id },
      data: {
        stripeCustomerId,
        stripeSubscriptionId: subscription.id,
        subscriptionTier: tier,
        billingType: 'paid',
        trialEndsAt,
        keywordResearchCreditsUsed: 0,
        keywordResearchCreditsResetAt: getCreditsResetAt(),
      },
    });

    await syncAgencyTierFromStripe(agency.id);
    console.log('[agencies] Trial activated for agency', agency.id, 'tier=', tier);

    const tierName = getTierConfig(tier as TierId)?.name ?? tier;
    await createNotificationOnce({
      agencyId: agency.id,
      userId: null,
      type: 'subscription_activated',
      title: 'Subscription activated',
      message: `Your ${tierName} plan is active. Status: ${currentStatusLabel}.`,
      link: '/agency/subscription',
    }).catch((e) => console.warn('Create agency activation notification failed:', e?.message));
    await createNotificationOnce({
      agencyId: null,
      userId: null,
      type: 'subscription_activated',
      title: 'Subscription activated',
      message: `${agency.name} activated ${tierName}. Status: ${currentStatusLabel}.`,
      link: '/agency/agencies',
    }).catch((e) => console.warn('Create activation notification failed:', e?.message));

    await sendAgencyPlanActivationEmail({
      agencyId: agency.id,
      tierName,
      billingType: 'paid',
      statusLabel: currentStatusLabel,
      trialEndsAtIso: trialEndsAt.toISOString(),
      trialDaysLeft,
      fallbackUserId: req.user.userId,
    });

    await notifySuperAdminsByEmail({
      subject: `Agency activated plan - ${agency.name}`,
      html: renderBillingEmailTemplate({
        title: 'Agency plan activated',
        introLines: [
          `${agency.name} completed plan activation.`,
        ],
        sections: [
          {
            title: 'Current account status',
            rows: [
              { label: 'Agency', value: agency.name },
              { label: 'Contact', value: agency.contactName || '-' },
              { label: 'Email', value: agency.contactEmail || '-' },
              { label: 'Activated Plan', value: tierName },
              { label: 'Current Status', value: currentStatusLabel },
              { label: 'Billing Type', value: 'paid' },
              { label: 'Trial Ends', value: trialEndsAt.toLocaleString("en-US") },
              { label: 'Days Until First Charge', value: String(trialDaysLeft) },
              { label: 'Stripe Customer ID', value: stripeCustomerId },
              { label: 'Stripe Subscription ID', value: subscription.id },
              { label: 'Activated At', value: new Date().toISOString() },
            ],
          },
        ],
      }),
    });

    res.json({
      success: true,
      message: 'Subscription activated successfully. You will be charged after your 7-day trial ends.',
      trialEndsAt: trialEndsAt.toISOString(),
    });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ message: 'Invalid input', errors: err.errors });
    }
    if (err?.code === 'card_declined' || err?.decline_code) {
      return res.status(400).json({
        message: err?.message || 'Card was declined. Try a different card.',
      });
    }
    if (/already been attached|already attached/i.test(String(err?.message || ''))) {
      return res.status(400).json({
        message: 'This card was already used. Please use a different card.',
      });
    }
    console.error('Activate trial subscription error:', err);
    res.status(500).json({
      message: err?.message || 'Failed to activate subscription. Please try again.',
    });
  }
});

// Onboarding free-account path: no card, free tier, with starter research credits for testing.
router.post('/activate-free-account', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'AGENCY' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership?.agency) {
      return res.status(404).json({ message: 'Agency not found' });
    }

    const agency = membership.agency;
    if (agency.stripeSubscriptionId) {
      return res.status(400).json({
        message: 'Your agency already has an active subscription. Use Subscription to manage your plan.',
      });
    }

    await prisma.agency.update({
      where: { id: agency.id },
      data: {
        billingType: 'free',
        subscriptionTier: 'free',
        trialEndsAt: null,
        enterpriseCreditsPerMonth: 10,
      },
    });

    const currentStatusLabel = 'Active - Free Account';
    await createNotificationOnce({
      agencyId: agency.id,
      userId: null,
      type: 'free_account_activated',
      title: 'Free account activated',
      message: `Your free account is active with 10 research credits. Status: ${currentStatusLabel}.`,
      link: '/agency/subscription',
    }).catch((e) => console.warn('Create agency free-account notification failed:', e?.message));
    await createNotificationOnce({
      agencyId: null,
      userId: null,
      type: 'free_account_activated',
      title: 'Agency free account activated',
      message: `${agency.name} activated Free Account. Status: ${currentStatusLabel}.`,
      link: '/agency/agencies',
    }).catch((e) => console.warn('Create SA free-account notification failed:', e?.message));

    const agencyRecipient = await resolveAgencyEmailRecipient(agency.id, req.user.userId);
    if (agencyRecipient.recipientEmail) {
      await sendEmail({
        to: agencyRecipient.recipientEmail,
        subject: `Free account activated - ${BRAND_DISPLAY_NAME}`,
        html: renderBillingEmailTemplate({
          title: 'Your free account is active',
          introLines: [
            `Hi ${agencyRecipient.recipientName},`,
            `Your agency ${agencyRecipient.agencyName} is now on the Free Account path.`,
          ],
          sections: [
            {
              title: 'Current account status',
              rows: [
                { label: 'Plan', value: 'Free' },
                { label: 'Current Status', value: currentStatusLabel },
                { label: 'Research Credits', value: '10 included credits' },
                { label: 'Activated At', value: new Date().toISOString() },
              ],
            },
          ],
          footerLines: ['You can add a card and upgrade to a paid plan anytime from Subscription.'],
        }),
      }).catch((e: any) => console.warn('Agency free-account email failed:', e?.message));
    }

    await notifySuperAdminsByEmail({
      subject: `Agency free account activated - ${agency.name}`,
      html: renderBillingEmailTemplate({
        title: 'Agency free account activated',
        introLines: [`${agency.name} selected the free-account path in onboarding.`],
        sections: [
          {
            title: 'Current account status',
            rows: [
              { label: 'Agency', value: agency.name },
              { label: 'Contact', value: agency.contactName || '-' },
              { label: 'Email', value: agency.contactEmail || '-' },
              { label: 'Plan', value: 'Free' },
              { label: 'Current Status', value: currentStatusLabel },
              { label: 'Research Credits', value: '10 included credits' },
              { label: 'Activated At', value: new Date().toISOString() },
            ],
          },
        ],
      }),
    });

    res.json({
      success: true,
      message: 'Free account activated with 10 research credits.',
    });
  } catch (err: any) {
    console.error('Activate free account error:', err);
    res.status(500).json({ message: err?.message || 'Failed to activate free account.' });
  }
});

const activateManagedServiceSchema = z.object({
  packageId: z.enum(['foundation', 'growth', 'domination', 'market_domination', 'custom']),
  clientId: z.string().min(1),
  clientAgreed: z.boolean().refine((v) => v === true, { message: 'Client must have agreed to this service' }),
});

const PACKAGES: Record<string, { name: string; priceCents: number }> = {
  foundation: { name: 'SEO Essentials + Automation', priceCents: 75000 },
  growth: { name: 'Growth & Automation', priceCents: 150000 },
  domination: { name: 'Authority Builder', priceCents: 300000 },
  market_domination: { name: 'Market Domination', priceCents: 500000 },
  custom: { name: 'Custom', priceCents: 500000 },
};

const COMMISSION_BY_TIER: Record<string, number> = {
  solo: 20,
  starter: 25,
  growth: 30,
  pro: 35,
  enterprise: 40,
};

// Managed Services: activate → Status PENDING, email Super Admin. Billing starts only after Super Admin approves.
// Agency must have activated their account (CC on file / stripeCustomerId) before they can request a managed plan.
router.post('/managed-services', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    if (user.role === 'SPECIALIST') {
      return res.status(403).json({ message: 'Access denied. Specialists cannot activate managed services.' });
    }
    const membership = await prisma.userAgency.findFirst({
      where: { userId: user.userId },
      include: { agency: true },
    });
    if (!membership && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied. No agency.' });
    }
    const agency = membership!.agency as { stripeCustomerId?: string | null; trialEndsAt?: Date | null };
    if (!agency.stripeCustomerId) {
      return res.status(403).json({
        message: 'Activate your account first. Add a payment method in Subscription & Billing to unlock managed services.',
      });
    }
    const onFreeTrial =
      agency.trialEndsAt &&
      agency.trialEndsAt > new Date() &&
      (((membership!.agency as { billingType?: string | null }).billingType === 'trial') ||
        ((membership!.agency as { billingType?: string | null }).billingType === 'free'));
    if (onFreeTrial) {
      return res.status(403).json({
        message: 'Managed services are not available during the 7-day free trial. Subscribe to a plan or wait until your trial ends to request managed services.',
      });
    }
    const agencyId = membership!.agencyId;
    const agencyName = membership!.agency.name;
    const agencyContactEmail = membership!.agency.contactEmail ?? null;
    const activatingUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { email: true },
    });
    const agencyEmail = agencyContactEmail ?? activatingUser?.email ?? null;
    const body = activateManagedServiceSchema.parse(req.body);

    const tier = (req.body.tier as string) || 'starter';
    const commissionPercent = COMMISSION_BY_TIER[tier.toLowerCase()] ?? 25;
    const pkg = PACKAGES[body.packageId];
    if (!pkg) return res.status(400).json({ message: 'Invalid package' });

    const client = await prisma.client.findUnique({
      where: { id: body.clientId },
      include: { user: { select: { memberships: { select: { agencyId: true } } } } },
    });
    if (!client) return res.status(404).json({ message: 'Client not found' });
    const clientAgencyIds = (client as any).user?.memberships?.map((m: any) => m.agencyId) ?? [];
    if (!clientAgencyIds.includes(agencyId)) {
      return res.status(403).json({ message: 'Client does not belong to your agency' });
    }

    const existingActive = await prisma.managedService.findFirst({
      where: { agencyId, clientId: body.clientId, status: 'ACTIVE' },
    });
    if (existingActive) {
      return res.status(400).json({ message: 'This client already has an active managed service' });
    }
    const existingPending = await prisma.managedService.findFirst({
      where: { agencyId, clientId: body.clientId, status: 'PENDING' },
    });
    if (existingPending) {
      return res.status(400).json({ message: 'This client already has a pending managed service request' });
    }

    const monthlyCommission = Math.round((pkg.priceCents * commissionPercent) / 100);
    const startDate = new Date();
    // Stripe billing is added only when Super Admin approves (PATCH /managed-services/:id/approve).

    const created = await prisma.$transaction(async (tx) => {
      const ms = await tx.managedService.create({
        data: {
          agencyId,
          clientId: body.clientId,
          packageId: body.packageId,
          packageName: pkg.name,
          monthlyPrice: pkg.priceCents,
          commissionPercent,
          monthlyCommission: monthlyCommission,
          startDate,
          status: 'PENDING',
        },
        include: { client: { select: { name: true } } },
      });
      await tx.client.update({
        where: { id: body.clientId },
        data: {
          status: 'PENDING',
          managedServiceStatus: 'pending',
          managedServiceRequestedDate: startDate,
          managedServicePackage: body.packageId as any,
          managedServicePrice: pkg.priceCents / 100,
          // managedServiceActivatedDate set when Super Admin approves
        },
      });
      await (tx as any).managedServiceRequest.create({
        data: {
          agencyId,
          agencyName,
          agencyEmail,
          clientId: body.clientId,
          clientName: client.name,
          packageId: body.packageId,
          packageName: pkg.name,
          monthlyPriceCents: pkg.priceCents,
          startDate,
          managedServiceId: ms.id,
        },
      });
      return ms;
    });

    const createdAgencyNotif = await createNotificationOnce({
      agencyId,
      userId: null,
      type: 'managed_service_requested',
      title: 'Managed service requested',
      message: `${pkg.name} was requested for ${client.name}. Waiting for Super Admin approval.`,
      link: '/agency/managed-services',
    });

    const agencyRecipient = await resolveAgencyEmailRecipient(agencyId, user.userId);
    if (createdAgencyNotif && agencyRecipient.recipientEmail) {
      await sendEmail({
        to: agencyRecipient.recipientEmail,
        subject: `Managed service request received - ${BRAND_DISPLAY_NAME}`,
        html: `
          <h2>Your managed service request is in review</h2>
          <p>Hi ${agencyRecipient.recipientName},</p>
          <p>We received your managed service request and sent it to Super Admin for approval.</p>
          <ul>
            <li><strong>Agency:</strong> ${agencyName}</li>
            <li><strong>Client:</strong> ${client.name}</li>
            <li><strong>Package:</strong> ${pkg.name} ($${(pkg.priceCents / 100).toFixed(2)}/mo)</li>
            <li><strong>Requested start date:</strong> ${startDate.toISOString().split('T')[0]}</li>
          </ul>
          <p>We will notify you as soon as it is approved or rejected.</p>
        `,
      }).catch((e) => console.warn('Agency managed-service confirmation email failed:', e?.message));
    }

    await notifySuperAdminsByEmail({
      subject: `Managed service pending approval: ${agencyName} - ${client.name} - ${pkg.name}`,
      html: `
        <p>Agency <strong>${agencyName}</strong> requested a managed service (pending your approval).</p>
        <ul>
          <li><strong>Agency name:</strong> ${agencyName}</li>
          <li><strong>Agency email:</strong> ${agencyEmail ?? '(not set)'}</li>
          <li><strong>Client selected:</strong> ${client.name}</li>
          <li><strong>Package chosen:</strong> ${pkg.name} ($${(pkg.priceCents / 100).toFixed(2)}/mo)</li>
          <li><strong>Requested start date:</strong> ${startDate.toISOString().split('T')[0]}</li>
        </ul>
        <p>Approve in the Super Admin panel to activate and start billing.</p>
      `,
    });

    const slackWebhook = process.env.MANAGED_SERVICE_SLACK_WEBHOOK || process.env.SLACK_WEBHOOK_URL;
    if (slackWebhook && typeof fetch === 'function') {
      fetch(slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `Managed service pending approval: ${agencyName} – ${client.name} – ${pkg.name} ($${(pkg.priceCents / 100).toFixed(2)}/mo). Start: ${startDate.toISOString().split('T')[0]}`,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: '*Managed service – pending Super Admin approval*' } },
            { type: 'section', fields: [
              { type: 'mrkdwn', text: `*Agency:*\n${agencyName}` },
              { type: 'mrkdwn', text: `*Agency email:*\n${agencyEmail ?? '(not set)'}` },
              { type: 'mrkdwn', text: `*Client:*\n${client.name}` },
              { type: 'mrkdwn', text: `*Package:*\n${pkg.name} ($${(pkg.priceCents / 100).toFixed(2)}/mo)` },
              { type: 'mrkdwn', text: `*Start date:*\n${startDate.toISOString().split('T')[0]}` },
            ] },
          ],
        }),
      }).catch((e) => console.warn('Slack managed service notify failed:', e));
    }

    res.status(201).json({
      id: created.id,
      clientId: created.clientId,
      clientName: created.client.name,
      packageId: created.packageId,
      packageName: created.packageName,
      monthlyPrice: created.monthlyPrice,
      commissionPercent: created.commissionPercent,
      monthlyCommission: created.monthlyCommission,
      startDate: created.startDate,
      status: created.status,
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ message: err.errors?.[0]?.message || 'Invalid input', errors: err.errors });
    }
    console.error('Activate managed service error:', err);
    res.status(500).json({ message: err?.message || 'Failed to activate managed service' });
  }
});

// Managed Services: approve. Sets client ACTIVE, starts billing, notifies agency.
router.patch('/managed-services/:id/approve', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Access denied. Only Super Admin can approve managed services.' });
    }
    const { id } = req.params;
    const row = await prisma.managedService.findUnique({
      where: { id },
      include: { client: true, agency: { include: { members: { select: { user: { select: { email: true, name: true } } } } } } },
    });
    if (!row) return res.status(404).json({ message: 'Managed service not found' });
    if (row.status !== 'PENDING') {
      return res.status(400).json({ message: 'This managed service is not pending approval' });
    }

    /** Env key suffix by packageId (matches service page names: SEO Essentials + Automation, etc.) */
    const MANAGED_PRICE_ENV_KEY: Record<string, string> = {
      foundation: 'SEO_ESSENTIALS_AUTOMATION',
      growth: 'GROWTH_AUTOMATION',
      domination: 'AUTHORITY_BUILDER',
      market_domination: 'MARKET_DOMINATION',
      custom: 'CUSTOM',
    };
    const envKey = MANAGED_PRICE_ENV_KEY[row.packageId];
    const priceEnvVar = `STRIPE_PRICE_MANAGED_${envKey}`;
    let stripeSubscriptionItemId: string | null = null;
    const stripe = getStripe();
    const customerId = (row.agency as { stripeCustomerId?: string | null })?.stripeCustomerId ?? process.env.STRIPE_AGENCY_CUSTOMER_ID ?? null;
    if (stripe && isStripeConfigured() && customerId && envKey) {
      try {
        const priceId = (process.env as any)[priceEnvVar];
        if (!priceId) {
          console.warn(`[Managed service approve] No Stripe subscription item created: ${priceEnvVar} is not set in .env. Add it and restart the server to attach managed services to Stripe.`);
        } else {
          const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
          if (subs.data.length === 0) {
            console.warn(`[Managed service approve] No Stripe subscription item created: customer ${customerId} has no active subscription. Create a subscription for this customer in Stripe Dashboard.`);
          } else {
            const item = await stripe.subscriptionItems.create({
              subscription: subs.data[0].id,
              price: priceId,
              quantity: 1,
            });
            stripeSubscriptionItemId = item.id;
          }
        }
      } catch (stripeErr: any) {
        console.warn('Stripe managed service approve failed:', stripeErr?.message);
      }
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.managedService.update({
        where: { id },
        data: { status: 'ACTIVE', stripeSubscriptionItemId: stripeSubscriptionItemId ?? undefined },
      }),
      prisma.client.update({
        where: { id: row.clientId },
        data: {
          status: 'ACTIVE',
          managedServiceStatus: 'active',
          managedServiceActivatedDate: now,
        },
      }),
    ]);

    const agencyName = row.agency.name;
    const clientName = row.client.name;
    const packageName = row.packageName;
    const agencyId = (row.agency as { id: string }).id;
    await prisma.notification.create({
      data: {
        agencyId,
        type: 'managed_service_approved',
        title: `Managed service approved: ${clientName}`,
        message: `Package: ${packageName}. Billing has started. You can now provide full managed services for this client.`,
        link: '/agency/managed-services',
      },
    }).catch((e) => console.warn('Create approval notification failed:', e?.message));
    const seen = new Set<string>();
    for (const m of row.agency.members) {
      const email = (m as any).user?.email;
      if (email && !seen.has(email)) {
        seen.add(email);
        sendEmail({
          to: email,
          subject: `Managed service approved: ${clientName}`,
          html: `
            <p>The managed service for <strong>${clientName}</strong> has been approved. Billing has started.</p>
            <p>Package: ${packageName}. You can now provide full managed services for this client.</p>
            <p>— ${BRAND_DISPLAY_NAME}</p>
          `,
        }).catch((e) => console.warn('Notify agency approval email failed:', e));
      }
    }

    res.json({
      success: true,
      message: 'Managed service approved; agency notified and billing started.',
    });
  } catch (err: any) {
    console.error('Approve managed service error:', err);
    res.status(500).json({ message: err?.message || 'Failed to approve' });
  }
});

// Managed Services: reject. Client becomes Dashboard Only, agency notified.
router.patch('/managed-services/:id/reject', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Access denied. Only Super Admin can reject managed services.' });
    }
    const { id } = req.params;
    const row = await prisma.managedService.findUnique({
      where: { id },
      include: { client: true, agency: { include: { members: { select: { user: { select: { email: true } } } } } } },
    });
    if (!row) return res.status(404).json({ message: 'Managed service not found' });
    if (row.status !== 'PENDING') {
      return res.status(400).json({ message: 'This managed service is not pending approval' });
    }

    await prisma.$transaction([
      prisma.managedService.update({
        where: { id },
        data: { status: 'CANCELED' },
      }),
      prisma.client.update({
        where: { id: row.clientId },
        data: {
          status: 'DASHBOARD_ONLY',
          managedServiceStatus: 'none',
          managedServicePackage: null,
          managedServicePrice: null,
          managedServiceRequestedDate: null,
        },
      }),
    ]);

    const clientName = row.client.name;
    const agencyId = (row.agency as { id: string }).id;
    await prisma.notification.create({
      data: {
        agencyId,
        type: 'managed_service_rejected',
        title: `Managed service request not approved: ${clientName}`,
        message: 'The client remains in Dashboard Only mode.',
        link: '/agency/managed-services',
      },
    }).catch((e) => console.warn('Create reject notification failed:', e?.message));
    const seen = new Set<string>();
    for (const m of row.agency.members) {
      const email = (m as any).user?.email;
      if (email && !seen.has(email)) {
        seen.add(email);
        sendEmail({
          to: email,
          subject: `Managed service request not approved: ${clientName}`,
          html: `
            <p>The managed service request for <strong>${clientName}</strong> was not approved. The client remains in Dashboard Only mode.</p>
            <p>— ${BRAND_DISPLAY_NAME}</p>
          `,
        }).catch((e) => console.warn('Notify agency reject email failed:', e));
      }
    }

    res.json({ success: true, message: 'Managed service request rejected; agency notified.' });
  } catch (err: any) {
    console.error('Reject managed service error:', err);
    res.status(500).json({ message: err?.message || 'Failed to reject' });
  }
});

// Managed Services: cancel (AGENCY, ADMIN, SUPER_ADMIN only)
const cancelManagedServiceSchema = z.object({
  endDate: z.string().optional(), // YYYY-MM-DD or ISO date string
  keepDashboard: z.boolean().optional(), // If true, after end date client becomes DASHBOARD_ONLY instead of ARCHIVED
});

router.patch('/managed-services/:id/cancel', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'SPECIALIST') {
      return res.status(403).json({ message: 'Access denied. Specialists cannot cancel managed services.' });
    }
    const { id } = req.params;
    const body = cancelManagedServiceSchema.safeParse(req.body || {});
    const endDateStr = body.success && body.data.endDate ? body.data.endDate : null;
    const keepDashboard = body.success && body.data.keepDashboard === true; // Set on client after migrate deploy + prisma generate
    const endDate = endDateStr ? new Date(endDateStr) : (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      d.setDate(0);
      return d;
    })();

    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
    if (!isSuperAdmin && !membership) return res.status(403).json({ message: 'Access denied' });
    const row = await prisma.managedService.findFirst({
      where: isSuperAdmin
        ? { id, status: { in: ['ACTIVE', 'PENDING'] } }
        : { id, agencyId: membership!.agencyId, status: { in: ['ACTIVE', 'PENDING'] } },
    });
    if (!row) return res.status(404).json({ message: 'Managed service not found' });

    const now = new Date();
    const wasActive = row.status === 'ACTIVE';
    const stripeSubscriptionItemId = (row as { stripeSubscriptionItemId?: string | null }).stripeSubscriptionItemId;
    if (wasActive && stripeSubscriptionItemId) {
      const stripe = getStripe();
      if (stripe) {
        try {
          await stripe.subscriptionItems.del(stripeSubscriptionItemId);
        } catch (e: any) {
          console.warn('Stripe managed service subscription item delete failed:', e?.message);
        }
      }
    }
    await prisma.$transaction([
      prisma.managedService.update({
        where: { id },
        data: { status: 'CANCELED' },
      }),
      prisma.client.update({
        where: { id: row.clientId },
        data: wasActive
          ? {
              status: 'CANCELED',
              canceledEndDate: endDate,
              managedServiceStatus: 'canceled',
              managedServiceCanceledDate: now,
              managedServiceEndDate: endDate,
              // keepDashboardAfterEndDate: keepDashboard — add after: npx prisma migrate deploy && npx prisma generate
            }
          : {
              status: 'DASHBOARD_ONLY',
              managedServiceStatus: 'none',
              managedServiceRequestedDate: null,
              managedServicePackage: null,
              managedServicePrice: null,
            },
      }),
    ]);
    res.json({ success: true, endDate: wasActive ? endDate.toISOString().split('T')[0] : undefined });
  } catch (err: any) {
    console.error('Cancel managed service error:', err);
    res.status(500).json({ message: err?.message || 'Failed to cancel' });
  }
});

/** Which add-on options each tier can add. Business tiers cannot add Extra Dashboards (only 1 business). */
export function getAllowedAddOnOptions(tierId: TierId | null): {
  extra_dashboards: string[];
  extra_keywords_tracked: string[];
  extra_keyword_lookups: string[];
  local_map_rankings_extra_keywords: string[];
} {
  const keywordsTracked = ['50', '100', '250'];
  const researchCredits = ['50', '150', '300'];
  const localMapKeywords = ['5', '15'];
  if (!tierId) {
    return {
      extra_dashboards: [],
      extra_keywords_tracked: [],
      extra_keyword_lookups: [],
      local_map_rankings_extra_keywords: [],
    };
  }
  switch (tierId) {
    case 'free':
      return {
        extra_dashboards: [],
        extra_keywords_tracked: [],
        extra_keyword_lookups: [],
        local_map_rankings_extra_keywords: [],
      };
    case 'business_lite':
    case 'business_pro':
      return {
        extra_dashboards: [],
        extra_keywords_tracked: keywordsTracked,
        extra_keyword_lookups: researchCredits,
        local_map_rankings_extra_keywords: [],
      };
    case 'solo':
      return {
        extra_dashboards: ['5_slots'],
        extra_keywords_tracked: keywordsTracked,
        extra_keyword_lookups: researchCredits,
        local_map_rankings_extra_keywords: localMapKeywords,
      };
    case 'starter':
      return {
        extra_dashboards: ['5_slots', '10_slots'],
        extra_keywords_tracked: keywordsTracked,
        extra_keyword_lookups: researchCredits,
        local_map_rankings_extra_keywords: localMapKeywords,
      };
    case 'growth':
    case 'pro':
    case 'enterprise':
      return {
        extra_dashboards: ['5_slots', '10_slots', '25_slots'],
        extra_keywords_tracked: keywordsTracked,
        extra_keyword_lookups: researchCredits,
        local_map_rankings_extra_keywords: localMapKeywords,
      };
    default:
      return {
        extra_dashboards: [],
        extra_keywords_tracked: keywordsTracked,
        extra_keyword_lookups: researchCredits,
        local_map_rankings_extra_keywords: localMapKeywords,
      };
  }
}

const addAddOnSchema = z.object({
  addOnType: z.enum(['extra_dashboards', 'extra_keywords_tracked', 'extra_keyword_lookups', 'local_map_rankings_extra_keywords']),
  addOnOption: z.string().min(1),
});

const ADDON_PRICE_ENV_KEY: Record<string, Record<string, string>> = {
  extra_dashboards: {
    '5_slots': 'STRIPE_PRICE_ADDON_EXTRA_DASHBOARDS_5',
    '10_slots': 'STRIPE_PRICE_ADDON_EXTRA_DASHBOARDS_10',
    '25_slots': 'STRIPE_PRICE_ADDON_EXTRA_DASHBOARDS_25',
  },
  extra_keywords_tracked: {
    '50': 'STRIPE_PRICE_ADDON_EXTRA_KEYWORDS_50',
    '100': 'STRIPE_PRICE_ADDON_EXTRA_KEYWORDS_100',
    '250': 'STRIPE_PRICE_ADDON_EXTRA_KEYWORDS_250',
  },
  extra_keyword_lookups: {
    '50': 'STRIPE_PRICE_ADDON_EXTRA_CREDITS_50',
    '150': 'STRIPE_PRICE_ADDON_EXTRA_CREDITS_150',
    '300': 'STRIPE_PRICE_ADDON_EXTRA_CREDITS_300',
  },
  local_map_rankings_extra_keywords: {
    '5': 'STRIPE_PRICE_ADDON_LOCAL_MAP_KEYWORDS_5',
    '15': 'STRIPE_PRICE_ADDON_LOCAL_MAP_KEYWORDS_15',
  },
};

const ADDON_OPTIONS: Record<string, Record<string, { displayName: string; details: string; priceCents: number; billingInterval: string }>> = {
  extra_dashboards: {
    '5_slots': { displayName: 'Extra Client Dashboards (+5)', details: '+5 client dashboards', priceCents: 9900, billingInterval: 'monthly' },
    '10_slots': { displayName: 'Extra Client Dashboards (+10)', details: '+10 client dashboards', priceCents: 17900, billingInterval: 'monthly' },
    '25_slots': { displayName: 'Extra Client Dashboards (+25)', details: '+25 client dashboards', priceCents: 39900, billingInterval: 'monthly' },
  },
  extra_keywords_tracked: {
    '50': { displayName: 'Extra Keywords Tracked (+50)', details: '+50 keywords tracked account-wide', priceCents: 2900, billingInterval: 'monthly' },
    '100': { displayName: 'Extra Keywords Tracked (+100)', details: '+100 keywords tracked account-wide', priceCents: 4900, billingInterval: 'monthly' },
    '250': { displayName: 'Extra Keywords Tracked (+250)', details: '+250 keywords tracked account-wide', priceCents: 8900, billingInterval: 'monthly' },
  },
  extra_keyword_lookups: {
    '50': { displayName: 'Extra Research Credits (+50/mo)', details: '+50 research credits per month', priceCents: 2900, billingInterval: 'monthly' },
    '150': { displayName: 'Extra Research Credits (+150/mo)', details: '+150 research credits per month', priceCents: 6900, billingInterval: 'monthly' },
    '300': { displayName: 'Extra Research Credits (+300/mo)', details: '+300 research credits per month', priceCents: 11900, billingInterval: 'monthly' },
  },
  local_map_rankings_extra_keywords: {
    '5': { displayName: 'Local Map Rankings - Extra Keywords (+5)', details: '+5 recurring map grid keywords', priceCents: 2900, billingInterval: 'monthly' },
    '15': { displayName: 'Local Map Rankings - Extra Keywords (+15)', details: '+15 recurring map grid keywords', priceCents: 6900, billingInterval: 'monthly' },
  },
};

const SNAPSHOT_CREDIT_PACKS: Record<string, { credits: number; priceCents: number; displayName: string; stripePriceEnvKey: string }> = {
  '5': {
    credits: 5,
    priceCents: 1900,
    displayName: 'Local Map Snapshot Credits (5)',
    stripePriceEnvKey: 'STRIPE_PRICE_ADDON_LOCAL_MAP_SNAPSHOT_CREDITS_5',
  },
  '10': {
    credits: 10,
    priceCents: 3400,
    displayName: 'Local Map Snapshot Credits (10)',
    stripePriceEnvKey: 'STRIPE_PRICE_ADDON_LOCAL_MAP_SNAPSHOT_CREDITS_10',
  },
  '25': {
    credits: 25,
    priceCents: 7400,
    displayName: 'Local Map Snapshot Credits (25)',
    stripePriceEnvKey: 'STRIPE_PRICE_ADDON_LOCAL_MAP_SNAPSHOT_CREDITS_25',
  },
};

const notifySnapshotCreditPackPurchased = async (params: {
  agencyId: string;
  credits: number;
  priceCents: number;
  actorUserId?: string;
}) => {
  const { agencyId, credits, priceCents, actorUserId } = params;
  const agencyRecord = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { name: true },
  });
  const agencyName = String(agencyRecord?.name || 'Agency');
  const agencyRecipient = await resolveAgencyEmailRecipient(agencyId, actorUserId);
  const content = buildSnapshotCreditPackNotificationContent({
    agencyName,
    credits,
    priceCents,
    brandDisplayName: BRAND_DISPLAY_NAME,
    agencyGreetingName: agencyRecipient.recipientName,
  });

  const createdAgencyNotif = await createNotificationOnce({
    agencyId,
    userId: null,
    ...content.agencyNotification,
  });

  const createdSaNotif = await createNotificationOnce({
    agencyId: null,
    userId: null,
    ...content.superAdminNotification,
  });

  if (createdAgencyNotif && agencyRecipient.recipientEmail) {
    await sendEmail({
      to: agencyRecipient.recipientEmail,
      subject: content.agencyEmail.subject,
      html: content.agencyEmail.html,
    }).catch((e) => console.warn('Agency snapshot credits confirmation email failed:', e?.message));
  }

  if (createdSaNotif) {
    await notifySuperAdminsByEmail({
      subject: content.superAdminEmail.subject,
      html: content.superAdminEmail.html,
    });
  }
};

// Add-Ons: add (Stripe + DB, update limits in app when applicable). Agency must have activated account (CC on file).
router.post('/add-ons', authenticateToken, async (req, res) => {
  try {
    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const agency = membership!.agency as { stripeCustomerId?: string | null; trialEndsAt?: Date | null };
    if (!agency.stripeCustomerId) {
      return res.status(403).json({
        message: 'Activate your account first. Add a payment method in Subscription & Billing to add add-ons.',
      });
    }
    const onFreeTrial =
      agency.trialEndsAt &&
      agency.trialEndsAt > new Date() &&
      (((membership!.agency as { billingType?: string | null }).billingType === 'trial') ||
        ((membership!.agency as { billingType?: string | null }).billingType === 'free'));
    if (onFreeTrial) {
      return res.status(403).json({
        message: 'Add-ons are not available during the 7-day free trial. Subscribe to a plan or wait until your trial ends to add add-ons.',
      });
    }
    const agencyId = membership!.agencyId;
    const body = addAddOnSchema.parse(req.body);
    const options = ADDON_OPTIONS[body.addOnType];
    if (!options) return res.status(400).json({ message: 'Invalid add-on type' });
    const option = options[body.addOnOption];
    if (!option) return res.status(400).json({ message: 'Invalid add-on option' });

    const tierConfig = getTierConfig(membership!.agency.subscriptionTier);
    const tierId = tierConfig?.id ?? null;
    const allowed = getAllowedAddOnOptions(tierId as TierId | null);
    const allowedForType = allowed[body.addOnType as keyof typeof allowed];
    if (!Array.isArray(allowedForType) || !allowedForType.includes(body.addOnOption)) {
      if (body.addOnType === 'extra_dashboards' && (tierId === 'business_lite' || tierId === 'business_pro')) {
        return res.status(400).json({ message: 'Extra Dashboards are not available for Business tiers (only tracks 1 business).' });
      }
      return res.status(400).json({ message: 'This add-on is not available for your plan tier.' });
    }

    const agencyRecord = membership!.agency as { stripeCustomerId?: string | null };
    const customerId = agencyRecord?.stripeCustomerId ?? process.env.STRIPE_AGENCY_CUSTOMER_ID ?? null;
    let stripeSubscriptionItemId: string | null = null;
    const stripe = getStripe();
    if (stripe && isStripeConfigured() && customerId) {
      try {
        const priceEnvKey = ADDON_PRICE_ENV_KEY[body.addOnType]?.[body.addOnOption];
        const priceId = priceEnvKey ? process.env[priceEnvKey] : undefined;
        if (priceId) {
          const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
          if (subs.data.length > 0) {
            const item = await stripe.subscriptionItems.create({
              subscription: subs.data[0].id,
              price: priceId,
              quantity: 1,
            });
            stripeSubscriptionItemId = item.id;
          }
        }
      } catch (stripeErr: any) {
        console.warn('Stripe add-on attach failed:', stripeErr?.message);
      }
    }

    const created = await prisma.agencyAddOn.create({
      data: {
        agencyId,
        addOnType: body.addOnType,
        addOnOption: body.addOnOption,
        displayName: option.displayName,
        details: option.details,
        priceCents: option.priceCents,
        billingInterval: option.billingInterval,
        stripeSubscriptionItemId: stripeSubscriptionItemId ?? undefined,
      },
    });

    const agencyName = String((membership!.agency as { name?: string | null })?.name || 'Agency');
    const createdAgencyNotif = await createNotificationOnce({
      agencyId,
      userId: null,
      type: 'addon_added',
      title: 'Add-on added',
      message: `${option.displayName} was added to your plan.`,
      link: '/agency/add-ons',
    });

    const createdSaNotif = await createNotificationOnce({
      agencyId: null,
      userId: null,
      type: 'addon_added',
      title: 'Agency add-on added',
      message: `${agencyName} added ${option.displayName}.`,
      link: '/agency/agencies',
    });

    const agencyRecipient = await resolveAgencyEmailRecipient(agencyId, req.user.userId);
    if (createdAgencyNotif && agencyRecipient.recipientEmail) {
      await sendEmail({
        to: agencyRecipient.recipientEmail,
        subject: `Add-on added to your plan - ${BRAND_DISPLAY_NAME}`,
        html: `
          <h2>Add-on added successfully</h2>
          <p>Hi ${agencyRecipient.recipientName},</p>
          <p><strong>${option.displayName}</strong> has been added to your plan for <strong>${agencyRecipient.agencyName}</strong>.</p>
          <p><strong>Billing:</strong> $${(option.priceCents / 100).toFixed(2)} / ${option.billingInterval.toLowerCase()}</p>
        `,
      }).catch((e) => console.warn('Agency add-on confirmation email failed:', e?.message));
    }

    if (createdSaNotif) {
      await notifySuperAdminsByEmail({
        subject: `Agency add-on added - ${agencyName}`,
        html: `
          <h2>Agency add-on added</h2>
          <p><strong>Agency:</strong> ${agencyName}</p>
          <p><strong>Add-on:</strong> ${option.displayName}</p>
          <p><strong>Price:</strong> $${(option.priceCents / 100).toFixed(2)} / ${option.billingInterval.toLowerCase()}</p>
          <p><strong>Added:</strong> ${new Date().toISOString()}</p>
        `,
      });
    }

    res.status(201).json({
      id: created.id,
      addOnType: created.addOnType,
      addOnOption: created.addOnOption,
      displayName: created.displayName,
      details: created.details,
      priceCents: created.priceCents,
      billingInterval: created.billingInterval,
      createdAt: created.createdAt,
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ message: err.errors?.[0]?.message || 'Invalid input', errors: err.errors });
    }
    console.error('Add add-on error:', err);
    res.status(500).json({ message: err?.message || 'Failed to add add-on' });
  }
});

router.post('/add-ons/local-map-snapshot-credits/checkout', authenticateToken, async (req, res) => {
  try {
    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { pack, uiMode } = z.object({
      pack: z.enum(['5', '10', '25']),
      uiMode: z.enum(['redirect', 'embedded']).optional(),
    }).parse(req.body ?? {});
    const selectedPack = SNAPSHOT_CREDIT_PACKS[pack];
    if (!selectedPack) {
      return res.status(400).json({ message: 'Invalid credit pack' });
    }

    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ message: 'Stripe is not configured' });
    }

    const customerId = membership.agency.stripeCustomerId ?? process.env.STRIPE_AGENCY_CUSTOMER_ID ?? null;
    if (!customerId) {
      return res.status(400).json({
        message: 'Activate your billing profile first to purchase one-time snapshot credits.',
      });
    }

    const frontEndBase = process.env.FRONTEND_URL || 'http://localhost:3001';
    const stripePriceId = process.env[selectedPack.stripePriceEnvKey];
    const isEmbeddedCheckout = uiMode === 'embedded';
    const baseSessionData: any = {
      mode: 'payment',
      customer: customerId,
      ...(stripePriceId
        ? {
            line_items: [{ price: stripePriceId, quantity: 1 }],
          }
        : {
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: 'usd',
                  product_data: {
                    name: selectedPack.displayName,
                    description: `${selectedPack.credits} one-time Local Map Snapshot credits`,
                  },
                  unit_amount: selectedPack.priceCents,
                },
              },
            ],
          }),
      metadata: {
        agencyId: membership.agencyId,
        addOnType: 'local_map_snapshot_credit_pack',
        addOnOption: pack,
      },
    };
    if (isEmbeddedCheckout) {
      baseSessionData.ui_mode = 'embedded';
      baseSessionData.return_url = `${frontEndBase}/agency/add-ons?snapshotCreditsPurchase=success`;
    } else {
      baseSessionData.success_url = `${frontEndBase}/agency/add-ons?snapshotCreditsPurchase=success`;
      baseSessionData.cancel_url = `${frontEndBase}/agency/add-ons?snapshotCreditsPurchase=cancelled`;
    }
    const session = await stripe.checkout.sessions.create(baseSessionData);

    return res.status(201).json({
      url: session.url ?? null,
      sessionId: session.id,
      clientSecret: (session as any).client_secret ?? null,
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ message: err.errors?.[0]?.message || 'Invalid input', errors: err.errors });
    }
    console.error('Create local map snapshot checkout error:', err);
    return res.status(500).json({ message: err?.message || 'Failed to start checkout' });
  }
});

router.post('/add-ons/local-map-snapshot-credits/confirm', authenticateToken, async (req, res) => {
  try {
    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { sessionId } = z.object({
      sessionId: z.string().min(1),
    }).parse(req.body ?? {});

    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ message: 'Stripe is not configured' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const parsed = parseSnapshotCheckoutSession(session as any, membership.agencyId);
    const applied = await applySnapshotCreditPackPurchase({
      prismaClient: prisma,
      agencyId: parsed.agencyId,
      option: parsed.option,
      details: parsed.details,
    });

    await notifySnapshotCreditPackPurchased({
      agencyId: membership.agencyId,
      credits: applied.credits,
      priceCents: applied.priceCents,
      actorUserId: req.user.userId,
    }).catch((e: any) => {
      console.warn('Snapshot credit purchase notifications failed:', e?.message);
    });

    return res.status(200).json({ ok: true, applied: applied.applied });
  } catch (err: any) {
    if (err instanceof SnapshotPurchaseValidationError) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    if (err.name === 'ZodError') {
      return res.status(400).json({ message: err.errors?.[0]?.message || 'Invalid input', errors: err.errors });
    }
    console.error('Confirm local map snapshot checkout error:', err);
    return res.status(500).json({ message: err?.message || 'Failed to confirm checkout' });
  }
});

// Add-Ons: remove
router.delete('/add-ons/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    if (!membership) return res.status(403).json({ message: 'Access denied' });
    const row = await prisma.agencyAddOn.findFirst({
      where: { id, agencyId: membership.agencyId },
    });
    if (!row) return res.status(404).json({ message: 'Add-on not found' });
    const stripe = getStripe();
    if (stripe && row.stripeSubscriptionItemId) {
      try {
        await stripe.subscriptionItems.del(row.stripeSubscriptionItemId);
      } catch (e) {
        console.warn('Stripe subscription item delete failed:', e);
      }
    }
    await prisma.agencyAddOn.delete({ where: { id } });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Remove add-on error:', err);
    res.status(500).json({ message: err?.message || 'Failed to remove add-on' });
  }
});

// Get clients for a specific agency
router.get('/:agencyId/clients', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { agencyId } = req.params;

    // Get all users who are members of this agency
    const memberships = await prisma.userAgency.findMany({
      where: { agencyId },
      select: { userId: true },
    });

    const userIds = memberships.map(m => m.userId);

    if (userIds.length === 0) {
      return res.json([]);
    }

    // Get all clients owned by these users
    const clients = await prisma.client.findMany({
      where: {
        userId: { in: userIds },
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Add statistics from database for each client
    const clientsWithStats = await Promise.all(
      clients.map(async (client) => {
        // Get keyword count and average position
        const keywordStats = await prisma.keyword.aggregate({
          where: { clientId: client.id },
          _count: { id: true },
          _avg: { currentPosition: true },
        });

        // Get top rankings (position <= 10)
        const topRankingsCount = await prisma.keyword.count({
          where: {
            clientId: client.id,
            currentPosition: { lte: 10, not: null },
          },
        });

        // Get traffic from TrafficSource table
        const trafficSource = await prisma.trafficSource.findFirst({
          where: { clientId: client.id },
          select: {
            totalEstimatedTraffic: true,
            organicEstimatedTraffic: true,
          },
        });

        return {
          ...client,
          keywords: keywordStats._count.id || 0,
          avgPosition: keywordStats._avg.currentPosition ? Math.round(keywordStats._avg.currentPosition * 10) / 10 : null,
          topRankings: topRankingsCount || 0,
          traffic: trafficSource?.organicEstimatedTraffic || trafficSource?.totalEstimatedTraffic || 0,
        };
      })
    );

    res.json(clientsWithStats);
  } catch (error) {
    console.error('Get agency clients error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete agency
router.delete('/:agencyId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Access denied. Only Super Admin can delete agencies.' });
    }

    const { agencyId } = req.params;

    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      include: {
        members: {
          include: {
            user: {
              include: {
                clients: true,
              },
            },
          },
        },
      },
    });

    if (!agency) {
      return res.status(404).json({ message: 'Agency not found' });
    }

    // Check if agency has clients (through user memberships)
    const hasClients = agency.members.some(m => m.user.clients.length > 0);
    if (hasClients) {
      return res.status(400).json({ 
        message: 'Cannot delete agency with assigned clients. Please reassign clients first.' 
      });
    }

    // Collect AGENCY-role users who belong only to this agency (no other memberships)
    const agencyUserIdsToDelete: string[] = [];
    for (const m of agency.members) {
      if (m.user.role === 'AGENCY') {
        const otherMemberships = await prisma.userAgency.count({
          where: { userId: m.userId, agencyId: { not: agencyId } },
        });
        if (otherMemberships === 0) {
          agencyUserIdsToDelete.push(m.userId);
        }
      }
    }

    await prisma.agency.delete({
      where: { id: agencyId },
    });

    // Clean up orphaned AGENCY-role users who had no other agency
    if (agencyUserIdsToDelete.length > 0) {
      await prisma.$transaction([
        prisma.task.updateMany({ where: { assigneeId: { in: agencyUserIdsToDelete } }, data: { assigneeId: null } }),
        prisma.task.updateMany({ where: { createdById: { in: agencyUserIdsToDelete } }, data: { createdById: null } }),
        prisma.token.deleteMany({ where: { userId: { in: agencyUserIdsToDelete } } }),
        prisma.user.deleteMany({ where: { id: { in: agencyUserIdsToDelete } } }),
      ]);
    }

    res.json({ message: 'Agency deleted successfully' });
  } catch (error: any) {
    console.error('Delete agency error:', error);
    res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// Assign client to agency
router.post('/:agencyId/assign-client/:clientId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Access denied. Only Super Admin can assign clients to agencies.' });
    }

    const { agencyId, clientId } = req.params;

    // Verify agency exists
    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      include: {
        members: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!agency) {
      return res.status(404).json({ message: 'Agency not found' });
    }

    // Verify client exists and get full details
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true },
            },
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    // Restriction 1: REJECTED clients cannot be assigned to agencies
    if (client.status === 'REJECTED') {
      return res.status(400).json({ 
        message: 'Rejected clients cannot be assigned to agencies. Please activate the client first.' 
      });
    }

    // Restriction 2: Check if client is already assigned to this agency
    const clientUserAgencyIds = client.user.memberships.map(m => m.agencyId);
    if (clientUserAgencyIds.includes(agencyId)) {
      return res.status(400).json({ 
        message: 'Client is already assigned to this agency.' 
      });
    }

    // Find or create an agency owner user
    let agencyOwner = agency.members.find(m => m.agencyRole === 'OWNER')?.user;
    
    if (!agencyOwner) {
      // Create a default agency owner user if none exists
      const bcrypt = await import('bcryptjs');
      const defaultPassword = await bcrypt.default.hash('changeme123', 12);
      const defaultEmail = `${agency.name.toLowerCase().replace(/\s+/g, '')}@agency.local`;
      
      agencyOwner = await prisma.user.create({
        data: {
          email: defaultEmail,
          name: `${agency.name} Owner`,
          passwordHash: defaultPassword,
          role: 'AGENCY',
          verified: true,
          invited: false,
        },
      });

      await prisma.userAgency.create({
        data: {
          userId: agencyOwner.id,
          agencyId: agency.id,
          agencyRole: 'OWNER',
        },
      });
    }

    // Update client's userId to the agency owner
    await prisma.client.update({
      where: { id: clientId },
      data: {
        userId: agencyOwner.id,
      },
    });

    res.json({ 
      message: 'Client assigned to agency successfully',
      clientId,
      agencyId,
    });
  } catch (error: any) {
    console.error('Assign client to agency error:', error);
    res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// Remove client from agency
router.post('/:agencyId/remove-client/:clientId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Access denied. Only Super Admin can remove clients from agencies.' });
    }

    const { agencyId, clientId } = req.params;

    // Verify agency exists
    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      include: {
        members: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!agency) {
      return res.status(404).json({ message: 'Agency not found' });
    }

    // Verify client exists and get current user
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            memberships: {
              select: { agencyId: true },
            },
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    // Check if client is actually assigned to this agency
    // A client belongs to an agency if the client's userId belongs to a user who is a member of that agency
    const clientUserAgencyIds = client.user.memberships.map(m => m.agencyId);
    const isClientAssignedToAgency = clientUserAgencyIds.includes(agencyId);
    
    // Special case: If client's user is SUPER_ADMIN and has no agency memberships,
    // allow removal from any agency (these clients are effectively unassigned)
    // This handles cases where clients are owned by SUPER_ADMIN users who don't have agency memberships
    const isClientUserSuperAdmin = client.user.role === 'SUPER_ADMIN';
    const hasNoAgencyMemberships = clientUserAgencyIds.length === 0;
    const canRemoveUnassignedClient = isClientUserSuperAdmin && hasNoAgencyMemberships;
    
    if (!isClientAssignedToAgency && !canRemoveUnassignedClient) {
      return res.status(400).json({ message: 'Client is not assigned to this agency' });
    }

    // Find a SUPER_ADMIN user to assign the client to (unassigned clients belong to SUPER_ADMIN)
    // Try to find a SUPER_ADMIN who is NOT a member of the agency being removed from
    // This ensures the client is actually removed from the agency
    const superAdminUsers = await prisma.user.findMany({
      where: { role: 'SUPER_ADMIN' },
      select: {
        id: true,
        memberships: {
          where: { agencyId },
          select: { id: true },
        },
      },
    });
    
    // Find one who is NOT a member of this agency
    let superAdminUser: { id: string } | null | undefined = superAdminUsers.find(u => u.memberships.length === 0);
    
    // If all SUPER_ADMIN users are members of this agency, use the first one
    // (This is rare but can happen - the client will still be reassigned)
    if (!superAdminUser && superAdminUsers.length > 0) {
      superAdminUser = superAdminUsers[0];
    }
    
    // Fallback: if no SUPER_ADMIN users found at all (shouldn't happen)
    if (!superAdminUser) {
      superAdminUser = await prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN' },
        select: { id: true },
      });
    }

    if (!superAdminUser) {
      return res.status(500).json({ message: 'No SUPER_ADMIN user found. Cannot unassign client.' });
    }

    // Update client's userId to SUPER_ADMIN (removes from agency)
    await prisma.client.update({
      where: { id: clientId },
      data: {
        userId: superAdminUser.id,
      },
    });

    res.json({ 
      message: 'Client removed from agency successfully',
      clientId,
      agencyId,
    });
  } catch (error: any) {
    console.error('Remove client from agency error:', error);
    res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// Include client for agency - client appears in agency's Included tab
router.post('/:agencyId/include-client/:clientId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Access denied. Only Super Admin can include clients for agencies.' });
    }
    const { agencyId, clientId } = req.params;
    const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
    if (!agency) return res.status(404).json({ message: 'Agency not found' });
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return res.status(404).json({ message: 'Client not found' });
    await prisma.clientAgencyIncluded.upsert({
      where: { clientId_agencyId: { clientId, agencyId } },
      create: { clientId, agencyId },
      update: {},
    });
    res.json({ message: 'Client included for agency successfully', clientId, agencyId });
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (msg.includes('does not exist') || msg.includes('ER_NO_SUCH_TABLE') || error?.code === 'P2021') {
      return res.status(503).json({
        message: 'Included clients feature is not available. Run database migrations: npx prisma migrate deploy',
      });
    }
    console.error('Include client for agency error:', error);
    res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// Uninclude client from agency
router.post('/:agencyId/uninclude-client/:clientId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Access denied. Only Super Admin can uninclude clients from agencies.' });
    }
    const { agencyId, clientId } = req.params;
    await prisma.clientAgencyIncluded.deleteMany({
      where: { clientId, agencyId },
    });
    res.json({ message: 'Client unincluded from agency successfully', clientId, agencyId });
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (msg.includes('does not exist') || msg.includes('ER_NO_SUCH_TABLE') || error?.code === 'P2021') {
      return res.status(503).json({
        message: 'Included clients feature is not available. Run database migrations: npx prisma migrate deploy',
      });
    }
    console.error('Uninclude client from agency error:', error);
    res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

export default router;