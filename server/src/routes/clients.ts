import express from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

const createClientSchema = z.object({
    name: z.string().min(1),
    domain: z.string().url().or(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/)),
    industry: z.string().optional(),
    targets: z.array(z.string()).optional(),
    status: z.enum(['ACTIVE', 'PENDING', 'REJECTED']).optional().default('PENDING'),
});

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

        res.json(clients);
    } catch (error) {
        console.error('Fetch clients error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Create a client
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { name, domain, industry, targets, status } = createClientSchema.parse(req.body);

        // Normalize domain (remove protocol if present)
        let normalizedDomain = domain;
        if (domain.startsWith('http://') || domain.startsWith('https://')) {
            normalizedDomain = domain.replace(/^https?:\/\//, '');
        }
        normalizedDomain = normalizedDomain.replace(/^www\./, '');

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

        // Create client
        const client = await prisma.client.create({
            data: {
                name,
                domain: normalizedDomain,
                industry,
                targets: targets || [],
                status: status || 'PENDING',
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
    const { name, domain, status, industry, targets } = req.body.data || req.body;

    try {
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
            let normalizedDomain = domain;
            if (domain.startsWith('http://') || domain.startsWith('https://')) {
                normalizedDomain = domain.replace(/^https?:\/\//, '');
            }
            normalizedDomain = normalizedDomain.replace(/^www\./, '');
            updateData.domain = normalizedDomain;
        }
        if (industry !== undefined) updateData.industry = industry;
        if (targets !== undefined) updateData.targets = targets;

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



export default router;