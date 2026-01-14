import express from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/email.js';
import { authenticateToken } from '../middleware/auth.js';

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

    const agencies = await prisma.agency.findMany({
      include: {
        _count: {
          select: { members: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formattedAgencies = agencies.map(agency => ({
      id: agency.id,
      name: agency.name,
      subdomain: agency.subdomain,
      createdAt: agency.createdAt,
      memberCount: agency._count.members,
    }));

    res.json(formattedAgencies);
  } catch (error) {
    console.error('Fetch agencies error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create agency directly (Super Admin only)
const createAgencySchema = z.object({
  name: z.string().min(1),
  subdomain: z.string().optional(),
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied. Only Super Admin can create agencies directly.' });
    }

    const { name, subdomain } = createAgencySchema.parse(req.body);

    // Check if agency with this name already exists
    const existingAgency = await prisma.agency.findFirst({
      where: { name },
    });

    if (existingAgency) {
      return res.status(400).json({ message: 'Agency with this name already exists' });
    }

    // Check if subdomain is already taken
    if (subdomain) {
      const existingSubdomain = await prisma.agency.findUnique({
        where: { subdomain },
      });

      if (existingSubdomain) {
        return res.status(400).json({ message: 'Subdomain already taken' });
      }
    }

    // Create agency
    const agency = await prisma.agency.create({
      data: {
        name,
        subdomain: subdomain || null,
      },
      include: {
        _count: {
          select: { members: true },
        },
      },
    });

    const formattedAgency = {
      id: agency.id,
      name: agency.name,
      subdomain: agency.subdomain,
      createdAt: agency.createdAt,
      memberCount: agency._count.members,
    };

    res.status(201).json(formattedAgency);
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
      process.env.JWT_SECRET!,
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

// Invite worker (Agency owners only)
router.post('/:agencyId/invite-worker', authenticateToken, async (req, res) => {
  try {
    const { agencyId } = req.params;
    const { email, name } = inviteSchema.parse(req.body);

    // Check if user has permission to invite for this agency
    const membership = await prisma.userAgency.findFirst({
      where: {
        userId: req.user.userId,
        agencyId,
        agencyRole: { in: ['WORKER', 'OWNER', 'MANAGER'] },
      },
      include: { agency: true },
    });

    if (!membership && (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN')) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Generate invitation token
    const inviteToken = jwt.sign(
      { email, agencyId, role: 'WORKER' },
      process.env.JWT_SECRET!,
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
        role: 'WORKER',
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

    res.json({ message: 'Worker invitation sent successfully' });
  } catch (error) {
    console.error('Invite worker error:', error);
    res.status(500).json({ message: 'Failed to send invitation' });
  }
});

// Get current user's agency
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = req.user;

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

export default router;