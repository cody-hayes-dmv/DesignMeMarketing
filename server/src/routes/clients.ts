import express from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, getJwtSecret } from '../middleware/auth.js';
import { sendEmail } from '../lib/email.js';
import { getAgencyTierContext, canAddDashboard } from '../lib/agencyLimits.js';

const router = express.Router();

const inviteClientUsersSchema = z.object({
    emails: z.array(z.string().email()).min(1),
    sendEmail: z.boolean().optional().default(true),
    clientRole: z.enum(['CLIENT', 'STAFF']).optional().default('CLIENT'),
});

const inviteClientUsersMultiSchema = z.object({
    invites: z
        .array(
            z.object({
                email: z.string().email(),
                clientIds: z.array(z.string().min(1)).min(1),
            })
        )
        .min(1),
    sendEmail: z.boolean().optional().default(true),
    clientRole: z.enum(['CLIENT', 'STAFF']).optional().default('CLIENT'),
});

const updateClientUserProfileSchema = z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    password: z.string().min(6).optional(),
    // New UI: Yes/No toggles
    sendInviteLink: z.boolean().optional(),
    emailCredentials: z.boolean().optional(),
    // Back-compat with older UI
    emailMode: z.enum(['NONE', 'INVITE', 'CREDENTIALS']).optional(),
});

const updateClientUserAccessSchema = z.object({
    clientIds: z.array(z.string().min(1)).optional().default([]),
});

interface ClientWithUser {
    id: string;
    userId: string;
    googleAdsAccessToken?: string | null;
    googleAdsRefreshToken?: string | null;
    googleAdsCustomerId?: string | null;
    googleAdsConnectedAt?: Date | null;
    user: {
        id: string;
        memberships: Array<{ agencyId: string }>;
    };
}

// Vendasta clients have full feature access: dashboard, report, keywords, rankings, integrations (GA4/Google Ads), PPC, etc.
// The vendasta flag only affects list placement (Vendasta page vs Clients page); do not restrict API or dashboard access by vendasta.
async function canStaffAccessClient(user: { userId: string; role: string }, clientId: string, includeGoogleAds: boolean = false): Promise<{ client: ClientWithUser | null; hasAccess: boolean }> {
    const client = await prisma.client.findUnique({
        where: { id: clientId },
        select: {
            id: true,
            userId: true,
            belongsToAgencyId: true,
            ...(includeGoogleAds ? {
                googleAdsAccessToken: true,
                googleAdsRefreshToken: true,
                googleAdsCustomerId: true,
                googleAdsConnectedAt: true,
            } : {}),
            user: {
                select: {
                    id: true,
                    memberships: {
                        select: { agencyId: true },
                    },
                },
            },
        },
    });

    if (!client) return { client: null, hasAccess: false };

    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
    const isOwner = client.userId === user.userId;

    if (isAdmin || isOwner) return { client, hasAccess: true };

  // Agency/Specialist users: check if in same agency (owner's membership), client belongs to agency, included, or specialist has tasks for client
  if (user.role === 'AGENCY' || user.role === 'SPECIALIST') {
        const userMemberships = await prisma.userAgency.findMany({
            where: { userId: user.userId },
            select: { agencyId: true },
        });
        const userAgencyIds = userMemberships.map(m => m.agencyId);
        const clientAgencyIds = (client.user?.memberships ?? []).map(m => m.agencyId);
        const sameAgency = clientAgencyIds.some(id => userAgencyIds.includes(id));
        if (sameAgency) return { client, hasAccess: true };
        // Client belongs to specialist's agency (belongsToAgencyId)
        if (client.belongsToAgencyId && userAgencyIds.includes(client.belongsToAgencyId)) {
            return { client, hasAccess: true };
        }
        // Specialist has a task assigned for this client
        if (user.role === 'SPECIALIST') {
            const taskForClient = await prisma.task.findFirst({
                where: { clientId, assigneeId: user.userId },
            });
            if (taskForClient) return { client, hasAccess: true };
        }
        // Client is "included" for specialist's agency (ClientAgencyIncluded)
        try {
            const included = await prisma.clientAgencyIncluded.findFirst({
                where: { clientId, agencyId: { in: userAgencyIds } },
            });
            return { client, hasAccess: !!included };
        } catch {
            return { client, hasAccess: false };
        }
    }

    return { client, hasAccess: false };
}

const createClientSchema = z.object({
    name: z.string().min(1),
    // Accept common inputs (domain.com, www.domain.com, https://domain.com/path) and normalize server-side.
    domain: z.string().min(1),
    industry: z.string().optional(),
    targets: z.array(z.string()).optional(),
    // Website info
    loginUrl: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    // Extended onboarding/account info blob
    accountInfo: z.record(z.any()).optional(),
    // Status is ignored - determined by user role (SUPER_ADMIN = ACTIVE, others = PENDING)
    status: z.enum(['ACTIVE', 'PENDING', 'REJECTED', 'DASHBOARD_ONLY', 'CANCELED', 'SUSPENDED', 'ARCHIVED']).optional(),
});

const restrictedAccountInfoKeys = [
    'seoRoadmapStartMonth',
    'pagesPerMonth',
    'technicalHoursPerMonth',
    'campaignDurationMonths',
] as const;

const superAdminOnlyAccountInfoKeys = [
    'totalKeywordsToTarget',
    'seoRoadmapSection',
    'managedServicePackage',
    'serviceStartDate',
] as const;

function sanitizeAccountInfo(input: any, canEditRestricted: boolean, isSuperAdmin: boolean = false) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const next: Record<string, any> = { ...(input as any) };
    if (!canEditRestricted) {
        for (const k of restrictedAccountInfoKeys) {
            if (k in next) delete next[k];
        }
    }
    if (!isSuperAdmin) {
        for (const k of superAdminOnlyAccountInfoKeys) {
            if (k in next) delete next[k];
        }
    }
    return next;
}

function parseAccountInfoString(raw: any): Record<string, any> | null {
    if (!raw || typeof raw !== 'string') return null;
    try {
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
        return obj as Record<string, any>;
    } catch {
        return null;
    }
}

