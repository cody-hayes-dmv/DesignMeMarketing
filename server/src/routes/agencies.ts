import express from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/email.js';
import { authenticateToken, getJwtSecret } from '../middleware/auth.js';

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

// Create agency directly (Super Admin only)
const createAgencySchema = z.object({
  name: z.string().min(1),
  subdomain: z.string().optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  username: z.string().min(1).optional(),
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Access denied. Only Super Admin can create agencies directly.' });
    }

    const { name, subdomain, email, password, username } = createAgencySchema.parse(req.body);

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

    // Check if email already exists (if provided)
    if (email) {
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        return res.status(400).json({ message: 'User with this email already exists' });
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

    // If email and password provided, create agency owner user
    if (email && password) {
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.default.hash(password, 12);
      
      const agencyUser = await prisma.user.create({
        data: {
          email,
          name: username || name,
          passwordHash,
          role: 'AGENCY',
          verified: true,
          invited: false,
        },
      });

      // Link user to agency as OWNER
      await prisma.userAgency.create({
        data: {
          userId: agencyUser.id,
          agencyId: agency.id,
          agencyRole: 'OWNER',
        },
      });
    }

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

    // Delete agency (cascade will handle UserAgency relationships)
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

    // Verify client exists
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: true,
      },
    });

    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
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

    // Check if client is actually assigned to this agency
    // A client belongs to an agency if the client's userId belongs to a user who is a member of that agency
    const clientUserAgencyIds = client.user.memberships.map(m => m.agencyId);
    const isClientAssignedToAgency = clientUserAgencyIds.includes(agencyId);
    
    if (!isClientAssignedToAgency) {
      return res.status(400).json({ message: 'Client is not assigned to this agency' });
    }

    // Find a SUPER_ADMIN user to assign the client to (unassigned clients belong to SUPER_ADMIN)
    const superAdminUser = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN' },
      select: { id: true },
    });

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