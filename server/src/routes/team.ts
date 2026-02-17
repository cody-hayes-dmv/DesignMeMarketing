import express from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { Prisma, Role } from "@prisma/client";
import { authenticateToken, getJwtSecret } from '../middleware/auth.js';
import { sendEmail } from '../lib/email.js';
import jwt from 'jsonwebtoken';
import { getAgencyTierContext, canAddTeamMember } from '../lib/agencyLimits.js';

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
    newPassword: z.string().min(6).optional(),
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

        // Add to agency if provided (check tier team limit)
        if (targetAgencyId) {
            const tierCtx = await getAgencyTierContext(user.userId, user.role);
            const teamCheck = canAddTeamMember(tierCtx);
            if (!teamCheck.allowed) {
                return res.status(403).json({
                    message: teamCheck.message,
                    code: 'TIER_LIMIT',
                    limitType: 'team_members',
                });
            }
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
        const companyName = 'Design ME Marketing';
        let teamLabel = companyName + "'s team";
        if (targetAgencyId) {
            const agency = await prisma.agency.findUnique({
                where: { id: targetAgencyId },
                select: { name: true },
            });
            if (agency?.name) teamLabel = agency.name + "'s team";
        }
        const inviter = await prisma.user.findUnique({
            where: { id: user.userId },
            select: { name: true },
        });
        const inviterName = inviter?.name?.trim() || 'A team admin';

        const inviteUrl = `${process.env.FRONTEND_URL || ''}/invite?token=${encodeURIComponent(inviteToken)}`;
        let emailSent = false;
        if (sendInvitationEmail !== false) {
            try {
                console.log('[Team invite] Sending invitation email to', email);
                await sendEmail({
                    to: email,
                    subject: `You've been invited to join ${teamLabel}`,
                    html: `
          <h1>You've been invited!</h1>
          <p>Hi ${escapeHtml(name)},</p>
          <p>${escapeHtml(inviterName)} has invited you to join the ${escapeHtml(teamLabel)} as a ${role === 'ADMIN' ? 'Admin' : 'Specialist'}.</p>
          <p>Click the link below to set your password and access your dashboard:</p>
          <p><a href="${inviteUrl}">Secure Setup Link – expires in 7 days</a></p>
          <p>Once you're in, you'll be able to:</p>
          <ul>
            <li>View tasks assigned to you</li>
            <li>Mark tasks complete</li>
            <li>Track your progress</li>
          </ul>
          <p>Questions? Reply to this email.</p>
          <p>– ${escapeHtml(companyName)} Team</p>
          <p style="color:#6b7280;font-size:12px;margin-top:24px;">If the link doesn't work, copy and paste this URL into your browser:</p>
          <p style="word-break:break-all;font-size:12px;color:#6b7280;">${inviteUrl}</p>
        `,
                });
                emailSent = true;
                console.log('[Team invite] Email sent successfully to', email);
            } catch (emailErr: any) {
                console.error('[Team invite] Email send failed:', emailErr?.message || emailErr);
                // Invite is already created; do not fail the request
            }
        }

        res.status(201).json({
            message: 'Team member invited successfully',
            emailSent,
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

// Resend invitation email (SUPER_ADMIN / ADMIN only)
router.post('/:id/resend-invite', authenticateToken, async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const reqUser = req.user;

        if (reqUser.role !== 'SUPER_ADMIN' && reqUser.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const targetUser = await prisma.user.findUnique({
            where: { id: targetUserId },
        });
        if (!targetUser) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (targetUser.verified) {
            return res.status(400).json({ message: 'User has already accepted the invitation' });
        }
        if (!targetUser.invited) {
            return res.status(400).json({ message: 'User was not invited via invitation flow' });
        }

        const inviteToken = jwt.sign(
            { userId: targetUser.id, email: targetUser.email },
            getJwtSecret(),
            { expiresIn: '7d' }
        );

        await prisma.token.updateMany({
            where: { userId: targetUser.id, type: 'INVITE' },
            data: { usedAt: new Date() },
        });
        await prisma.token.create({
            data: {
                type: 'INVITE',
                email: targetUser.email,
                token: inviteToken,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                userId: targetUser.id,
                role: targetUser.role,
            },
        });

        const inviteUrl = `${process.env.FRONTEND_URL || ''}/invite?token=${encodeURIComponent(inviteToken)}`;
        const companyName = 'Design ME Marketing';
        const inviter = await prisma.user.findUnique({
            where: { id: reqUser.userId },
            select: { name: true },
        });
        const inviterName = inviter?.name?.trim() || 'A team admin';
        let emailSent = false;
        try {
            console.log('[Team resend invite] Sending to', targetUser.email);
            await sendEmail({
                to: targetUser.email,
                subject: `You've been invited to join ${companyName}'s team`,
                html: `
          <h1>You've been invited!</h1>
          <p>Hi ${escapeHtml(targetUser.name || 'there')},</p>
          <p>${escapeHtml(inviterName)} has invited you to join the ${escapeHtml(companyName)} team.</p>
          <p>Click the link below to set your password and access your dashboard (link expires in 7 days):</p>
          <p><a href="${inviteUrl}">Secure Setup Link</a></p>
          <p>Once you're in, you'll be able to view tasks assigned to you, mark tasks complete, and track your progress.</p>
          <p>Questions? Reply to this email.</p>
          <p>– ${escapeHtml(companyName)} Team</p>
          <p style="color:#6b7280;font-size:12px;margin-top:24px;">If the link doesn't work, copy and paste this URL into your browser:</p>
          <p style="word-break:break-all;font-size:12px;color:#6b7280;">${inviteUrl}</p>
        `,
            });
            emailSent = true;
            console.log('[Team resend invite] Email sent successfully to', targetUser.email);
        } catch (emailErr: any) {
            console.error('[Team resend invite] Email send failed:', emailErr?.message || emailErr);
        }

        return res.json({
            message: emailSent ? 'Invitation email resent successfully' : 'Invitation created but email could not be sent. Use Resend again or check SMTP configuration.',
            emailSent,
        });
    } catch (error: any) {
        console.error('Resend invite error:', error);
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

        const parsed = updateTeamMemberSchema.parse(req.body);
        const { newPassword, ...updateData } = parsed;

        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (!existingUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        const data: Record<string, unknown> = { ...updateData };
        if (newPassword && user.role === 'SUPER_ADMIN') {
            data.passwordHash = await bcrypt.hash(newPassword, 12);
        }

        const updated = await prisma.user.update({
            where: { id: userId },
            data,
        });

        const body: Record<string, unknown> = {
            id: updated.id,
            name: updated.name,
            email: updated.email,
            role: updated.role,
            status: updated.verified ? 'Active' : 'Invited',
        };
        if (newPassword && user.role === 'SUPER_ADMIN') {
            body.newPassword = newPassword;
        }
        res.json(body);
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
            // Block if user owns any clients (Client.userId is required; cannot cascade delete clients)
            const clientCount = await prisma.client.count({ where: { userId } });
            if (clientCount > 0) {
                return res.status(400).json({
                    message: `Cannot delete user: they own ${clientCount} client dashboard(s). Reassign or remove those clients first.`,
                });
            }

            await prisma.$transaction(async (tx) => {
                // Clear FK references that don't have onDelete: Cascade
                await tx.token.deleteMany({ where: { userId } });
                await tx.task.updateMany({ where: { assigneeId: userId }, data: { assigneeId: null } });
                await tx.task.updateMany({ where: { createdById: userId }, data: { createdById: null } });
                await tx.clientUser.updateMany({ where: { invitedById: userId }, data: { invitedById: null } });
                await tx.user.delete({ where: { id: userId } });
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