function normalizeDomainInput(input: string): string {
    const raw = String(input || '').trim();
    if (!raw) throw new Error('Domain is required');

    let host = '';
    try {
        const url = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`);
        host = url.hostname;
    } catch {
        // Fallback parsing for weird inputs
        host = raw
            .replace(/^https?:\/\//, '')
            .split('/')[0]
            .split('?')[0]
            .split('#')[0]
            .split(':')[0];
    }

    host = host.replace(/^www\./, '').toLowerCase();

    // Basic hostname validation: allow subdomains
    const hostnameOk = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(host);
    if (!hostnameOk) {
        throw new Error('Invalid domain. Please enter a valid hostname like "example.com".');
    }

    return host;
}

// Get all clients
// List clients (includes Vendasta clients; frontend splits display between Clients page and Vendasta page).
router.get('/', authenticateToken, async (req, res) => {
    try {
        let clients;
        const includeAgencyNames = req.user.role === 'SUPER_ADMIN' || req.user.role === 'ADMIN';

        if (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') {
            // Global admins see all clients (no vendasta filter — Vendasta clients have full features)
            clients = await prisma.client.findMany({
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            ...(includeAgencyNames
                                ? {
                                      memberships: {
                                          select: {
                                              agency: { select: { name: true } },
                                          },
                                      },
                                  }
                                : {}),
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
            });
        } else if (req.user.role === 'USER') {
            // Client-portal users: only clients they are linked to via client_users
            clients = await prisma.client.findMany({
                where: {
                    clientUsers: {
                        some: {
                            userId: req.user.userId,
                            status: 'ACTIVE',
                        },
                    },
                },
                include: {
                    user: {
                        select: { id: true, name: true, email: true },
                    },
                },
                orderBy: { createdAt: 'desc' },
            });
        } else {
      // Specialist/Agency users → get clients of their agency
            const memberships = await prisma.userAgency.findMany({
                where: { userId: req.user.userId },
                select: { agencyId: true },
            });

            const agencyIds = memberships.map(m => m.agencyId);

            clients = await prisma.client.findMany({
                where: {
                    user: {
                        memberships: {
                            some: { agencyId: { in: agencyIds } },
                        },
                    },
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            memberships: {
                                select: { agency: { select: { name: true } } },
                            },
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
            });
        }

        // For SUPER_ADMIN/ADMIN: map clientId -> pending ManagedService id (for Approve from Clients page)
        let pendingManagedServiceByClientId: Record<string, string> = {};
        if (includeAgencyNames) {
            const pendingList = await prisma.managedService.findMany({
                where: { status: 'PENDING' },
                select: { id: true, clientId: true },
            });
            pendingList.forEach((m) => { pendingManagedServiceByClientId[m.clientId] = m.id; });
        }

        // Add statistics from database for each client
        const clientsWithStats = await Promise.all(
            clients.map(async (client: any) => {
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

                // Prefer GA4 total sessions (last saved snapshot is typically last 30 days)
                // This is DB-only and does not call Google/DataForSEO.
                const ga4Metrics = await prisma.ga4Metrics.findUnique({
                    where: { clientId: client.id },
                    select: { totalSessions: true, endDate: true },
                });
                const traffic30d = ga4Metrics?.totalSessions ?? null;

                const agencyNames: string[] = (client.user?.memberships ?? [])
                    .map((m: { agency?: { name: string } }) => m.agency?.name)
                    .filter(Boolean);

                return {
                    ...client,
                    keywords: keywordStats._count.id || 0,
                    avgPosition: keywordStats._avg.currentPosition ? Math.round(keywordStats._avg.currentPosition * 10) / 10 : null,
                    topRankings: topRankingsCount || 0,
                    traffic: trafficSource?.organicEstimatedTraffic || trafficSource?.totalEstimatedTraffic || 0,
                    traffic30d,
                    agencyNames,
                    ...(includeAgencyNames ? { pendingManagedServiceId: pendingManagedServiceByClientId[client.id] || null } : {}),
                };
            })
        );

        res.json(clientsWithStats);
    } catch (error) {
        console.error('Fetch clients error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// List all client portal users across accessible clients (sorted by last login)
router.get('/users', authenticateToken, async (req, res) => {
    try {
        if (req.user.role === 'USER') {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Determine which clients the requester can manage
        let clientIds: string[] | null = null; // null => all
        const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
        if (!isAdmin) {
      if (req.user.role === 'AGENCY' || req.user.role === 'SPECIALIST') {
                const memberships = await prisma.userAgency.findMany({
                    where: { userId: req.user.userId },
                    select: { agencyId: true },
                });
                const agencyIds = memberships.map((m) => m.agencyId);
                const clients = await prisma.client.findMany({
                    where: {
                        OR: [
                            { userId: req.user.userId },
                            {
                                user: {
                                    memberships: {
                                        some: { agencyId: { in: agencyIds } },
                                    },
                                },
                            },
                        ],
                    },
                    select: { id: true },
                });
                clientIds = clients.map((c) => c.id);
            } else {
                const clients = await prisma.client.findMany({
                    where: { userId: req.user.userId },
                    select: { id: true },
                });
                clientIds = clients.map((c) => c.id);
            }
        }

        const rows = await prisma.clientUser.findMany({
            where: clientIds ? { clientId: { in: clientIds } } : undefined,
            include: {
                client: { select: { id: true, name: true, domain: true } },
                user: { select: { id: true, email: true, name: true, lastLoginAt: true } },
            },
            orderBy: [{ user: { lastLoginAt: 'desc' } }, { invitedAt: 'desc' }],
        });

        return res.json(
            rows.map((r) => ({
                id: r.id,
                clientId: r.clientId,
                clientName: r.client.name,
                clientDomain: r.client.domain,
                userId: r.userId,
                email: r.user.email,
                name: r.user.name,
                role: r.clientRole,
                status: r.status,
                lastLoginAt: r.user.lastLoginAt,
            }))
        );
    } catch (error) {
        console.error('List all client users error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// Get client access list for a user (for Edit Client Access modal)
router.get('/users/:userId/access', authenticateToken, async (req, res) => {
    try {
        if (req.user.role === 'USER') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const userId = String(req.params.userId || '');
        if (!userId) return res.status(400).json({ message: 'Missing userId' });

        const memberships = await prisma.clientUser.findMany({
            where: { userId },
            include: { client: { select: { id: true, name: true, domain: true } } },
            orderBy: { invitedAt: 'desc' },
        });

        // Only return rows for clients the requester can manage.
        const allowed: any[] = [];
        for (const m of memberships) {
            const { hasAccess } = await canStaffAccessClient(req.user, m.clientId);
            if (!hasAccess) continue;
            allowed.push({
                clientId: m.clientId,
                name: m.client.name,
                domain: m.client.domain,
                role: m.clientRole,
                status: m.status,
            });
        }

        return res.json({ userId, clients: allowed });
    } catch (error) {
        console.error('Get client user access error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// Update client access list for a user (add/remove memberships across clients)
router.put('/users/:userId/access', authenticateToken, async (req, res) => {
    try {
        if (req.user.role === 'USER') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const userId = String(req.params.userId || '');
        if (!userId) return res.status(400).json({ message: 'Missing userId' });

        const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, verified: true } });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const { clientIds } = updateClientUserAccessSchema.parse(req.body || {});
        const desired = new Set(clientIds.map((c) => String(c)));

        // Add / keep selected
        for (const clientId of desired) {
            const { client, hasAccess } = await canStaffAccessClient(req.user, clientId);
            if (!client) return res.status(404).json({ message: 'Client not found' });
            if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

            await prisma.clientUser.upsert({
                where: { clientId_userId: { clientId, userId } },
                update: {
                    status: user.verified ? 'ACTIVE' : 'PENDING',
                    invitedById: req.user.userId,
                    invitedAt: new Date(),
                },
                create: {
                    clientId,
                    userId,
                    clientRole: 'CLIENT',
                    status: user.verified ? 'ACTIVE' : 'PENDING',
                    invitedById: req.user.userId,
                    invitedAt: new Date(),
                },
            });
        }

        // Remove unselected (only where requester has access)
        const existing = await prisma.clientUser.findMany({ where: { userId }, select: { clientId: true } });
        for (const m of existing) {
            if (desired.has(m.clientId)) continue;
            const { hasAccess } = await canStaffAccessClient(req.user, m.clientId);
            if (!hasAccess) continue;
            await prisma.clientUser.delete({ where: { clientId_userId: { clientId: m.clientId, userId } } });
        }

        return res.json({ message: 'Access updated' });
    } catch (error: any) {
        if (error?.name === 'ZodError') {
            return res.status(400).json({ message: 'Invalid input', errors: error.errors });
        }
        console.error('Update client user access error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// Get single client by ID (for Specialist view company info, etc.)
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;
        if (req.user.role === 'USER') {
            return res.status(403).json({ message: 'Access denied' });
        }
        const { hasAccess } = await canStaffAccessClient(req.user, clientId);
        if (!hasAccess) {
            return res.status(404).json({ message: 'Client not found' });
        }
        const client = await prisma.client.findUnique({
            where: { id: clientId },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        memberships: { select: { agency: { select: { name: true } } } },
                    },
                },
            },
        });
        if (!client) return res.status(404).json({ message: 'Client not found' });
        const agencyNames = (client.user?.memberships ?? [])
            .map((m: { agency?: { name: string } }) => m.agency?.name)
            .filter(Boolean);
        res.json({
            ...client,
            agencyNames,
        });
    } catch (error) {
        console.error('Get client error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// List client portal users for a client
router.get('/:id/users', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;
        if (req.user.role === 'USER') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const { client, hasAccess } = await canStaffAccessClient(req.user, clientId);
        if (!client) return res.status(404).json({ message: 'Client not found' });
        if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

        const rows = await prisma.clientUser.findMany({
            where: { clientId },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        verified: true,
                        invited: true,
                        lastLoginAt: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return res.json(
            rows.map((r) => ({
                id: r.id,
                clientId: r.clientId,
                userId: r.userId,
                email: r.user.email,
                name: r.user.name,
                role: r.clientRole,
                status: r.status,
                invitedAt: r.invitedAt,
                acceptedAt: r.acceptedAt,
                lastLoginAt: r.user.lastLoginAt,
            }))
        );
    } catch (error) {
        console.error('List client users error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// Update a client portal user's profile (name/password) for a given client
router.put('/:id/users/:userId/profile', authenticateToken, async (req, res) => {
    try {
        const clientId = String(req.params.id || '');
        const userId = String(req.params.userId || '');
        if (!clientId || !userId) return res.status(400).json({ message: 'Missing clientId or userId' });

        if (req.user.role === 'USER') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const { client, hasAccess } = await canStaffAccessClient(req.user, clientId);
        if (!client) return res.status(404).json({ message: 'Client not found' });
        if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

        // Ensure this user is linked to this client
        const membership = await prisma.clientUser.findUnique({
            where: { clientId_userId: { clientId, userId } },
            include: { user: { select: { id: true, email: true, name: true, verified: true } } },
        });

        if (!membership) return res.status(404).json({ message: 'Client user not found' });

        const { firstName, lastName, password, emailMode, sendInviteLink, emailCredentials } = updateClientUserProfileSchema.parse(req.body || {});

        const resolvedSendInvite = Boolean(sendInviteLink) || emailMode === 'INVITE';
        const resolvedEmailCreds = Boolean(emailCredentials) || emailMode === 'CREDENTIALS';

        const nextName = `${String(firstName || '').trim()} ${String(lastName || '').trim()}`.trim();
        const updateUserData: any = {};
        if (nextName) updateUserData.name = nextName;
        if (password) updateUserData.passwordHash = await bcrypt.hash(password, 12);

        if (Object.keys(updateUserData).length > 0) {
            await prisma.user.update({
                where: { id: userId },
                data: updateUserData,
            });
        }

        // Optional email actions
        if (resolvedSendInvite) {
            const inviteToken = jwt.sign(
                { email: membership.user.email, clientId, kind: 'CLIENT_USER_INVITE' },
                getJwtSecret(),
                { expiresIn: '7d' }
            );

            await prisma.token.create({
                data: {
                    type: 'INVITE',
                    email: membership.user.email,
                    token: inviteToken,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    userId,
                    metadata: JSON.stringify({
                        kind: 'CLIENT_USER_INVITE',
                        clientId,
                        clientRole: membership.clientRole,
                        invitedByUserId: req.user.userId,
                    }),
                },
            });

            const acceptUrl = `${process.env.FRONTEND_URL}/invite?token=${encodeURIComponent(inviteToken)}`;
            await sendEmail({
                to: membership.user.email,
                subject: 'Design ME Dashboard has invited you to set up your Client Dashboard.',
                html: `
                  <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <h2>Design ME Dashboard has invited you to set up your Client Dashboard.</h2>
                    <p>Hi there,</p>
                    <p>You can complete your account activation below by clicking the link and finishing the registration.</p>
                    <p>
                      <a href="${acceptUrl}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">
                        Accept Invite
                      </a>
                    </p>
                    <p style="color:#6b7280;font-size:12px;">This invitation expires in 7 days.</p>
                  </div>
                `,
            });
        }

        if (resolvedEmailCreds) {
            if (!password) {
                return res.status(400).json({ message: 'Password is required to email credentials.' });
            }
            await sendEmail({
                to: membership.user.email,
                subject: 'Your Client Dashboard login details',
                html: `
                  <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <h2>Your Client Dashboard login details</h2>
                    <p>Hi ${nextName || membership.user.name || ''},</p>
                    <p>Here are your login credentials:</p>
                    <p><b>Email:</b> ${membership.user.email}</p>
                    <p><b>Password:</b> ${password}</p>
                    <p style="color:#6b7280;font-size:12px;">For security, please change your password after logging in.</p>
                  </div>
                `,
            });
        }

        return res.json({ message: 'Profile updated' });
    } catch (error: any) {
        if (error?.name === 'ZodError') {
            return res.status(400).json({ message: 'Invalid input', errors: error.errors });
        }
        console.error('Update client user profile error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// Resend invite email to a client user (for current client)
router.post('/:id/users/:userId/invite', authenticateToken, async (req, res) => {
    try {
        const clientId = String(req.params.id || '');
        const userId = String(req.params.userId || '');
        if (!clientId || !userId) return res.status(400).json({ message: 'Missing clientId or userId' });

        if (req.user.role === 'USER') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const { client, hasAccess } = await canStaffAccessClient(req.user, clientId);
        if (!client) return res.status(404).json({ message: 'Client not found' });
        if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

        const membership = await prisma.clientUser.findUnique({
            where: { clientId_userId: { clientId, userId } },
            include: { user: { select: { email: true } } },
        });
        if (!membership) return res.status(404).json({ message: 'Client user not found' });

        const inviteToken = jwt.sign(
            { email: membership.user.email, clientId, kind: 'CLIENT_USER_INVITE' },
            getJwtSecret(),
            { expiresIn: '7d' }
        );

        await prisma.token.create({
            data: {
                type: 'INVITE',
                email: membership.user.email,
                token: inviteToken,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                userId,
                metadata: JSON.stringify({
                    kind: 'CLIENT_USER_INVITE',
                    clientId,
                    clientRole: membership.clientRole,
                    invitedByUserId: req.user.userId,
                }),
            },
        });

        const acceptUrl = `${process.env.FRONTEND_URL}/invite?token=${encodeURIComponent(inviteToken)}`;
        await sendEmail({
            to: membership.user.email,
            subject: 'Design ME Dashboard has invited you to set up your Client Dashboard.',
            html: `
              <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                <h2>Design ME Dashboard has invited you to set up your Client Dashboard.</h2>
                <p>Hi there,</p>
                <p>You can complete your account activation below by clicking the link and finishing the registration.</p>
                <p>
                  <a href="${acceptUrl}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">
                    Accept Invite
                  </a>
                </p>
                <p style="color:#6b7280;font-size:12px;">This invitation expires in 7 days.</p>
              </div>
            `,
        });

        return res.json({ message: 'Invite sent' });
    } catch (error) {
        console.error('Resend invite error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// Remove a client user from a client (delete membership)
router.delete('/:id/users/:userId', authenticateToken, async (req, res) => {
    try {
        const clientId = String(req.params.id || '');
        const userId = String(req.params.userId || '');
        if (!clientId || !userId) return res.status(400).json({ message: 'Missing clientId or userId' });

        if (req.user.role === 'USER') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const { client, hasAccess } = await canStaffAccessClient(req.user, clientId);
        if (!client) return res.status(404).json({ message: 'Client not found' });
        if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

        await prisma.clientUser.delete({
            where: { clientId_userId: { clientId, userId } },
        });

        return res.json({ message: 'User removed' });
    } catch (error: any) {
        if (error?.code === 'P2025') {
            return res.status(404).json({ message: 'Client user not found' });
        }
        console.error('Remove client user error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// Impersonate a client user for a given client (Login as user)
router.post('/:id/users/:userId/impersonate', authenticateToken, async (req, res) => {
    try {
        const clientId = String(req.params.id || '');
        const userId = String(req.params.userId || '');
        if (!clientId || !userId) return res.status(400).json({ message: 'Missing clientId or userId' });

        if (req.user.role === 'USER') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const { client, hasAccess } = await canStaffAccessClient(req.user, clientId);
        if (!client) return res.status(404).json({ message: 'Client not found' });
        if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

        const membership = await prisma.clientUser.findUnique({
            where: { clientId_userId: { clientId, userId } },
            include: { user: { select: { id: true, email: true, role: true, verified: true } } },
        });
        if (!membership) return res.status(404).json({ message: 'Client user not found' });
        if (membership.user.role !== 'USER') return res.status(400).json({ message: 'Can only impersonate client portal users.' });

        const jwtToken = jwt.sign(
            { userId: membership.user.id, email: membership.user.email, role: membership.user.role },
            getJwtSecret(),
            { expiresIn: '7d' }
        );

        return res.json({ token: jwtToken, redirect: { clientId } });
    } catch (error) {
        console.error('Impersonate error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// Invite one or more client portal users
// Multi-client invite: invite user(s) to multiple clients with a single signup token
// IMPORTANT: must be defined before `/:id/users/invite` so it doesn't get captured by `:id = "users"`.
router.post('/users/invite', authenticateToken, async (req, res) => {
    try {
        if (req.user.role === 'USER') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const { invites, sendEmail: shouldSendEmail, clientRole } = inviteClientUsersMultiSchema.parse(req.body);

        const uniqueClientIds = Array.from(
            new Set(invites.flatMap((i) => (Array.isArray(i.clientIds) ? i.clientIds : [])).map((id) => String(id)))
        ).filter(Boolean);

        if (uniqueClientIds.length === 0) {
            return res.status(400).json({ message: 'Select at least 1 client.' });
        }

        // Validate staff access to all selected clients
        for (const cid of uniqueClientIds) {
            const { client, hasAccess } = await canStaffAccessClient(req.user, cid);
            if (!client) return res.status(404).json({ message: 'Client not found' });
            if (!hasAccess) return res.status(403).json({ message: 'Access denied' });
        }

        const clients = await prisma.client.findMany({
            where: { id: { in: uniqueClientIds } },
            select: { id: true, name: true },
        });

        const clientNameById = new Map(clients.map((c) => [c.id, c.name]));

        const results: Array<{ email: string; invited: boolean; userId?: string; token?: string }> = [];

        for (const inv of invites) {
            const email = String(inv.email || '').trim().toLowerCase();
            const clientIds = Array.from(new Set((inv.clientIds || []).map((c) => String(c).trim()).filter(Boolean)));
            if (!email || clientIds.length === 0) continue;

            // Create or find user
            const existing = await prisma.user.findUnique({ where: { email } });
            const user =
                existing ??
                (await prisma.user.create({
                    data: {
                        email,
                        role: 'USER',
                        invited: true,
                        verified: false,
                    },
                }));

            // Upsert memberships for all selected clients
            for (const clientId of clientIds) {
                await prisma.clientUser.upsert({
                    where: { clientId_userId: { clientId, userId: user.id } },
                    update: {
                        clientRole,
                        status: user.verified ? 'ACTIVE' : 'PENDING',
                        invitedById: req.user.userId,
                        invitedAt: new Date(),
                    },
                    create: {
                        clientId,
                        userId: user.id,
                        clientRole,
                        status: user.verified ? 'ACTIVE' : 'PENDING',
                        invitedById: req.user.userId,
                        invitedAt: new Date(),
                    },
                });
            }

            // Create invite token that includes all clientIds
            const inviteToken = jwt.sign(
                { email, clientIds, kind: 'CLIENT_USER_INVITE' },
                getJwtSecret(),
                { expiresIn: '7d' }
            );

            await prisma.token.create({
                data: {
                    type: 'INVITE',
                    email,
                    token: inviteToken,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    userId: user.id,
                    metadata: JSON.stringify({
                        kind: 'CLIENT_USER_INVITE',
                        clientIds,
                        clientRole,
                        invitedByUserId: req.user.userId,
                    }),
                },
            });

            if (shouldSendEmail) {
                const acceptUrl = `${process.env.FRONTEND_URL}/invite?token=${encodeURIComponent(inviteToken)}`;
                const listHtml = clientIds
                    .map((cid) => `<li>${clientNameById.get(cid) || cid}</li>`)
                    .join('');
                await sendEmail({
                    to: email,
                    subject: 'Design ME Dashboard has invited you to set up your Client Dashboard.',
                    html: `
                      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                        <h2>Design ME Dashboard has invited you to set up your Client Dashboard.</h2>
                        <p>Hi there,</p>
                        <p>You will be granted access to these client dashboards:</p>
                        <ul>${listHtml}</ul>
                        <p>You can complete your account activation below by clicking the link and finishing the registration.</p>
                        <p>
                          <a href="${acceptUrl}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">
                            Accept Invite
                          </a>
                        </p>
                        <p style="color:#6b7280;font-size:12px;">This invitation expires in 7 days.</p>
                      </div>
                    `,
                });
            }

            results.push({ email, invited: true, userId: user.id, token: shouldSendEmail ? undefined : inviteToken });
        }

        return res.status(201).json({ message: 'Invites created', results });
    } catch (error: any) {
        if (error?.name === 'ZodError') {
            return res.status(400).json({ message: 'Invalid input', errors: error.errors });
        }
        console.error('Invite multi client users error:', error);
        return res.status(500).json({ message: 'Failed to invite users' });
    }
});

router.post('/:id/users/invite', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;
        if (req.user.role === 'USER') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const { client, hasAccess } = await canStaffAccessClient(req.user, clientId);
        if (!client) return res.status(404).json({ message: 'Client not found' });
        if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

        const { emails, sendEmail: shouldSendEmail, clientRole } = inviteClientUsersSchema.parse(req.body);

        const results: Array<{ email: string; invited: boolean; userId?: string; token?: string }> = [];

        for (const emailRaw of emails) {
            const email = String(emailRaw).trim().toLowerCase();
            if (!email) continue;

            // Create or find user
            const existing = await prisma.user.findUnique({ where: { email } });
            const user =
                existing ??
                (await prisma.user.create({
                    data: {
                        email,
                        role: 'USER',
                        invited: true,
                        verified: false,
                    },
                }));

            // Upsert membership
            await prisma.clientUser.upsert({
                where: { clientId_userId: { clientId, userId: user.id } },
                update: {
                    clientRole,
                    status: user.verified ? 'ACTIVE' : 'PENDING',
                    invitedById: req.user.userId,
                    invitedAt: new Date(),
                },
                create: {
                    clientId,
                    userId: user.id,
                    clientRole,
                    status: user.verified ? 'ACTIVE' : 'PENDING',
                    invitedById: req.user.userId,
                    invitedAt: new Date(),
                },
            });

            // Create invite token (even if user exists; token will just lead them to portal signup/login)
            const inviteToken = jwt.sign(
                { email, clientId, kind: 'CLIENT_USER_INVITE' },
                getJwtSecret(),
                { expiresIn: '7d' }
            );

            await prisma.token.create({
                data: {
                    type: 'INVITE',
                    email,
                    token: inviteToken,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    userId: user.id,
                    metadata: JSON.stringify({
                        kind: 'CLIENT_USER_INVITE',
                        clientId,
                        clientRole,
                        invitedByUserId: req.user.userId,
                    }),
                },
            });

            if (shouldSendEmail) {
                const acceptUrl = `${process.env.FRONTEND_URL}/invite?token=${encodeURIComponent(inviteToken)}`;
                await sendEmail({
                    to: email,
                    subject: 'Design ME Dashboard has invited you to set up your Client Dashboard.',
                    html: `
                      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                        <h2>Design ME Dashboard has invited you to set up your Client Dashboard.</h2>
                        <p>Hi there,</p>
                        <p>You can complete your account activation below by clicking the link and finishing the registration.</p>
                        <p>
                          <a href="${acceptUrl}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">
                            Accept Invite
                          </a>
                        </p>
                        <p style="color:#6b7280;font-size:12px;">This invitation expires in 7 days.</p>
                      </div>
                    `,
                });
            }

            results.push({ email, invited: true, userId: user.id, token: shouldSendEmail ? undefined : inviteToken });
        }

        return res.status(201).json({ message: 'Invites created', results });
    } catch (error: any) {
        if (error?.name === 'ZodError') {
            return res.status(400).json({ message: 'Invalid input', errors: error.errors });
        }
        console.error('Invite client users error:', error);
        return res.status(500).json({ message: 'Failed to invite users' });
    }
});

// Create a client
router.post('/', authenticateToken, async (req, res) => {
    try {
        if (req.user.role === 'USER') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const tierCtx = await getAgencyTierContext(req.user.userId, req.user.role);
        const dashboardCheck = canAddDashboard(tierCtx);
        if (!dashboardCheck.allowed) {
            return res.status(403).json({
                message: dashboardCheck.message,
                code: 'TIER_LIMIT',
                limitType: 'dashboards',
            });
        }

        const { name, domain, industry, targets, loginUrl, username, password, accountInfo } = createClientSchema.parse(req.body);

        // Normalize domain (strip protocol/www/path)
        const normalizedDomain = normalizeDomainInput(domain);

        // Check if client with this domain or name already exists
        const existingDomain = await prisma.client.findUnique({
            where: { domain: normalizedDomain },
        });

        if (existingDomain) {
            return res.status(400).json({ message: 'Client with this domain already exists' });
        }

        const existingName = await prisma.client.findUnique({
            where: { name },
        });

        if (existingName) {
            return res.status(400).json({ message: 'Client with this name already exists' });
        }

        // Status lifecycle: Agency creates dashboard → DASHBOARD_ONLY. SUPER_ADMIN creates → ACTIVE.
        const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
        const canEditRestricted = req.user.role === 'SUPER_ADMIN' || req.user.role === 'SPECIALIST';
        const clientStatus = isSuperAdmin ? 'ACTIVE' : 'DASHBOARD_ONLY';

        const safeAccountInfo = sanitizeAccountInfo(accountInfo, canEditRestricted, isSuperAdmin);

        // Create client
        const client = await prisma.client.create({
            data: {
                name,
                domain: normalizedDomain,
                industry,
                targets: Array.isArray(targets) ? JSON.stringify(targets) : null,
                loginUrl: loginUrl || null,
                username: username || null,
                password: password || null,
                accountInfo: safeAccountInfo ? JSON.stringify(safeAccountInfo) : null,
                status: clientStatus,
                userId: req.user.userId,
            },
            include: {
                user: {
                    select: { id: true, name: true, email: true },
                },
            },
        });

        res.status(201).json(client);
    } catch (error: any) {
        if (error?.message?.includes('Invalid domain')) {
            return res.status(400).json({ message: error.message });
        }
        if (error.name === 'ZodError') {
            return res.status(400).json({ message: 'Invalid input', errors: error.errors });
        }
        // Handle Prisma unique constraint errors
        if (error.code === 'P2002') {
            const field = error.meta?.target?.[0];
            return res.status(400).json({ 
                message: `Client with this ${field} already exists`,
                field 
            });
        }
        console.error('Create client error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update a client
router.put('/:id', authenticateToken, async (req, res) => {
    const clientId = req.params.id;
    const { name, domain, status, industry, targets, loginUrl, username, password, accountInfo, vendasta, canceledEndDate } = req.body.data || req.body;

    try {
        if (req.user.role === 'USER') {
            return res.status(403).json({ message: 'Access denied' });
        }
        // Check if client exists and user has access
        const existing = await prisma.client.findUnique({
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

        if (!existing) {
            return res.status(404).json({ message: 'Client not found' });
        }

        // Check access: user must own the client or be ADMIN/SUPER_ADMIN
        const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
        const isOwner = existing.userId === req.user.userId;

        // For non-admin users, check if they're in the same agency
        let hasAccess = isAdmin || isOwner;
        if (!hasAccess && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
            const userMemberships = await prisma.userAgency.findMany({
                where: { userId: req.user.userId },
                select: { agencyId: true },
            });
            const userAgencyIds = userMemberships.map(m => m.agencyId);
            const clientAgencyIds = existing.user.memberships.map(m => m.agencyId);
            hasAccess = clientAgencyIds.some(id => userAgencyIds.includes(id));
        }

        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Build update data
        const updateData: any = {};
        if (name) updateData.name = name;
        if (domain) {
            updateData.domain = normalizeDomainInput(domain);
        }
        if (industry !== undefined) updateData.industry = industry;
        if (targets !== undefined) {
            updateData.targets = Array.isArray(targets) ? JSON.stringify(targets) : null;
        }
        if (loginUrl !== undefined) updateData.loginUrl = loginUrl || null;
        if (username !== undefined) updateData.username = username || null;
        if (password !== undefined) updateData.password = password || null;

        // accountInfo merge (do not allow non-super-admin/specialist to modify SEO roadmap fields; super-admin-only keys only for SUPER_ADMIN)
        if (accountInfo !== undefined) {
            const canEditRestricted = req.user.role === 'SUPER_ADMIN' || req.user.role === 'SPECIALIST';
            const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
            const incoming = sanitizeAccountInfo(accountInfo, canEditRestricted, isSuperAdmin);
            if (incoming === null) {
                updateData.accountInfo = null;
            } else {
                const existingObj = parseAccountInfoString((existing as any).accountInfo) || {};
                updateData.accountInfo = JSON.stringify({ ...existingObj, ...incoming });
            }
        }

        // Restrict: only ADMIN / SUPER_ADMIN can update status
        if (status) {
            if (isAdmin) {
                updateData.status = status;
            } else {
                return res.status(403).json({ message: 'Not allowed to update status' });
            }
        }
        if (canceledEndDate !== undefined) {
            if (isAdmin) {
                updateData.canceledEndDate = canceledEndDate ? new Date(canceledEndDate) : null;
            }
        }

        // Allow updating vendasta field (only ADMIN / SUPER_ADMIN)
        if (vendasta !== undefined) {
            if (isAdmin) {
                // Handle boolean conversion: accept true, false, 'true', 'false', 1, 0
                if (typeof vendasta === 'boolean') {
                    updateData.vendasta = vendasta;
                } else if (vendasta === 'true' || vendasta === true || vendasta === 1 || vendasta === '1') {
                    updateData.vendasta = true;
                } else if (vendasta === 'false' || vendasta === false || vendasta === 0 || vendasta === '0') {
                    updateData.vendasta = false;
                } else {
                    updateData.vendasta = Boolean(vendasta);
                }
            } else {
                return res.status(403).json({ message: 'Not allowed to update vendasta status' });
            }
        }

        const updated = await prisma.client.update({
            where: { id: clientId },
            data: updateData,
            include: {
                user: {
                    select: { id: true, name: true, email: true },
                },
            },
        });

        // Notify agency when a pending client is approved (ACTIVE) or rejected (DASHBOARD_ONLY)
        const wasPending = existing.status === 'PENDING';
        const newStatus = updateData.status;
        const isApproved = newStatus === 'ACTIVE';
        const isRejected = isApproved ? false : newStatus === 'DASHBOARD_ONLY';
        if (wasPending && (isApproved || isRejected)) {
            const agencyIds = (existing.user as { memberships?: { agencyId: string }[] }).memberships?.map(m => m.agencyId) ?? [];
            if (agencyIds.length > 0) {
                const members = await prisma.userAgency.findMany({
                    where: { agencyId: { in: agencyIds } },
                    select: { user: { select: { email: true, name: true } } },
                    distinct: ['userId'],
                });
                const clientName = updated.name || updated.domain || 'Client';
                const subject = isApproved
                    ? `Client approved: ${clientName}`
                    : `Client request set to Dashboard Only: ${clientName}`;
                const message = isApproved
                    ? `The client "${clientName}" has been approved and activated. You can now provide managed services.`
                    : `The client request for "${clientName}" has been set to Dashboard Only (reporting only, no managed services).`;
                const seen = new Set<string>();
                for (const m of members) {
                    const email = m.user?.email;
                    if (email && !seen.has(email)) {
                        seen.add(email);
                        const html = `<!DOCTYPE html><html><body><p>${message}</p><p>— Your SEO Dashboard</p></body></html>`;
                        sendEmail({ to: email, subject, html }).catch(err => console.error('Notify agency email failed:', err));
                    }
                }
            }
        }

        res.json(updated);
    } catch (error: any) {
        console.error('Update client error:', error);
        // Provide more detailed error information
        const errorMessage = error?.message || 'Internal server error';
        const errorCode = error?.code || 'UNKNOWN';
        console.error('Error details:', { errorMessage, errorCode, stack: error?.stack });
        
        // Check if it's a database column error (migration not run)
        if (errorMessage.includes('vendasta') || errorMessage.includes('Unknown column')) {
            return res.status(500).json({ 
                message: 'Database schema error. Please run migrations: npx prisma migrate deploy',
                details: errorMessage 
            });
        }
        
        res.status(500).json({ message: 'Internal server error', details: errorMessage });
    }
});

// Delete a client
router.delete('/:id', authenticateToken, async (req, res) => {
    const clientId = req.params.id;

    try {
        if (req.user.role === 'USER') {
            return res.status(403).json({ message: 'Access denied' });
        }
        // Check if client exists and user has access
        const existing = await prisma.client.findUnique({
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

        if (!existing) {
            return res.status(404).json({ message: 'Client not found' });
        }

        // Check access: user must own the client or be ADMIN/SUPER_ADMIN
        const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
        const isOwner = existing.userId === req.user.userId;

        if (!isAdmin && !isOwner) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Delete client (cascade will handle related data)
        await prisma.client.delete({
            where: { id: clientId },
        });

        res.json({ message: 'Client deleted successfully' });
    } catch (error) {
        console.error('Delete client error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Suspend client dashboard (agency or SUPER_ADMIN). Agency can suspend their own clients when client doesn't pay; dashboard is frozen until reactivated.
router.patch('/:id/suspend', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;
        if (req.user.role === 'USER') return res.status(403).json({ message: 'Access denied' });

        const client = await prisma.client.findUnique({
            where: { id: clientId },
            include: { user: { select: { memberships: { select: { agencyId: true } } } } },
        });
        if (!client) return res.status(404).json({ message: 'Client not found' });

        const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
        const agencyIds = (client.user as any).memberships?.map((m: { agencyId: string }) => m.agencyId) ?? [];
        let canSuspend = isSuperAdmin;
        if (!canSuspend && (req.user.role === 'AGENCY' || req.user.role === 'ADMIN')) {
            const membership = await prisma.userAgency.findFirst({ where: { userId: req.user.userId }, select: { agencyId: true } });
            canSuspend = membership && agencyIds.includes(membership.agencyId);
        }
        if (!canSuspend) return res.status(403).json({ message: 'You can only suspend clients that belong to your agency' });

        if (client.status === 'SUSPENDED') {
            return res.status(400).json({ message: 'Client is already suspended' });
        }

        await prisma.client.update({
            where: { id: clientId },
            data: { status: 'SUSPENDED', managedServiceStatus: 'suspended' },
        });
        res.json({ success: true, message: 'Client dashboard suspended' });
    } catch (error: any) {
        console.error('Suspend client error:', error);
        res.status(500).json({ message: error?.message || 'Internal server error' });
    }
});

// Reactivate client dashboard (agency or SUPER_ADMIN).
router.patch('/:id/reactivate', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;
        if (req.user.role === 'USER') return res.status(403).json({ message: 'Access denied' });

        const client = await prisma.client.findUnique({
            where: { id: clientId },
            include: { user: { select: { memberships: { select: { agencyId: true } } } } },
        });
        if (!client) return res.status(404).json({ message: 'Client not found' });

        const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
        const agencyIds = (client.user as any).memberships?.map((m: { agencyId: string }) => m.agencyId) ?? [];
        let canReactivate = isSuperAdmin;
        if (!canReactivate && (req.user.role === 'AGENCY' || req.user.role === 'ADMIN')) {
            const membership = await prisma.userAgency.findFirst({ where: { userId: req.user.userId }, select: { agencyId: true } });
            canReactivate = membership && agencyIds.includes(membership.agencyId);
        }
        if (!canReactivate) return res.status(403).json({ message: 'You can only reactivate clients that belong to your agency' });

        if (client.status !== 'SUSPENDED') {
            return res.status(400).json({ message: 'Client is not suspended' });
        }

        await prisma.client.update({
            where: { id: clientId },
            data: { status: 'ACTIVE', managedServiceStatus: 'active' },
        });
        res.json({ success: true, message: 'Client dashboard reactivated' });
    } catch (error: any) {
        console.error('Reactivate client error:', error);
        res.status(500).json({ message: error?.message || 'Internal server error' });
    }
});

// GA4 Connection Routes
import { getGA4AuthUrl, exchangeCodeForTokens, isGA4Connected, listGA4Properties } from '../lib/ga4.js';
// Google Ads Connection Routes
import { getGoogleAdsAuthUrl, exchangeCodeForTokens as exchangeGoogleAdsCodeForTokens, isGoogleAdsConnected, listGoogleAdsCustomers, listGoogleAdsClientAccounts, listChildAccountsUnderManager, fetchGoogleAdsCampaigns, fetchGoogleAdsAdGroups, fetchGoogleAdsKeywords, fetchGoogleAdsConversions } from '../lib/googleAds.js';

// GA4 OAuth callback (no auth required - handled via state parameter)
router.get('/ga4/callback', async (req, res) => {
    try {
        const { code, state, error } = req.query;

        // Parse state: can be "clientId" or "clientId|popup"
        let clientId = '';
        let isPopup = false;
        if (state) {
            const stateParts = (state as string).split('|');
            clientId = stateParts[0];
            isPopup = stateParts[1] === 'popup';
        }
        // Fallback checks for popup detection
        if (!isPopup) {
            const fromQuery = req.query.popup === 'true';
            const fromReferer = !!req.headers.referer?.includes('popup=true');
            isPopup = fromQuery || fromReferer;
        }

        if (error) {
            console.error('[GA4 OAuth Callback] Error from Google:', {
                error,
                errorDescription: req.query.error_description,
                state,
                clientId,
            });
            
            let errorMessage = error as string;
            let errorDescription = req.query.error_description as string || '';
            
            // Provide helpful error messages for common issues
            if (error === 'access_denied') {
                errorMessage = 'Access was denied. Please grant the required permissions.';
            } else if (error === 'invalid_request') {
                errorMessage = 'Invalid request. Please check your OAuth configuration.';
            } else if (errorDescription.includes('403')) {
                errorMessage = '403 Forbidden: Your account may not have access, or the OAuth app may need to be published. See OAUTH_FIX_GUIDE.md for help.';
            }
            
            if (isPopup) {
                // Return HTML page that closes popup and sends error message to parent
                return res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>GA4 Connection</title>
                        <style>
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                height: 100vh;
                                margin: 0;
                                background: #f5f5f5;
                            }
                            .container {
                                text-align: center;
                                padding: 2rem;
                                max-width: 500px;
                            }
                            .error {
                                color: #ef4444;
                                font-size: 1.1rem;
                                margin-bottom: 1rem;
                            }
                            .description {
                                color: #666;
                                font-size: 0.9rem;
                                margin-top: 0.5rem;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="error">Connection failed: ${errorMessage}</div>
                            ${errorDescription ? `<div class="description">${errorDescription}</div>` : ''}
                        </div>
                        <script>
                            if (window.opener) {
                                window.opener.postMessage({
                                    type: 'GA4_OAUTH_ERROR',
                                    error: '${error}',
                                    errorDescription: '${errorDescription}'
                                }, '*');
                                setTimeout(() => window.close(), 3000);
                            } else {
                                window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients?ga4_error=${encodeURIComponent(errorMessage)}';
                            }
                        </script>
                    </body>
                    </html>
                `);
            }
            return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients?ga4_error=${encodeURIComponent(errorMessage)}`);
        }

        if (!code || !state) {
            if (isPopup) {
                return res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>GA4 Connection</title>
                        <style>
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                height: 100vh;
                                margin: 0;
                                background: #f5f5f5;
                            }
                            .container {
                                text-align: center;
                                padding: 2rem;
                            }
                            .error {
                                color: #ef4444;
                                font-size: 1.1rem;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="error">Missing authorization parameters</div>
                        </div>
                        <script>
                            if (window.opener) {
                                window.opener.postMessage({
                                    type: 'GA4_OAUTH_ERROR',
                                    error: 'missing_params'
                                }, '*');
                                setTimeout(() => window.close(), 2000);
                            } else {
                                window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients?ga4_error=missing_params';
                            }
                        </script>
                    </body>
                    </html>
                `);
            }
            return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients?ga4_error=missing_params`);
        }

        // Exchange code for tokens (clientId already parsed above)
        const { accessToken, refreshToken, email } = await exchangeCodeForTokens(code as string);

        // Store tokens (property ID will be set separately via the connect endpoint)
        await prisma.client.update({
            where: { id: clientId },
            data: {
                ga4AccessToken: accessToken,
                ga4RefreshToken: refreshToken,
                ga4AccountEmail: email,
                // Don't set propertyId or connectedAt yet - user needs to select property
            },
        });

        // If popup, return HTML that closes popup and sends success message to parent
        if (isPopup) {
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>GA4 Connection</title>
                    <style>
                        body {
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            margin: 0;
                            background: #f5f5f5;
                        }
                        .container {
                            text-align: center;
                            padding: 2rem;
                        }
                        .success {
                            color: #10b981;
                            font-size: 1.1rem;
                            margin-bottom: 1rem;
                        }
                        .spinner {
                            border: 3px solid #f3f4f6;
                            border-top: 3px solid #10b981;
                            border-radius: 50%;
                            width: 30px;
                            height: 30px;
                            animation: spin 1s linear infinite;
                            margin: 1rem auto;
                        }
                        @keyframes spin {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="success">✓ Successfully connected!</div>
                        <div class="spinner"></div>
                        <div>Closing window...</div>
                    </div>
                    <script>
                        if (window.opener) {
                            window.opener.postMessage({
                                type: 'GA4_OAUTH_SUCCESS',
                                clientId: '${clientId}'
                            }, '*');
                            setTimeout(() => window.close(), 1000);
                        } else {
                            window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients/${clientId}?ga4_tokens_received=true';
                        }
                    </script>
                </body>
                </html>
            `);
        }

        // Redirect to client page with token stored, user can now select property
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients/${clientId}?ga4_tokens_received=true`);
    } catch (error: any) {
        console.error('GA4 callback error:', error);
        const isPopup = req.query.popup === 'true' || req.headers.referer?.includes('popup=true');
        
        if (isPopup) {
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>GA4 Connection</title>
                    <style>
                        body {
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            margin: 0;
                            background: #f5f5f5;
                        }
                        .container {
                            text-align: center;
                            padding: 2rem;
                        }
                        .error {
                            color: #ef4444;
                            font-size: 1.1rem;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="error">Connection failed: ${error.message || 'Unknown error'}</div>
                    </div>
                    <script>
                        if (window.opener) {
                            window.opener.postMessage({
                                type: 'GA4_OAUTH_ERROR',
                                error: '${error.message || 'connection_failed'}'
                            }, '*');
                            setTimeout(() => window.close(), 2000);
                        } else {
                            window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients?ga4_error=${encodeURIComponent(error.message || 'connection_failed')}';
                        }
                    </script>
                </body>
                </html>
            `);
        }
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients?ga4_error=${encodeURIComponent(error.message || 'connection_failed')}`);
    }
});

// Get GA4 connection status
router.get('/:id/ga4/status', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;

        // Check access
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

        const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
        const isOwner = client.userId === req.user.userId;
        const userMemberships = await prisma.userAgency.findMany({
            where: { userId: req.user.userId },
            select: { agencyId: true },
        });
        const userAgencyIds = userMemberships.map(m => m.agencyId);
        const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
        let hasAccess = isAdmin || isOwner || clientAgencyIds.some(id => userAgencyIds.includes(id));
        if (!hasAccess) {
            const cu = await prisma.clientUser.findFirst({
                where: { clientId, userId: req.user.userId, status: 'ACTIVE' },
                select: { id: true },
            });
            hasAccess = Boolean(cu);
        }

        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const connected = await isGA4Connected(clientId);
        const clientData = await prisma.client.findUnique({
            where: { id: clientId },
            select: {
                ga4PropertyId: true,
                ga4AccountEmail: true,
                ga4ConnectedAt: true,
                ga4RefreshToken: true,
            },
        });

        res.json({
            connected,
            hasTokens: !!(clientData?.ga4RefreshToken),
            propertyId: clientData?.ga4PropertyId || null,
            accountEmail: clientData?.ga4AccountEmail || null,
            connectedAt: clientData?.ga4ConnectedAt || null,
        });
    } catch (error) {
        console.error('GA4 status error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get GA4 authorization URL
router.get('/:id/ga4/auth-url', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;
        const isPopup = req.query.popup === 'true';

        // Check access
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

        const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
        const isOwner = client.userId === req.user.userId;
        const userMemberships = await prisma.userAgency.findMany({
            where: { userId: req.user.userId },
            select: { agencyId: true },
        });
        const userAgencyIds = userMemberships.map(m => m.agencyId);
        const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
        let hasAccess = isAdmin || isOwner || clientAgencyIds.some(id => userAgencyIds.includes(id));
        if (!hasAccess) {
            const cu = await prisma.clientUser.findFirst({
                where: { clientId, userId: req.user.userId, status: 'ACTIVE' },
                select: { id: true },
            });
            hasAccess = Boolean(cu);
        }

        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Encode popup flag in state parameter: "clientId|popup" or just "clientId"
        const state = isPopup ? `${clientId}|popup` : clientId;
        const authUrl = getGA4AuthUrl(state);
        res.json({ authUrl });
    } catch (error: any) {
        console.error('GA4 auth URL error:', error);
        // Provide helpful error message for common issues
        let errorMessage = error.message || 'Internal server error';
        if (error.message?.includes('not configured')) {
            errorMessage = 'GA4 OAuth credentials not configured. Please set GA4_CLIENT_ID and GA4_CLIENT_SECRET in server/.env file. See FIX_OAUTH_ERROR.md for instructions.';
        }
        res.status(500).json({ message: errorMessage });
    }
});

// List GA4 properties (after OAuth callback, before connecting)
router.get('/:id/ga4/properties', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;

        // Check access
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

        const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
        const isOwner = client.userId === req.user.userId;
        const userMemberships = await prisma.userAgency.findMany({
            where: { userId: req.user.userId },
            select: { agencyId: true },
        });
        const userAgencyIds = userMemberships.map(m => m.agencyId);
        const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
        let hasAccess = isAdmin || isOwner || clientAgencyIds.some(id => userAgencyIds.includes(id));
        if (!hasAccess) {
            const cu = await prisma.clientUser.findFirst({
                where: { clientId, userId: req.user.userId, status: 'ACTIVE' },
                select: { id: true },
            });
            hasAccess = Boolean(cu);
        }

        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Check if tokens exist (from OAuth callback)
        const existingClient = await prisma.client.findUnique({
            where: { id: clientId },
            select: { ga4AccessToken: true, ga4RefreshToken: true },
        });

        if (!existingClient?.ga4AccessToken || !existingClient?.ga4RefreshToken) {
            return res.status(400).json({ message: 'Please complete OAuth flow first by clicking "Connect GA4"' });
        }

        // List all GA4 properties - force refresh if requested via query param
        const forceRefresh = req.query.forceRefresh === 'true' || req.query.refresh === 'true';
        const properties = await listGA4Properties(clientId, forceRefresh);
        res.json({ properties });
    } catch (error: any) {
        console.error('GA4 properties list error:', error);
        res.status(500).json({ message: error.message || 'Internal server error' });
    }
});

// Get GA4 traffic data (dedicated endpoint for fetching GA4 data)
router.get('/:id/ga4/traffic', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;
        const { start, end, period } = req.query;

        // Check access
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

        const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
        const isOwner = client.userId === req.user.userId;
        const userMemberships = await prisma.userAgency.findMany({
            where: { userId: req.user.userId },
            select: { agencyId: true },
        });
        const userAgencyIds = userMemberships.map(m => m.agencyId);
        const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
        let hasAccess = isAdmin || isOwner || clientAgencyIds.some(id => userAgencyIds.includes(id));
        if (!hasAccess) {
            const cu = await prisma.clientUser.findFirst({
                where: { clientId, userId: req.user.userId, status: 'ACTIVE' },
                select: { id: true },
            });
            hasAccess = Boolean(cu);
        }

        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Check if GA4 is connected
        if (!client.ga4RefreshToken || !client.ga4PropertyId || !client.ga4ConnectedAt) {
            return res.status(400).json({ 
                message: 'GA4 is not connected for this client',
                connected: false 
            });
        }

        // Calculate date range
        let startDate: Date;
        let endDate: Date = new Date();

        if (start && end) {
            // Use provided dates
            startDate = new Date(start as string);
            endDate = new Date(end as string);
        } else if (period) {
            // Use period (number of days)
            const days = parseInt(period as string, 10);
            startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
        } else {
            // Default to last 30 days
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);
        }

        // Fetch GA4 data
        const { fetchGA4TrafficData } = await import('../lib/ga4.js');
        const data = await fetchGA4TrafficData(clientId, startDate, endDate);

        res.json({
            success: true,
            data,
            dateRange: {
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0],
            },
            propertyId: client.ga4PropertyId,
        });
    } catch (error: any) {
        console.error('GA4 traffic fetch error:', error);
        res.status(500).json({ 
            success: false,
            message: error.message || 'Failed to fetch GA4 traffic data',
            error: error.message 
        });
    }
});

// Connect GA4 with property ID (after OAuth callback)
router.post('/:id/ga4/connect', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;
        const { propertyId } = req.body;

        if (!propertyId) {
            return res.status(400).json({ message: 'Property ID is required. Format: properties/123456789' });
        }

        // Check access
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

        const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
        const isOwner = client.userId === req.user.userId;
        const userMemberships = await prisma.userAgency.findMany({
            where: { userId: req.user.userId },
            select: { agencyId: true },
        });
        const userAgencyIds = userMemberships.map(m => m.agencyId);
        const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
        let hasAccess = isAdmin || isOwner || clientAgencyIds.some(id => userAgencyIds.includes(id));
        if (!hasAccess) {
            const cu = await prisma.clientUser.findFirst({
                where: { clientId, userId: req.user.userId, status: 'ACTIVE' },
                select: { id: true },
            });
            hasAccess = Boolean(cu);
        }

        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Check if tokens exist (from OAuth callback)
        const existingClient = await prisma.client.findUnique({
            where: { id: clientId },
            select: { ga4AccessToken: true, ga4RefreshToken: true },
        });

        if (!existingClient?.ga4AccessToken || !existingClient?.ga4RefreshToken) {
            return res.status(400).json({ message: 'Please complete OAuth flow first by clicking "Connect GA4"' });
        }

        // Normalize property ID (remove 'properties/' prefix if present, we'll add it in the API call)
        const normalizedPropertyId = propertyId.replace(/^properties\//, '');

        // Update client with property ID
        await prisma.client.update({
            where: { id: clientId },
            data: {
                ga4PropertyId: normalizedPropertyId,
                ga4ConnectedAt: new Date(),
            },
        });

        // Auto-fetch GA4 data immediately after connection and save to DB
        // Wait for data to be fetched and saved before responding
        try {
            const { fetchGA4TrafficData, fetchGA4EventsData, saveGA4MetricsToDB } = await import('../lib/ga4.js');
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30); // Last 30 days for initial fetch
            
            // Fetch data and save to database
            Promise.all([
                fetchGA4TrafficData(clientId, startDate, endDate),
                fetchGA4EventsData(clientId, startDate, endDate)
            ]).then(async ([trafficData, eventsData]) => {
                // Save to database
                await saveGA4MetricsToDB(clientId, startDate, endDate, trafficData, eventsData);
                console.log(`GA4 connection verified - auto-fetched and saved data for client ${clientId}`);
            }).catch(err => {
                console.warn('GA4 auto-fetch/save failed:', err.message);
            });
        } catch (testError: any) {
            console.warn('GA4 auto-fetch failed (non-critical):', testError.message);
            // Don't fail the connection if auto-fetch fails
        }

        res.json({ 
            message: 'GA4 connected successfully',
            propertyId: normalizedPropertyId,
        });
    } catch (error: any) {
        console.error('GA4 connect error:', error);
        res.status(500).json({ message: error.message || 'Internal server error' });
    }
});

// Test GA4 connection and data fetch with detailed diagnostics
router.get('/:id/ga4/test', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;

        // Check access
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

        const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
        const isOwner = client.userId === req.user.userId;
        const userMemberships = await prisma.userAgency.findMany({
            where: { userId: req.user.userId },
            select: { agencyId: true },
        });
        const userAgencyIds = userMemberships.map(m => m.agencyId);
        const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
        let hasAccess = isAdmin || isOwner || clientAgencyIds.some(id => userAgencyIds.includes(id));
        if (!hasAccess) {
            const cu = await prisma.clientUser.findFirst({
                where: { clientId, userId: req.user.userId, status: 'ACTIVE' },
                select: { id: true },
            });
            hasAccess = Boolean(cu);
        }

        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Check connection status
        const isConnected = !!(
            client.ga4RefreshToken &&
            client.ga4PropertyId &&
            client.ga4ConnectedAt
        );

        if (!isConnected) {
            return res.json({
                connected: false,
                message: 'GA4 is not connected',
                details: {
                    hasRefreshToken: !!client.ga4RefreshToken,
                    hasPropertyId: !!client.ga4PropertyId,
                    hasConnectedAt: !!client.ga4ConnectedAt,
                },
            });
        }

        // Try to fetch data
        try {
            const { fetchGA4TrafficData } = await import('../lib/ga4.js');
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 7); // Last 7 days

            const data = await fetchGA4TrafficData(clientId, startDate, endDate);
            
            return res.json({
                connected: true,
                message: 'GA4 connection is working',
                propertyId: client.ga4PropertyId,
                dateRange: {
                    start: startDate.toISOString().split('T')[0],
                    end: endDate.toISOString().split('T')[0],
                },
                data: {
                    activeUsers: data.activeUsers,
                    newUsers: data.newUsers,
                    eventCount: data.eventCount,
                    keyEvents: data.keyEvents,
                    totalSessions: data.totalSessions,
                    organicSessions: data.organicSessions,
                    hasTrendData: data.newUsersTrend.length > 0 || data.activeUsersTrend.length > 0,
                    trendDataPoints: {
                        newUsers: data.newUsersTrend.length,
                        activeUsers: data.activeUsersTrend.length,
                    },
                },
                diagnostics: {
                    hasData: !!(data.activeUsers || data.newUsers || data.eventCount || data.totalSessions),
                    allMetricsZero: (
                        data.activeUsers === 0 &&
                        data.newUsers === 0 &&
                        data.eventCount === 0 &&
                        data.totalSessions === 0
                    ),
                    possibleIssues: (
                        data.activeUsers === 0 &&
                        data.newUsers === 0 &&
                        data.eventCount === 0 &&
                        data.totalSessions === 0
                    ) ? [
                        'No data exists for this date range in GA4',
                        'Property may not have received any traffic',
                        'Date range might be too recent (GA4 data can take 24-48 hours)',
                        'Check if GA4 property is receiving data in Google Analytics dashboard',
                    ] : [],
                },
            });
        } catch (error: any) {
            return res.status(500).json({
                connected: true,
                message: 'GA4 is connected but data fetch failed',
                error: error.message,
                propertyId: client.ga4PropertyId,
            });
        }
    } catch (error: any) {
        console.error('GA4 test error:', error);
        res.status(500).json({ message: error.message || 'Internal server error' });
    }
});

// Disconnect GA4
router.post('/:id/ga4/disconnect', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;

        // Check access
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

        const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
        const isOwner = client.userId === req.user.userId;
        const userMemberships = await prisma.userAgency.findMany({
            where: { userId: req.user.userId },
            select: { agencyId: true },
        });
        const userAgencyIds = userMemberships.map(m => m.agencyId);
        const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
        let hasAccess = isAdmin || isOwner || clientAgencyIds.some(id => userAgencyIds.includes(id));
        if (!hasAccess) {
            const cu = await prisma.clientUser.findFirst({
                where: { clientId, userId: req.user.userId, status: 'ACTIVE' },
                select: { id: true },
            });
            hasAccess = Boolean(cu);
        }

        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Remove GA4 connection
        await prisma.client.update({
            where: { id: clientId },
            data: {
                ga4AccessToken: null,
                ga4RefreshToken: null,
                ga4PropertyId: null,
                ga4AccountEmail: null,
                ga4ConnectedAt: null,
            },
        });

        res.json({ message: 'GA4 disconnected successfully' });
    } catch (error) {
        console.error('GA4 disconnect error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ============================================
// Google Ads (PPC) Connection Routes
// ============================================

// Google Ads OAuth callback (no auth required - handled via state parameter)
router.get('/google-ads/callback', async (req, res) => {
    try {
        const { code, state, error } = req.query;

        // Parse state: can be "clientId" or "clientId|popup"
        let clientId = '';
        let isPopup = false;
        if (state) {
            const stateParts = (state as string).split('|');
            clientId = stateParts[0];
            isPopup = stateParts[1] === 'popup';
        }
        if (!isPopup) {
            const fromQuery = req.query.popup === 'true';
            const fromReferer = !!req.headers.referer?.includes('popup=true');
            isPopup = fromQuery || fromReferer;
        }

        if (error) {
            console.error('[Google Ads OAuth Callback] Error from Google:', {
                error,
                errorDescription: req.query.error_description,
                state,
                clientId,
            });
            
            let errorMessage = error as string;
            let errorDescription = req.query.error_description as string || '';
            
            // Provide helpful error messages for common issues
            if (error === 'access_denied') {
                errorMessage = 'Access was denied. Please grant the required permissions.';
            } else if (error === 'invalid_request') {
                errorMessage = 'Invalid request. Please check your OAuth configuration.';
            } else if (errorDescription.includes('403')) {
                errorMessage = '403 Forbidden: Your account may not have access, or the OAuth app may need to be published. See OAUTH_FIX_GUIDE.md for help.';
            }
            
            if (isPopup) {
                return res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Google Ads Connection</title>
                        <style>
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                height: 100vh;
                                margin: 0;
                                background: #f5f5f5;
                            }
                            .container {
                                text-align: center;
                                padding: 2rem;
                                max-width: 500px;
                            }
                            .error {
                                color: #ef4444;
                                font-size: 1.1rem;
                                margin-bottom: 1rem;
                            }
                            .description {
                                color: #666;
                                font-size: 0.9rem;
                                margin-top: 0.5rem;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="error">Connection failed: ${errorMessage}</div>
                            ${errorDescription ? `<div class="description">${errorDescription}</div>` : ''}
                        </div>
                        <script>
                            if (window.opener) {
                                window.opener.postMessage({
                                    type: 'GOOGLE_ADS_OAUTH_ERROR',
                                    error: '${error}',
                                    errorDescription: '${errorDescription}'
                                }, '*');
                                setTimeout(function(){ try { window.close(); } catch (e) {} }, 3000);
                            } else {
                                window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients?google_ads_error=${encodeURIComponent(errorMessage)}';
                            }
                        </script>
                    </body>
                    </html>
                `);
            }
            return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients?google_ads_error=${encodeURIComponent(errorMessage)}`);
        }

        if (!code || !state) {
            if (isPopup) {
                return res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Google Ads Connection</title>
                        <style>
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                height: 100vh;
                                margin: 0;
                                background: #f5f5f5;
                            }
                            .container {
                                text-align: center;
                                padding: 2rem;
                            }
                            .error {
                                color: #ef4444;
                                font-size: 1.1rem;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="error">Missing authorization code or state</div>
                        </div>
                        <script>
                            if (window.opener) {
                                window.opener.postMessage({
                                    type: 'GOOGLE_ADS_OAUTH_ERROR',
                                    error: 'Missing authorization code or state'
                                }, '*');
                                setTimeout(function(){ try { window.close(); } catch (e) {} }, 2000);
                            } else {
                                window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients?google_ads_error=missing_code';
                            }
                        </script>
                    </body>
                    </html>
                `);
            }
            return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients?google_ads_error=missing_code`);
        }

        // Must have a valid clientId from state so we know which client to store tokens for
        if (!clientId || clientId.trim() === '') {
            console.error('[Google Ads OAuth Callback] Missing or empty clientId in state:', { state });
            const errMsg = 'Missing client in authorization. Please start the connection from the client page.';
            return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients?google_ads_error=${encodeURIComponent(errMsg)}`);
        }

        try {
            const { accessToken, refreshToken, email } = await exchangeGoogleAdsCodeForTokens(code as string);

            if (!refreshToken) {
                console.error('[Google Ads OAuth Callback] No refresh token from Google');
                return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients?google_ads_error=${encodeURIComponent('Google did not return a refresh token. Try disconnecting and reconnecting with "Consent" prompt.')}`);
            }

            // Save tokens and connection time to client
            await prisma.client.update({
                where: { id: clientId },
                data: {
                    googleAdsAccessToken: accessToken,
                    googleAdsRefreshToken: refreshToken,
                    googleAdsAccountEmail: email || null,
                    googleAdsConnectedAt: new Date(),
                },
            });
            console.log('[Google Ads OAuth Callback] Stored refresh token and access token for client:', clientId);

            // If exactly one Google Ads account is accessible, auto-set customer ID so connection is complete
            try {
                const customers = await listGoogleAdsCustomers(clientId);
                if (customers.length === 1 && customers[0].customerId) {
                    const normalizedCustomerId = String(customers[0].customerId).replace(/-/g, '');
                    await prisma.client.update({
                        where: { id: clientId },
                        data: { googleAdsCustomerId: normalizedCustomerId },
                    });
                    console.log('[Google Ads OAuth Callback] Auto-set customer ID for client:', clientId, normalizedCustomerId);
                }
            } catch (listErr: any) {
                // Non-fatal: user can pick account via POST /connect
                console.warn('[Google Ads OAuth Callback] Could not list customers to auto-set customer ID:', listErr?.message || listErr);
            }

            if (isPopup) {
                return res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Google Ads Connection</title>
                        <style>
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                height: 100vh;
                                margin: 0;
                                background: #f5f5f5;
                            }
                            .container {
                                text-align: center;
                                padding: 2rem;
                            }
                            .success {
                                color: #10b981;
                                font-size: 1.1rem;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="success" id="msg">Google Ads connected! Closing...</div>
                            <p class="text-sm text-gray-500 mt-2" id="fallback" style="display:none">You can close this window.</p>
                        </div>
                        <script>
                            if (window.opener) {
                                window.opener.postMessage({ type: 'GOOGLE_ADS_OAUTH_SUCCESS' }, '*');
                                try { window.opener.focus(); } catch (e) {}
                                setTimeout(function() {
                                    try { window.close(); } catch (e) {}
                                    var closed = false;
                                    try { closed = window.closed; } catch (e) {}
                                    if (!closed) {
                                        var m = document.getElementById('msg'); var f = document.getElementById('fallback');
                                        if (m) m.textContent = 'Google Ads connected!';
                                        if (f) f.style.display = 'block';
                                    }
                                }, 200);
                            } else {
                                window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients/${clientId}?google_ads_tokens_received=true';
                            }
                        </script>
                    </body>
                    </html>
                `);
            }

            return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients/${clientId}?google_ads_tokens_received=true`);
        } catch (error: any) {
            console.error('Google Ads OAuth callback error:', error);
            const errorMsg = error.message || 'Failed to connect Google Ads';
            
            if (isPopup) {
                return res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Google Ads Connection</title>
                        <style>
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                height: 100vh;
                                margin: 0;
                                background: #f5f5f5;
                            }
                            .container {
                                text-align: center;
                                padding: 2rem;
                            }
                            .error {
                                color: #ef4444;
                                font-size: 1.1rem;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="error">${errorMsg}</div>
                        </div>
                        <script>
                            if (window.opener) {
                                window.opener.postMessage({
                                    type: 'GOOGLE_ADS_OAUTH_ERROR',
                                    error: '${errorMsg.replace(/'/g, "\\'")}'
                                }, '*');
                                setTimeout(function(){ try { window.close(); } catch (e) {} }, 2000);
                            } else {
                                window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients?google_ads_error=${encodeURIComponent(errorMsg)}';
                            }
                        </script>
                    </body>
                    </html>
                `);
            }
            return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients?google_ads_error=${encodeURIComponent(errorMsg)}`);
        }
    } catch (error: any) {
        console.error('Google Ads callback error:', error);
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/agency/clients?google_ads_error=${encodeURIComponent(error.message || 'Unknown error')}`);
    }
});

