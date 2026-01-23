import express from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import { sendEmail } from '../lib/email.js';

const router = express.Router();

const inviteClientUsersSchema = z.object({
    emails: z.array(z.string().email()).min(1),
    sendEmail: z.boolean().optional().default(true),
    clientRole: z.enum(['CLIENT', 'STAFF']).optional().default('CLIENT'),
});

async function canStaffAccessClient(user: { userId: string; role: string }, clientId: string) {
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

    if (!client) return { client: null as any, hasAccess: false };

    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
    const isOwner = client.userId === user.userId;

    if (isAdmin || isOwner) return { client, hasAccess: true };

    // Agency/Worker users: check if in same agency
    if (user.role === 'AGENCY' || user.role === 'WORKER') {
        const userMemberships = await prisma.userAgency.findMany({
            where: { userId: user.userId },
            select: { agencyId: true },
        });
        const userAgencyIds = userMemberships.map(m => m.agencyId);
        const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
        const sameAgency = clientAgencyIds.some(id => userAgencyIds.includes(id));
        return { client, hasAccess: sameAgency };
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
    status: z.enum(['ACTIVE', 'PENDING', 'REJECTED']).optional(),
});

const restrictedAccountInfoKeys = [
    'seoRoadmapStartMonth',
    'pagesPerMonth',
    'technicalHoursPerMonth',
    'campaignDurationMonths',
] as const;

function sanitizeAccountInfo(input: any, canEditRestricted: boolean) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const next: Record<string, any> = { ...(input as any) };
    if (!canEditRestricted) {
        for (const k of restrictedAccountInfoKeys) {
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
router.get('/', authenticateToken, async (req, res) => {
    try {
        let clients;

        if (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') {
            // Global admins see all clients
            clients = await prisma.client.findMany({
                include: {
                    user: {
                        select: { id: true, name: true, email: true },
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
            // Worker/Agency users → get clients of their agency
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
                        select: { id: true, name: true, email: true },
                    },
                },
                orderBy: { createdAt: 'desc' },
            });
        }

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

                // Prefer GA4 total sessions (last saved snapshot is typically last 30 days)
                // This is DB-only and does not call Google/DataForSEO.
                const ga4Metrics = await prisma.ga4Metrics.findUnique({
                    where: { clientId: client.id },
                    select: { totalSessions: true, endDate: true },
                });
                const traffic30d = ga4Metrics?.totalSessions ?? null;

                return {
                    ...client,
                    keywords: keywordStats._count.id || 0,
                    avgPosition: keywordStats._avg.currentPosition ? Math.round(keywordStats._avg.currentPosition * 10) / 10 : null,
                    topRankings: topRankingsCount || 0,
                    traffic: trafficSource?.organicEstimatedTraffic || trafficSource?.totalEstimatedTraffic || 0,
                    traffic30d,
                };
            })
        );

        res.json(clientsWithStats);
    } catch (error) {
        console.error('Fetch clients error:', error);
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

// Invite one or more client portal users
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
                process.env.JWT_SECRET!,
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

        // Determine status: SUPER_ADMIN always creates ACTIVE, others always create PENDING
        const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
        const canEditRestricted = req.user.role === 'SUPER_ADMIN' || req.user.role === 'WORKER';
        // SUPER_ADMIN always creates ACTIVE, ignore status parameter
        // Other roles always create PENDING, ignore status parameter
        const clientStatus = isSuperAdmin ? 'ACTIVE' : 'PENDING';

        const safeAccountInfo = sanitizeAccountInfo(accountInfo, canEditRestricted);

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
    const { name, domain, status, industry, targets, loginUrl, username, password, accountInfo } = req.body.data || req.body;

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

        // accountInfo merge (do not allow non-super-admin/worker to modify SEO roadmap fields)
        if (accountInfo !== undefined) {
            const canEditRestricted = req.user.role === 'SUPER_ADMIN' || req.user.role === 'WORKER';
            const incoming = sanitizeAccountInfo(accountInfo, canEditRestricted);
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

        const updated = await prisma.client.update({
            where: { id: clientId },
            data: updateData,
            include: {
                user: {
                    select: { id: true, name: true, email: true },
                },
            },
        });

        res.json(updated);
    } catch (error) {
        console.error('Update client error:', error);
        res.status(500).json({ message: 'Internal server error' });
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

// GA4 Connection Routes
import { getGA4AuthUrl, exchangeCodeForTokens, isGA4Connected, listGA4Properties } from '../lib/ga4.js';

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
                            }
                            .error {
                                color: #ef4444;
                                font-size: 1.1rem;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="error">Connection failed: ${error}</div>
                        </div>
                        <script>
                            if (window.opener) {
                                window.opener.postMessage({
                                    type: 'GA4_OAUTH_ERROR',
                                    error: '${error}'
                                }, '*');
                                setTimeout(() => window.close(), 2000);
                            } else {
                                window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3000'}/agency/clients?ga4_error=${encodeURIComponent(error as string)}';
                            }
                        </script>
                    </body>
                    </html>
                `);
            }
            return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/agency/clients?ga4_error=${encodeURIComponent(error as string)}`);
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
                                window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3000'}/agency/clients?ga4_error=missing_params';
                            }
                        </script>
                    </body>
                    </html>
                `);
            }
            return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/agency/clients?ga4_error=missing_params`);
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
                            window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3000'}/agency/clients/${clientId}?ga4_tokens_received=true';
                        }
                    </script>
                </body>
                </html>
            `);
        }

        // Redirect to client page with token stored, user can now select property
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/agency/clients/${clientId}?ga4_tokens_received=true`);
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
                            window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3000'}/agency/clients?ga4_error=${encodeURIComponent(error.message || 'connection_failed')}';
                        }
                    </script>
                </body>
                </html>
            `);
        }
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/agency/clients?ga4_error=${encodeURIComponent(error.message || 'connection_failed')}`);
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
            },
        });

        res.json({
            connected,
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

        // List all GA4 properties
        const properties = await listGA4Properties(clientId);
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

export default router;