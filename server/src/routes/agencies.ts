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

export default router;