// Get Google Ads OAuth URL
router.get('/:id/google-ads/auth', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;

        // Check access
        const { client, hasAccess } = await canStaffAccessClient(req.user, clientId);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const isPopup = req.query.popup === 'true' || req.query.popup === '1';
        const authUrl = getGoogleAdsAuthUrl(clientId, { popup: isPopup });
        res.json({ authUrl });
    } catch (error: any) {
        console.error('Google Ads auth URL error:', error);
        res.status(500).json({ message: error.message || 'Internal server error' });
    }
});

// Get Google Ads connection status
router.get('/:id/google-ads/status', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;

        // Check access
        const { client: clientCheck, hasAccess } = await canStaffAccessClient(req.user, clientId);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const connected = await isGoogleAdsConnected(clientId);
        const client = await prisma.client.findUnique({
            where: { id: clientId },
            select: {
                googleAdsAccountEmail: true,
                googleAdsCustomerId: true,
                googleAdsConnectedAt: true,
                googleAdsRefreshToken: true,
            },
        });

        res.json({
            connected,
            hasTokens: !!(client?.googleAdsRefreshToken),
            accountEmail: client?.googleAdsAccountEmail || null,
            customerId: client?.googleAdsCustomerId || null,
            connectedAt: client?.googleAdsConnectedAt || null,
        });
    } catch (error: any) {
        console.error('Google Ads status error:', error);
        res.status(500).json({ message: error.message || 'Internal server error' });
    }
});

