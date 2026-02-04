import express from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { Prisma, Role } from "@prisma/client";
import { authenticateToken, getJwtSecret } from '../middleware/auth.js';
import { sendEmail } from '../lib/email.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

type UserWithMemberships = Prisma.UserGetPayload<{
    include: { memberships: { include: { agency: { select: { id: true; name: true } } } } };
}>;

function escapeHtml(s: string): string {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const SPECIALTY_KEYS = ['ON_PAGE_SEO', 'LINK_BUILDING', 'CONTENT_WRITING', 'TECHNICAL_SEO'] as const;

const inviteTeamMemberSchema = z.object({
    email: z.string().email(),
    name: z.string().min(1),
    role: z.enum(['SPECIALIST', 'AGENCY', 'ADMIN']).default('SPECIALIST'),
    agencyId: z.string().optional(),
    specialties: z.array(z.enum(SPECIALTY_KEYS)).optional().default([]),
    sendInvitationEmail: z.boolean().optional().default(true),
});

const updateTeamMemberSchema = z.object({
    name: z.string().min(1).optional(),
    role: z.enum(['SPECIALIST', 'AGENCY', 'ADMIN', 'SUPER_ADMIN']).optional(),
    agencyRole: z.enum(['SPECIALIST', 'MANAGER', 'OWNER']).optional(),
});

// Get team members (for the current user's agency)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const user = req.user;

        let teamMembers;

        if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
            const scope = String(req.query.scope || "");
            const includeAll = scope === "all";
            const roles: Role[] = includeAll
                ? [Role.SPECIALIST, Role.AGENCY, Role.ADMIN, Role.SUPER_ADMIN, Role.USER]
                : [Role.SPECIALIST, Role.AGENCY, Role.ADMIN, Role.SUPER_ADMIN];
            // Super admin and admin can see all users
            const users: UserWithMemberships[] = await prisma.user.findMany({
                where: {
                    role: { in: roles },
                },
                include: {
                    memberships: {
                        include: {
                            agency: {
                                select: { id: true, name: true },
                            },
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
            });

            // Get client counts for each user
            teamMembers = await Promise.all(
                users.map(async (u) => {
                    const clientCount = await prisma.client.count({
                        where: { userId: u.id },
                    });

                    const taskCount = await prisma.task.count({
                        where: { assigneeId: u.id },
                    });

                    return {
                        id: u.id,
                        name: u.name || 'Unknown',
                        email: u.email,
                        role: u.role,
                        status: u.verified ? 'Active' : 'Invited',
                        verified: u.verified,
                        invited: u.invited,
                        lastActive: u.updatedAt,
                        createdAt: u.createdAt,
                        agencies: u.memberships.map((m) => ({
                            id: m.agency.id,
                            name: m.agency.name,
                            role: m.agencyRole,
                        })),
                        clientCount,
                        taskCount,
                    };
                })
            );
        } else if (user.role === 'AGENCY') {
            // Agency users see members of their agencies
            const memberships = await prisma.userAgency.findMany({
                where: { userId: user.userId },
                select: { agencyId: true },
            });

            const agencyIds = memberships.map((m) => m.agencyId);

            // Get all users who are members of these agencies
            const agencyMemberships = await prisma.userAgency.findMany({
                where: { agencyId: { in: agencyIds } },
                include: {
                    user: true,
                    agency: {
                        select: { id: true, name: true },
                    },
                },
            });

            // Group by user
            const userMap = new Map();
            agencyMemberships.forEach((membership) => {
                const userId = membership.userId;
                if (!userMap.has(userId)) {
                    userMap.set(userId, {
                        ...membership.user,
                        agencies: [],
                    });
                }
                userMap.get(userId).agencies.push({
                    id: membership.agency.id,
                    name: membership.agency.name,
                    role: membership.agencyRole,
                });
            });

            // Convert to array and add client/task counts
            teamMembers = await Promise.all(
                Array.from(userMap.values()).map(async (u: any) => {
                    const clientCount = await prisma.client.count({
                        where: { userId: u.id },
                    });

                    const taskCount = await prisma.task.count({
                        where: { assigneeId: u.id },
                    });

                    return {
                        id: u.id,
                        name: u.name || 'Unknown',
                        email: u.email,
                        role: u.role,
                        status: u.verified ? 'Active' : 'Invited',
                        verified: u.verified,
                        invited: u.invited,
                        lastActive: u.updatedAt,
                        createdAt: u.createdAt,
                        agencies: u.agencies,
                        clientCount,
                        taskCount,
                    };
                })
            );
        } else {
            // Specialists can see members of their agencies
            const memberships = await prisma.userAgency.findMany({
                where: { userId: user.userId },
                select: { agencyId: true },
            });

            const agencyIds = memberships.map((m) => m.agencyId);

            const agencyMemberships = await prisma.userAgency.findMany({
                where: { agencyId: { in: agencyIds } },
                include: {
                    user: true,
                    agency: {
                        select: { id: true, name: true },
                    },
                },
            });

            const userMap = new Map();
            agencyMemberships.forEach((membership) => {
                const userId = membership.userId;
                if (!userMap.has(userId)) {
                    userMap.set(userId, {
                        ...membership.user,
                        agencies: [],
                    });
                }
                userMap.get(userId).agencies.push({
                    id: membership.agency.id,
                    name: membership.agency.name,
                    role: membership.agencyRole,
                });
            });

            teamMembers = await Promise.all(
                Array.from(userMap.values()).map(async (u: any) => {
                    const clientCount = await prisma.client.count({
                        where: { userId: u.id },
                    });

                    const taskCount = await prisma.task.count({
                        where: { assigneeId: u.id },
                    });

                    return {
                        id: u.id,
                        name: u.name || 'Unknown',
                        email: u.email,
                        role: u.role,
                        status: u.verified ? 'Active' : 'Invited',
                        verified: u.verified,
                        invited: u.invited,
                        lastActive: u.updatedAt,
                        createdAt: u.createdAt,
                        agencies: u.agencies,
                        clientCount,
                        taskCount,
                    };
                })
            );
        }

        res.json(teamMembers);
    } catch (error) {
        console.error('Get team members error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Invite team member
router.post('/invite', authenticateToken, async (req, res) => {
    try {
        const user = req.user;

        // Only AGENCY, ADMIN, or SUPER_ADMIN can invite
        if (user.role !== 'AGENCY' && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const { email, name, role, agencyId, specialties, sendInvitationEmail } = inviteTeamMemberSchema.parse(req.body);

        // Check if user already exists
        let existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            return res.status(400).json({ message: 'User with this email already exists' });
        }

        // Determine agency ID
        let targetAgencyId = agencyId;
        if (!targetAgencyId && user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
            // Get user's first agency
            const membership = await prisma.userAgency.findFirst({
                where: { userId: user.userId },
                select: { agencyId: true },
            });

            if (!membership) {
                return res.status(400).json({ message: 'No agency found for user' });
            }

            targetAgencyId = membership.agencyId;
        }

        // Create user (invited, not verified — status effectively 'pending')
        const newUser = await prisma.user.create({
            data: {
                email,
                name,
                role: role || 'SPECIALIST',
                invited: true,
                verified: false,
                specialties: specialties?.length ? JSON.stringify(specialties) : null,
            },
        });

        // Add to agency if provided
        if (targetAgencyId) {
            await prisma.userAgency.create({
                data: {
                    userId: newUser.id,
                    agencyId: targetAgencyId,
                    agencyRole: 'SPECIALIST',
                },
            });
        }

        // Create invite token
        const inviteToken = jwt.sign(
            { userId: newUser.id, email },
            getJwtSecret(),
            { expiresIn: '7d' }
        );

        await prisma.token.create({
            data: {
                type: 'INVITE',
                email: newUser.email,
                token: inviteToken,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                userId: newUser.id,
                agencyId: targetAgencyId || null,
                role: role || 'SPECIALIST',
            },
        });

        // Send invitation email (invite still succeeds if email fails)
        let agencyName = 'the team';
        if (targetAgencyId) {
            const agency = await prisma.agency.findUnique({
                where: { id: targetAgencyId },
                select: { name: true },
            });
            if (agency?.name) agencyName = agency.name;
        }
        const inviteUrl = `${process.env.FRONTEND_URL || ''}/invite?token=${encodeURIComponent(inviteToken)}`;
        if (sendInvitationEmail !== false) {
            try {
                await sendEmail({
                    to: email,
                    subject: `You've been invited to join ${agencyName}`,
                    html: `
          <h1>You've been invited!</h1>
          <p>${escapeHtml(name)}, you've been invited to join ${escapeHtml(agencyName)}.</p>
          <p>Click the link below to accept the invitation (link expires in 7 days):</p>
          <p><a href="${inviteUrl}">Accept Invitation</a></p>
          <p>If the link doesn't work, copy and paste this URL into your browser:</p>
          <p style="word-break:break-all">${inviteUrl}</p>
        `,
                });
            } catch (emailErr: any) {
                console.error('Team invite email failed:', emailErr);
                // Invite is already created; do not fail the request
            }
        }

        res.status(201).json({
            message: 'Team member invited successfully',
            user: {
                id: newUser.id,
                email: newUser.email,
                name: newUser.name,
                role: newUser.role,
                status: 'Invited',
            },
        });
    } catch (error: any) {
        if (error.name === 'ZodError') {
            return res.status(400).json({ message: 'Invalid input', errors: error.errors });
        }
        console.error('Invite team member error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update team member
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        const user = req.user;

        // Only ADMIN or SUPER_ADMIN can update team members
        if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const updateData = updateTeamMemberSchema.parse(req.body);

        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (!existingUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Update user
        const updated = await prisma.user.update({
            where: { id: userId },
            data: updateData,
        });

        res.json({
            id: updated.id,
            name: updated.name,
            email: updated.email,
            role: updated.role,
            status: updated.verified ? 'Active' : 'Invited',
        });
    } catch (error: any) {
        if (error.name === 'ZodError') {
            return res.status(400).json({ message: 'Invalid input', errors: error.errors });
        }
        console.error('Update team member error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Delete team member (remove from agency)
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        const user = req.user;

        // Only ADMIN, SUPER_ADMIN, or AGENCY can remove team members
        if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN' && user.role !== 'AGENCY') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const targetUser = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                memberships: true,
            },
        });

        if (!targetUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        // If SUPER_ADMIN or ADMIN, can delete user completely (if not SUPER_ADMIN)
        if ((user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') && targetUser.role !== 'SUPER_ADMIN') {
            // Delete user (cascade will handle memberships, etc.)
            await prisma.user.delete({
                where: { id: userId },
            });

            return res.json({ message: 'User deleted successfully' });
        }

        // For AGENCY users, only remove from their agency
        if (user.role === 'AGENCY') {
            const userAgencies = await prisma.userAgency.findMany({
                where: { userId: user.userId },
                select: { agencyId: true },
            });

            const agencyIds = userAgencies.map((a) => a.agencyId);

            // Remove target user from these agencies
            await prisma.userAgency.deleteMany({
                where: {
                    userId: targetUser.id,
                    agencyId: { in: agencyIds },
                },
            });

            return res.json({ message: 'Team member removed from agency successfully' });
        }

        res.status(403).json({ message: 'Access denied' });
    } catch (error) {
        console.error('Delete team member error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;

