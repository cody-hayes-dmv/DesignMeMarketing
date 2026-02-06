import express from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/email.js';
import { authenticateToken, getJwtSecret } from '../middleware/auth.js';
import { getStripe, isStripeConfigured } from '../lib/stripe.js';

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
  tier: z.enum(['solo', 'starter', 'growth', 'pro', 'enterprise']).optional(),
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

router.post('/', authenticateToken, async (req, res) => {
  try {
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
      tier,
      customPricing,
      internalNotes,
      referralSource,
      referralSourceOther,
      primaryGoals,
      primaryGoalsOther,
      currentTools,
    } = body;

    if (!tier && billingOption !== 'manual_invoice') {
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

    const agency = await prisma.agency.create({
      data: {
        name,
        subdomain: subdomain?.trim() || null,
        billingType,
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
        subscriptionTier: tier || null,
        customPricing: customPricing ?? null,
        internalNotes: internalNotes || null,
        onboardingData,
      },
      include: { _count: { select: { members: true } } },
    });

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

    // Create agency
    const agency = await prisma.agency.create({
      data: { name },
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

// Create Stripe billing portal session (for Subscription page: Manage Billing / Upgrade / Downgrade)
router.post('/billing-portal', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'AGENCY' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const returnUrl = (req.body && req.body.returnUrl) || `${req.body?.origin || req.get('origin') || 'http://localhost:3000'}/agency/subscription`;
    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.status(400).json({ url: null, message: 'Billing is not configured. Contact support.' });
    }
    const customerId = process.env.STRIPE_AGENCY_CUSTOMER_ID || (req.body && req.body.stripeCustomerId);
    if (!customerId) {
      return res.status(400).json({
        url: null,
        message: 'No billing account linked. Contact support to set up billing.',
      });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    res.json({ url: session.url });
  } catch (err: any) {
    console.error('Billing portal error:', err);
    res.status(500).json({
      url: null,
      message: err?.message || 'Failed to open billing portal',
    });
  }
});

// Get current user's agency
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

    res.json({
      id: membership.agency.id,
      name: membership.agency.name,
      subdomain: membership.agency.subdomain,
      createdAt: membership.agency.createdAt,
      agencyRole: membership.agencyRole,
    });
  } catch (error) {
    console.error('Get user agency error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update agency settings
const updateAgencySchema = z.object({
  name: z.string().min(1).optional(),
  subdomain: z.string().optional(),
});

router.put('/me', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const updateData = updateAgencySchema.parse(req.body);

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

const activateManagedServiceSchema = z.object({
  packageId: z.enum(['foundation', 'growth', 'domination', 'custom']),
  clientId: z.string().min(1),
  clientAgreed: z.boolean().refine((v) => v === true, { message: 'Client must have agreed to this service' }),
});

const PACKAGES: Record<string, { name: string; priceCents: number }> = {
  foundation: { name: 'Foundation', priceCents: 75000 },
  growth: { name: 'Growth', priceCents: 150000 },
  domination: { name: 'Domination', priceCents: 300000 },
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

    let stripeSubscriptionItemId: string | null = null;
    const stripe = getStripe();
    const customerId = process.env.STRIPE_AGENCY_CUSTOMER_ID;
    if (stripe && isStripeConfigured() && customerId) {
      try {
        const priceId = (process.env as any)[`STRIPE_PRICE_MANAGED_${row.packageId.toUpperCase()}`];
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

const addAddOnSchema = z.object({
  addOnType: z.enum(['credit_pack', 'extra_slots', 'map_pack']),
  addOnOption: z.string().min(1),
});

const ADDON_OPTIONS: Record<string, Record<string, { displayName: string; details: string; priceCents: number; billingInterval: string }>> = {
  credit_pack: {
    '100': { displayName: 'Keyword Credit Pack (100 credits)', details: '100 research credits, one-time', priceCents: 3500, billingInterval: 'one_time' },
    '500': { displayName: 'Keyword Credit Pack (500 credits)', details: '500 research credits, one-time', priceCents: 15000, billingInterval: 'one_time' },
  },
  extra_slots: {
    '5_slots': { displayName: 'Extra Client Slots (+5)', details: '+5 client dashboards', priceCents: 9900, billingInterval: 'monthly' },
  },
  map_pack: {
    starter: { displayName: 'Local Map Pack – Starter', details: '1 keyword per client, bi-weekly updates', priceCents: 4900, billingInterval: 'monthly' },
    growth: { displayName: 'Local Map Pack – Growth', details: '3 keywords per client, weekly updates', priceCents: 14900, billingInterval: 'monthly' },
    pro: { displayName: 'Local Map Pack – Pro', details: '5 keywords per client, weekly updates', priceCents: 24900, billingInterval: 'monthly' },
  },
};

// Add-Ons: add (Stripe + DB, update limits in app when applicable)
router.post('/add-ons', authenticateToken, async (req, res) => {
  try {
    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
      include: { agency: true },
    });
    if (!membership && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const agencyId = membership!.agencyId;
    const body = addAddOnSchema.parse(req.body);
    const options = ADDON_OPTIONS[body.addOnType];
    if (!options) return res.status(400).json({ message: 'Invalid add-on type' });
    const option = options[body.addOnOption];
    if (!option) return res.status(400).json({ message: 'Invalid add-on option' });

    let stripeSubscriptionItemId: string | null = null;
    const stripe = getStripe();
    const customerId = process.env.STRIPE_AGENCY_CUSTOMER_ID;
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

export default router;