// List Google Ads customers (accessible accounts)
router.get('/:id/google-ads/customers', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;

        // Check access
        const { client, hasAccess } = await canStaffAccessClient(req.user, clientId);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Check if tokens exist (from OAuth callback)
        const existingClient = await prisma.client.findUnique({
            where: { id: clientId },
            select: { googleAdsAccessToken: true, googleAdsRefreshToken: true },
        });

        if (!existingClient?.googleAdsAccessToken || !existingClient?.googleAdsRefreshToken) {
            return res.status(400).json({ message: 'Please complete OAuth flow first by clicking "Connect Google Ads"' });
        }

        // clientOnly=true: flattened list of client accounts only (no managers), each with managerCustomerId when under an MCC
        const clientOnly = String(req.query.clientOnly ?? '').toLowerCase() === 'true';
        const customers = clientOnly
            ? await listGoogleAdsClientAccounts(clientId)
            : await listGoogleAdsCustomers(clientId);
        res.json({ customers });
    } catch (error: any) {
        console.error('Google Ads customers list error:', error);
        const msg = error.message || 'Internal server error';
        const isAuthError = /reconnect|authentication failed|token expired|token revoked|not connected|tokens not found/i.test(msg);
        res.status(isAuthError ? 401 : 500).json({ message: msg });
    }
});

