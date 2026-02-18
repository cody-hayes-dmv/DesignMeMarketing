import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/email.js';
import { authenticateToken, getJwtSecret } from '../middleware/auth.js';
import { getStripe, isStripeConfigured } from '../lib/stripe.js';
import { getTierConfig, AGENCY_TIER_IDS, type TierId } from '../lib/tiers.js';
import {
  getPriceIdForTier,
  findBasePlanSubscriptionItem,
  syncAgencyTierFromStripe,
} from '../lib/stripeTierSync.js';

const router = express.Router();

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

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

// Get included agencies for a client (for Assign modal - Super Admin only). Must be before /:agencyId
router.get('/included-for-client/:clientId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
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
  billingOption: z.enum(['charge', 'no_charge', 'manual_invoice']),
  paymentMethodId: z.string().optional(), // required when billingOption === 'charge' (Stripe Payment Element)
  tier: z.enum(['solo', 'starter', 'growth', 'pro', 'enterprise', 'business_lite', 'business_pro']).optional(),
  customPricing: z.coerce.number().optional().nullable(),
  internalNotes: z.string().optional(),
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
}, { message: 'Agency website must be a valid URL', path: ['website'] });

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

// Create a SetupIntent for collecting a payment method when creating an agency with "Charge to Card"
// Super Admin only. No customer yet; payment method will be attached to the new agency's Stripe customer on create.
router.post('/setup-intent', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
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
    if (req.user.role !== 'SUPER_ADMIN') {
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
    const onboardingData = (referralSource || (primaryGoals && primaryGoals.length) || currentTools || referralSourceOther || primaryGoalsOther)
      ? JSON.stringify({
          referralSource: referralSource === 'referral' ? referralSourceOther : referralSource,
          primaryGoals: primaryGoals || [],
          primaryGoalsOther: primaryGoalsOther || undefined,
          currentTools: currentTools || undefined,
        })
      : null;

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

    // 7-day free trial for reporting features only; CC required so we can auto-bill after trial.
    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const reportingTier: TierId = 'solo';
    const tierPriceId = getPriceIdForTier(reportingTier);
    if (!tierPriceId || !tierPriceId.startsWith('price_')) {
      await prisma.user.delete({ where: { id: agencyUser.id } }).catch(() => {});
      console.error('[agencies] register: missing STRIPE_PRICE_PLAN_SOLO for reporting trial');
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
      await prisma.client.create({
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
        subject: `Verify your email – ${name}`,
        html: `
          <h1>Verify your agency account</h1>
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
    if (req.user.role !== 'SUPER_ADMIN') {
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
    } = body;

    if (billingOption === 'charge' && !paymentMethodId) {
      return res.status(400).json({ message: 'Payment method is required when billing type is Charge to Card.' });
    }
    if (billingOption === 'charge') {
      const stripe = getStripe();
      if (!stripe || !isStripeConfigured()) {
        return res.status(400).json({ message: 'Stripe is not configured. Cannot create agency with Charge to Card. Set STRIPE_SECRET_KEY on the server.' });
      }
    }
    if (!tier && billingOption !== 'manual_invoice' && billingOption !== 'no_charge') {
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

    const billingType = billingOption === 'charge' ? 'paid' : billingOption === 'no_charge' ? 'free' : 'custom';
    const onboardingData = (referralSource || (primaryGoals && primaryGoals.length) || currentTools || referralSourceOther || primaryGoalsOther)
      ? JSON.stringify({
          referralSource: referralSource === 'referral' ? referralSourceOther : referralSource,
          primaryGoals: primaryGoals || [],
          primaryGoalsOther: primaryGoalsOther || undefined,
          currentTools: currentTools || undefined,
        })
      : null;

    // Super Admin–created agencies: 7-day trial only when no charge (free tier / choose later)
    const trialEndsAt =
      billingOption === "no_charge"
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        : null;

    // When "Charge to Card": create Stripe customer, attach payment method, create subscription for tier, THEN create agency
    let stripeCustomerId: string | null = null;
    let stripeSubscriptionId: string | null = null;
    if (billingOption === 'charge') {
      if (!paymentMethodId || !tier) {
        return res.status(400).json({
          message: paymentMethodId ? 'Subscription tier is required for Charge to Card.' : 'Payment method is required when billing type is Charge to Card.',
        });
      }
      const stripe = getStripe();
      if (!stripe || !isStripeConfigured()) {
        return res.status(400).json({ message: 'Stripe is not configured. Cannot create agency with Charge to Card. Set STRIPE_SECRET_KEY on the server.' });
      }
      try {
        console.log('[agencies] Charge to Card: creating Stripe customer, tier=', tier);
        const customer = await stripe.customers.create({
          email: contactEmail,
          name: contactName || name,
        });
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
        await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: paymentMethodId } });
        stripeCustomerId = customer.id;

        // Create subscription for the selected tier. Use error_if_incomplete so the first invoice must be paid
        // for the subscription to be created — we only create the agency when the subscription is active.
        const tierPriceEnvKey = `STRIPE_PRICE_PLAN_${tier.toUpperCase().replace(/-/g, '_')}`;
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

    // Safeguard: never create a "Charge to Card" agency without Stripe customer + subscription
    if (billingOption === 'charge' && (!stripeCustomerId || !stripeSubscriptionId)) {
      console.error('[agencies] Charge to Card selected but Stripe customer or subscription missing');
      return res.status(500).json({ message: 'Could not set up billing. Please try again or contact support.' });
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
        subscriptionTier: billingOption === 'no_charge' ? 'free' : (tier || null),
        customPricing: customPricing ?? null,
        internalNotes: internalNotes || null,
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

    const agencyUser = await prisma.user.create({
      data: {
        email: contactEmail,
        name: contactName,
        passwordHash: null,
        role: 'AGENCY',
        verified: false,
        invited: true,
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
      await prisma.client.create({
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
    } catch (dashboardErr: any) {
      console.warn('Auto agency dashboard create failed:', dashboardErr?.message);
    }

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
        subject: `Set your password – ${name}`,
        html: `
          <h1>Your agency account is ready</h1>
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

    res.status(201).json({
      id: agency.id,
      name: agency.name,
      subdomain: agency.subdomain,
      createdAt: agency.createdAt,
      memberCount: agency._count.members,
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
    const trialExpired = billingType === "free" && !trialActive;

    const tierId = tierConfig?.id ?? null;
    const accountActivated = !!(membership.agency as { stripeCustomerId?: string | null }).stripeCustomerId;
    res.json({
      id: membership.agency.id,
      name: membership.agency.name,
      subdomain: membership.agency.subdomain,
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
      allowedAddOns: getAllowedAddOnOptions(tierId as TierId | null),
      basePriceMonthlyUsd: tierConfig?.priceMonthlyUsd ?? null,
    });
  } catch (error) {
    console.error('Get user agency error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update agency settings (current user's agency). Must be BEFORE /:agencyId.
const updateAgencyMeSchema = z.object({
  name: z.string().min(1).optional(),
  subdomain: z.string().optional(),
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

    // Check if subdomain is already taken (if being updated)
    if (updateData.subdomain && updateData.subdomain !== membership.agency.subdomain) {
      const existingAgency = await prisma.agency.findUnique({
        where: { subdomain: updateData.subdomain },
      });

      if (existingAgency) {
        return res.status(400).json({ message: 'Subdomain already taken' });
      }
    }

    // Update agency
    const updatedAgency = await prisma.agency.update({
      where: { id: membership.agency.id },
      data: updateData,
    });

    res.json({
      id: updatedAgency.id,
      name: updatedAgency.name,
      subdomain: updatedAgency.subdomain,
      createdAt: updatedAgency.createdAt,
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
    const pendingOnly = req.query.pendingOnly === 'true' && user.role === 'SUPER_ADMIN';
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

// Get single agency (Super Admin only) - full details for edit form
router.get('/:agencyId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
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
      createdAt: agency.createdAt,
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
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  contactJobTitle: z.string().optional(),
  streetAddress: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  subdomain: z.string().optional(),
  billingType: z.enum(['paid', 'free', 'custom']).optional().nullable(),
  subscriptionTier: z.string().optional().nullable(),
  customPricing: z.coerce.number().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
}).refine((data) => {
  const w = data.website;
  if (!w || w === '') return true;
  try {
    new URL(w.startsWith('http') ? w : `https://${w}`);
    return true;
  } catch {
    return false;
  }
}, { message: 'Agency website must be a valid URL', path: ['website'] });

router.put('/:agencyId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
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

    const newSubdomain = updateData.subdomain !== undefined ? (updateData.subdomain?.trim() || null) : undefined;
    if (newSubdomain !== undefined && newSubdomain !== agency.subdomain && newSubdomain) {
      const existing = await prisma.agency.findFirst({
        where: { subdomain: newSubdomain },
      });
      if (existing) {
        return res.status(400).json({ message: 'Subdomain already taken' });
      }
    }

    const payload: Record<string, unknown> = {};
    if (updateData.name !== undefined) payload.name = updateData.name;
    if (updateData.website !== undefined) payload.website = updateData.website;
    if (updateData.industry !== undefined) payload.industry = updateData.industry;
    if (updateData.agencySize !== undefined) payload.agencySize = updateData.agencySize;
    if (updateData.numberOfClients !== undefined) payload.numberOfClients = updateData.numberOfClients;
    if (updateData.contactName !== undefined) payload.contactName = updateData.contactName;
    if (updateData.contactEmail !== undefined) payload.contactEmail = updateData.contactEmail;
    if (updateData.contactPhone !== undefined) payload.contactPhone = updateData.contactPhone;
    if (updateData.contactJobTitle !== undefined) payload.contactJobTitle = updateData.contactJobTitle;
    if (updateData.streetAddress !== undefined) payload.streetAddress = updateData.streetAddress;
    if (updateData.city !== undefined) payload.city = updateData.city;
    if (updateData.state !== undefined) payload.state = updateData.state;
    if (updateData.zip !== undefined) payload.zip = updateData.zip;
    if (updateData.country !== undefined) payload.country = updateData.country;
    if (updateData.subdomain !== undefined) payload.subdomain = newSubdomain ?? null;
    if (updateData.billingType !== undefined) payload.billingType = updateData.billingType;
    if (updateData.subscriptionTier !== undefined) payload.subscriptionTier = updateData.subscriptionTier;
    if (updateData.customPricing !== undefined) payload.customPricing = updateData.customPricing;
    if (updateData.internalNotes !== undefined) payload.internalNotes = updateData.internalNotes;

    const updated = await prisma.agency.update({
      where: { id: agencyId },
      data: payload,
    });

    res.json({
      id: updated.id,
      name: updated.name,
      subdomain: updated.subdomain,
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
      subject: 'You\'re invited to YourSEODashboard',
      html: `
        <h1>You've been invited to join YourSEODashboard!</h1>
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
      subject: 'You\'re invited to join an agency on YourSEODashboard',
      html: `
        <h1>You've been invited to join ${membership?.agency.name || 'an agency'}!</h1>
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
    if (!targetPlan || !AGENCY_TIER_IDS.includes(targetPlan as TierId)) {
      return res.status(400).json({ message: 'Invalid target plan. Use one of: solo, starter, growth, pro, enterprise.' });
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

// Change base plan directly via Stripe API (works with multi-item subscriptions: only the plan item is updated).
// Validates downgrade (client counts, managed services) then updates the subscription item for the base plan.
router.post('/change-plan', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'AGENCY' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const targetPlan = typeof req.body?.targetPlan === 'string' ? req.body.targetPlan.trim().toLowerCase() : '';
    if (!targetPlan || !AGENCY_TIER_IDS.includes(targetPlan as TierId)) {
      return res.status(400).json({ message: 'Invalid target plan. Use one of: solo, starter, growth, pro, enterprise.' });
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
    await stripe.subscriptionItems.update(basePlan.itemId, { price: targetPriceId });
    await syncAgencyTierFromStripe(agency.id);
    return res.json({ success: true, message: 'Plan updated. Your subscription will reflect the change shortly.' });
  } catch (err: any) {
    console.error('Change plan error:', err);
    res.status(500).json({ message: err?.message || 'Failed to change plan' });
  }
});

// Create Stripe billing portal session (for Subscription page: Manage Billing / Upgrade / Downgrade)
// Uses the current user's agency.stripeCustomerId (or creates one if missing). Fallback: STRIPE_AGENCY_CUSTOMER_ID. Never uses req.body for customer id.
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

    let customerId = agency.stripeCustomerId ?? process.env.STRIPE_AGENCY_CUSTOMER_ID ?? null;
    let didCreateCustomer = false;
    if (!customerId) {
      const email = agency.contactEmail ?? (await prisma.user.findUnique({
        where: { id: membership.userId },
        select: { email: true },
      }).then((u) => u?.email ?? undefined));
      const customer = await stripe.customers.create({
        email: email ?? undefined,
        name: agency.name ?? undefined,
        metadata: { agencyId: agency.id },
      });
      customerId = customer.id;
      didCreateCustomer = true;
      // Do NOT persist stripeCustomerId here. Only persist after we successfully create the portal session,
      // so that a failed "Choose a plan" click does not unlock Managed Services / Add-Ons (accountActivated).
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
        message: 'Activate your account first. Add a payment method in Subscription & Billing to unlock managed services. The 7-day free trial is for reporting only; managed plans are paid when approved.',
      });
    }
    const onFreeTrial = agency.trialEndsAt && agency.trialEndsAt > new Date();
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

    const notifyEmail = process.env.MANAGED_SERVICE_NOTIFY_EMAIL || process.env.JOHNNY_EMAIL; // Super Admin notification email
    if (notifyEmail) {
      sendEmail({
        to: notifyEmail,
        subject: `Managed service pending approval: ${agencyName} – ${client.name} – ${pkg.name}`,
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
      }).catch((e) => console.warn('Notify managed service email failed:', e));
    }

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

// Managed Services: approve (SUPER_ADMIN only). Sets client ACTIVE, starts billing, notifies agency.
router.patch('/managed-services/:id/approve', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
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
            <p>— SEO Dashboard</p>
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

// Managed Services: reject (SUPER_ADMIN only). Client becomes Dashboard Only, agency notified.
router.patch('/managed-services/:id/reject', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
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
            <p>— SEO Dashboard</p>
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
} {
  const keywordsTracked = ['100', '250', '500'];
  const keywordLookups = ['100', '300', '500'];
  if (!tierId) return { extra_dashboards: [], extra_keywords_tracked: [], extra_keyword_lookups: [] };
  switch (tierId) {
    case 'free':
      return { extra_dashboards: [], extra_keywords_tracked: [], extra_keyword_lookups: [] };
    case 'business_lite':
    case 'business_pro':
      return { extra_dashboards: [], extra_keywords_tracked: keywordsTracked, extra_keyword_lookups: keywordLookups };
    case 'solo':
      return { extra_dashboards: ['5_slots'], extra_keywords_tracked: keywordsTracked, extra_keyword_lookups: keywordLookups };
    case 'starter':
      return { extra_dashboards: ['5_slots', '10_slots'], extra_keywords_tracked: keywordsTracked, extra_keyword_lookups: keywordLookups };
    case 'growth':
    case 'pro':
    case 'enterprise':
      return { extra_dashboards: ['5_slots', '10_slots', '25_slots'], extra_keywords_tracked: keywordsTracked, extra_keyword_lookups: keywordLookups };
    default:
      return { extra_dashboards: [], extra_keywords_tracked: keywordsTracked, extra_keyword_lookups: keywordLookups };
  }
}

const addAddOnSchema = z.object({
  addOnType: z.enum(['extra_dashboards', 'extra_keywords_tracked', 'extra_keyword_lookups']),
  addOnOption: z.string().min(1),
});

const ADDON_OPTIONS: Record<string, Record<string, { displayName: string; details: string; priceCents: number; billingInterval: string }>> = {
  extra_dashboards: {
    '5_slots': { displayName: 'Extra Client Dashboards (+5)', details: '+5 client dashboards', priceCents: 9900, billingInterval: 'monthly' },
    '10_slots': { displayName: 'Extra Client Dashboards (+10)', details: '+10 client dashboards', priceCents: 17900, billingInterval: 'monthly' },
    '25_slots': { displayName: 'Extra Client Dashboards (+25)', details: '+25 client dashboards', priceCents: 39900, billingInterval: 'monthly' },
  },
  extra_keywords_tracked: {
    '100': { displayName: 'Extra Keywords Tracked (+100)', details: '+100 keywords tracked account-wide', priceCents: 4900, billingInterval: 'monthly' },
    '250': { displayName: 'Extra Keywords Tracked (+250)', details: '+250 keywords tracked account-wide', priceCents: 9900, billingInterval: 'monthly' },
    '500': { displayName: 'Extra Keywords Tracked (+500)', details: '+500 keywords tracked account-wide', priceCents: 17900, billingInterval: 'monthly' },
  },
  extra_keyword_lookups: {
    '100': { displayName: 'Extra Keyword Research Lookups (+100/mo)', details: '+100 keyword lookups per month', priceCents: 4900, billingInterval: 'monthly' },
    '300': { displayName: 'Extra Keyword Research Lookups (+300/mo)', details: '+300 keyword lookups per month', priceCents: 12900, billingInterval: 'monthly' },
    '500': { displayName: 'Extra Keyword Research Lookups (+500/mo)', details: '+500 keyword lookups per month', priceCents: 19900, billingInterval: 'monthly' },
  },
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
        message: 'Activate your account first. Add a payment method in Subscription & Billing to add add-ons. The 7-day free trial is for reporting only; add-ons and managed plans are paid when added or approved.',
      });
    }
    const onFreeTrial = agency.trialEndsAt && agency.trialEndsAt > new Date();
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
        const priceKey = `STRIPE_PRICE_ADDON_${body.addOnType.toUpperCase()}_${body.addOnOption.toUpperCase().replace('-', '_')}`;
        const priceId = (process.env as any)[priceKey];
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

// Delete agency (Super Admin only)
router.delete('/:agencyId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
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

    // Delete agency. Database CASCADE removes all UserAgency rows for this agency,
    // so the agency is removed from Team (members' agency lists) in the database.
    await prisma.agency.delete({
      where: { id: agencyId },
    });

    res.json({ message: 'Agency deleted successfully' });
  } catch (error: any) {
    console.error('Delete agency error:', error);
    res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// Assign client to agency (Super Admin only)
router.post('/:agencyId/assign-client/:clientId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
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

// Remove client from agency (Super Admin only)
router.post('/:agencyId/remove-client/:clientId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
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

// Include client for agency (Super Admin only) - client appears in agency's Included tab
router.post('/:agencyId/include-client/:clientId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
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

// Uninclude client from agency (Super Admin only)
router.post('/:agencyId/uninclude-client/:clientId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
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