// List child (client) accounts under a manager (MCC) - so user can pick which client to connect
router.get('/:id/google-ads/child-accounts', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;
        const customerId = req.query.customerId as string;
        if (!customerId) {
            return res.status(400).json({ message: 'customerId query is required' });
        }

        const { hasAccess } = await canStaffAccessClient(req.user, clientId);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const existingClient = await prisma.client.findUnique({
            where: { id: clientId },
            select: { googleAdsRefreshToken: true },
        });
        if (!existingClient?.googleAdsRefreshToken) {
            return res.status(400).json({ message: 'Please complete OAuth flow first by clicking "Connect Google Ads"' });
        }

        const children = await listChildAccountsUnderManager(clientId, customerId);
        res.json({ children });
    } catch (error: any) {
        console.error('Google Ads child accounts list error:', error);
        const msg = error.message || 'Internal server error';
        const isAuthError = /reconnect|authentication failed|token expired|token revoked|not connected|tokens not found/i.test(msg);
        if (isAuthError) {
            return res.status(401).json({ message: msg });
        }
        // Don't return empty children on error - so frontend won't connect the manager by mistake; show error instead
        return res.status(500).json({ message: msg });
    }
});

// Connect Google Ads with customer ID (after OAuth callback). Optional managerCustomerId when connecting a client under an MCC.
router.post('/:id/google-ads/connect', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;
        const { customerId, managerCustomerId } = req.body;

        if (!customerId) {
            return res.status(400).json({ message: 'Customer ID is required' });
        }

        // Check access
        const { client, hasAccess } = await canStaffAccessClient(req.user, clientId);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Check if tokens exist (from OAuth callback)
        const existingClient = await prisma.client.findUnique({
            where: { id: clientId },
            select: { googleAdsAccessToken: true, googleAdsRefreshToken: true },
        });

        if (!existingClient?.googleAdsAccessToken || !existingClient?.googleAdsRefreshToken) {
            return res.status(400).json({ message: 'Please complete OAuth flow first by clicking "Connect Google Ads"' });
        }

        // Normalize customer ID (remove dashes if present)
        const normalizedCustomerId = customerId.replace(/-/g, '');
        const normalizedManagerId = managerCustomerId ? String(managerCustomerId).replace(/-/g, '') : null;

        // Update client with customer ID and optional manager (MCC) ID when connecting a client account under an MCC
        await prisma.client.update({
            where: { id: clientId },
            data: {
                googleAdsCustomerId: normalizedCustomerId,
                googleAdsManagerCustomerId: normalizedManagerId,
                googleAdsConnectedAt: new Date(),
            },
        });

        res.json({ 
            message: 'Google Ads connected successfully',
            customerId: normalizedCustomerId,
        });
    } catch (error: any) {
        console.error('Google Ads connect error:', error);
        res.status(500).json({ message: error.message || 'Internal server error' });
    }
});

// Disconnect Google Ads
router.post('/:id/google-ads/disconnect', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;

        // Check access
        const { client, hasAccess } = await canStaffAccessClient(req.user, clientId);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        await prisma.client.update({
            where: { id: clientId },
            data: {
                googleAdsAccessToken: null,
                googleAdsRefreshToken: null,
                googleAdsCustomerId: null,
                googleAdsManagerCustomerId: null,
                googleAdsAccountEmail: null,
                googleAdsConnectedAt: null,
            },
        });

        res.json({ message: 'Google Ads disconnected successfully' });
    } catch (error: any) {
        console.error('Google Ads disconnect error:', error);
        res.status(500).json({ message: error.message || 'Internal server error' });
    }
});

// Helper: return 400 for Google Ads "account not enabled / deactivated" so UI can show a clear message instead of 500
function googleAdsApiErrorStatus(error: any): { status: number; message: string } {
    const msg = error?.message || '';
    const isAccountInactive = /not yet enabled|has been deactivated|can't be accessed|customer_not_enabled|CUSTOMER_NOT_ENABLED/i.test(msg);
    if (isAccountInactive) {
        return {
            status: 400,
            message: "The connected Google Ads account isn't active (not yet enabled or has been deactivated). Please disconnect and connect an active account.",
        };
    }
    return { status: 500, message: msg || 'Failed to fetch Google Ads data' };
}

// Get Google Ads campaigns data
router.get('/:id/google-ads/campaigns', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;
        const { start, end, period } = req.query;

        // Check access
        const { client, hasAccess } = await canStaffAccessClient(req.user, clientId, true);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Check if Google Ads is connected
        if (!client?.googleAdsRefreshToken || !client?.googleAdsCustomerId || !client?.googleAdsConnectedAt) {
            return res.status(400).json({ 
                message: 'Google Ads is not connected for this client',
                connected: false 
            });
        }

        // Calculate date range
        let startDate: Date;
        let endDate: Date = new Date();

        if (start && end) {
            startDate = new Date(start as string);
            endDate = new Date(end as string);
        } else if (period) {
            const days = parseInt(period as string, 10);
            startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
        } else {
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);
        }

        // Fetch Google Ads campaigns data
        const data = await fetchGoogleAdsCampaigns(clientId, startDate, endDate);

        res.json({
            success: true,
            data,
            dateRange: {
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0],
            },
            customerId: client.googleAdsCustomerId,
        });
    } catch (error: any) {
        console.error('Google Ads campaigns fetch error:', error);
        const { status, message } = googleAdsApiErrorStatus(error);
        return res.status(status).json({
            success: false,
            message,
            error: error.message,
        });
    }
});

// Get Google Ads ad groups data
router.get('/:id/google-ads/ad-groups', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;
        const { start, end, period, campaignId } = req.query;

        // Check access
        const { client, hasAccess } = await canStaffAccessClient(req.user, clientId, true);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        if (!client?.googleAdsRefreshToken || !client?.googleAdsCustomerId) {
            return res.status(400).json({ message: 'Google Ads is not connected' });
        }

        // Calculate date range
        let startDate: Date;
        let endDate: Date = new Date();

        if (start && end) {
            startDate = new Date(start as string);
            endDate = new Date(end as string);
        } else if (period) {
            const days = parseInt(period as string, 10);
            startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
        } else {
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);
        }

        const data = await fetchGoogleAdsAdGroups(clientId, startDate, endDate, campaignId as string | undefined);

        res.json({
            success: true,
            data,
            dateRange: {
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0],
            },
        });
    } catch (error: any) {
        console.error('Google Ads ad groups fetch error:', error);
        const { status, message } = googleAdsApiErrorStatus(error);
        return res.status(status).json({ message });
    }
});

// Get Google Ads keywords data
router.get('/:id/google-ads/keywords', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;
        const { start, end, period, campaignId, adGroupId } = req.query;

        // Check access
        const { client, hasAccess } = await canStaffAccessClient(req.user, clientId, true);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        if (!client?.googleAdsRefreshToken || !client?.googleAdsCustomerId) {
            return res.status(400).json({ message: 'Google Ads is not connected' });
        }

        // Calculate date range
        let startDate: Date;
        let endDate: Date = new Date();

        if (start && end) {
            startDate = new Date(start as string);
            endDate = new Date(end as string);
        } else if (period) {
            const days = parseInt(period as string, 10);
            startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
        } else {
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);
        }

        const data = await fetchGoogleAdsKeywords(clientId, startDate, endDate, campaignId as string | undefined, adGroupId as string | undefined);

        res.json({
            success: true,
            data,
            dateRange: {
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0],
            },
        });
    } catch (error: any) {
        console.error('Google Ads keywords fetch error:', error);
        const { status, message } = googleAdsApiErrorStatus(error);
        return res.status(status).json({ message });
    }
});

// Get Google Ads conversions data
router.get('/:id/google-ads/conversions', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;
        const { start, end, period } = req.query;

        // Check access
        const { client, hasAccess } = await canStaffAccessClient(req.user, clientId, true);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        if (!client?.googleAdsRefreshToken || !client?.googleAdsCustomerId) {
            return res.status(400).json({ message: 'Google Ads is not connected' });
        }

        // Calculate date range
        let startDate: Date;
        let endDate: Date = new Date();

        if (start && end) {
            startDate = new Date(start as string);
            endDate = new Date(end as string);
        } else if (period) {
            const days = parseInt(period as string, 10);
            startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
        } else {
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);
        }

        const data = await fetchGoogleAdsConversions(clientId, startDate, endDate);

        res.json({
            success: true,
            data,
            dateRange: {
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0],
            },
        });
    } catch (error: any) {
        console.error('Google Ads conversions fetch error:', error);
        const { status, message } = googleAdsApiErrorStatus(error);
        return res.status(status).json({ message });
    }
});

export default router;