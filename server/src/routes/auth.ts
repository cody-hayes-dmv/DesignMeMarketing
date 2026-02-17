import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { TokenType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { authenticateToken, getJwtSecret } from "../middleware/auth.js";

const router = express.Router();

const PASSWORD_RESET: TokenType = "PASSWORD_RESET" as TokenType;

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// Register
router.post("/register", async (req, res) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: "AGENCY",
      },
    });

    // Create verification token
    const verificationToken = jwt.sign(
      { userId: user.id },
      getJwtSecret(),
      { expiresIn: "24h" }
    );

    await prisma.token.create({
      data: {
        type: "EMAIL_VERIFY",
        email: user.email,
        token: verificationToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        userId: user.id,
      },
    });

    // Send verification email
    // await sendEmail({
    //   to: email,
    //   subject: "Verify your email - YourSEODashboard",
    //   html: `
    //     <h1>Welcome to YourSEODashboard!</h1>
    //     <p>Please verify your email by clicking the link below:</p>
    //     <a href="${process.env.FRONTEND_URL}/verify?token=${verificationToken}">Verify Email</a>
    //   `,
    // });

    res.status(201).json({
      message:
        "User created successfully. Please check your email to verify your account.",
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(400).json({ message: "Registration failed" });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const parsed = loginSchema.safeParse({
      email: typeof body.email === "string" ? body.email.trim() : body.email,
      password: body.password,
    });
    if (!parsed.success) {
      const msg = parsed.error.errors?.[0]?.message || "Email and password are required";
      return res.status(400).json({ message: msg });
    }
    const { email, password } = parsed.data;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: {
            agency: true,
          },
        },
        clientUsers: {
          where: { status: "ACTIVE" },
          select: { clientId: true, clientRole: true, status: true },
        },
      },
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Check if email is verified (invited team members become verified when they accept)
    if (!user.verified) {
      return res
        .status(401)
        .json({ message: "Please verify your email before logging in" });
    }

    // Track last login time (useful for client user lists)
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      getJwtSecret(),
      { expiresIn: "7d" }
    );

    const clientUsers = user.clientUsers ?? [];
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        verified: user.verified,
        invited: user.invited,
        clientAccess: {
          clients: clientUsers.map((c: { clientId: string; clientRole: string; status: string }) => ({
            clientId: c.clientId,
            role: c.clientRole,
            status: c.status,
          })),
        },
      },
    });
  } catch (error: any) {
    console.error("Login error:", error);
    if (error?.name === "ZodError") {
      return res.status(400).json({ message: error?.errors?.[0]?.message || "Invalid input" });
    }
    res.status(500).json({ message: "Login failed" });
  }
});

// Get current user
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: {
        memberships: {
          include: {
            agency: true,
          },
        },
        clientUsers: {
          where: { status: "ACTIVE" },
          select: { clientId: true, clientRole: true, status: true },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const prefs = user.notificationPreferences as Record<string, boolean> | null;
    const notificationPreferences = prefs && typeof prefs === "object"
      ? {
        emailReports: prefs.emailReports ?? true,
        rankingAlerts: prefs.rankingAlerts ?? true,
        weeklyDigest: prefs.weeklyDigest ?? false,
        teamUpdates: prefs.teamUpdates ?? true,
      }
      : { emailReports: true, rankingAlerts: true, weeklyDigest: false, teamUpdates: true };

    let specialties: string[] = [];
    if (user.specialties && user.role === "SPECIALIST") {
      try {
        const parsed = JSON.parse(user.specialties);
        specialties = Array.isArray(parsed) ? parsed : [];
      } catch {
        specialties = [];
      }
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      verified: user.verified,
      invited: user.invited,
      notificationPreferences,
      ...(user.role === "SPECIALIST" ? { specialties } : {}),
      clientAccess: {
        clients: user.clientUsers.map((c) => ({
          clientId: c.clientId,
          role: c.clientRole,
          status: c.status,
        })),
      },
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

const notificationSettingsSchema = z.object({
  emailReports: z.boolean().optional(),
  rankingAlerts: z.boolean().optional(),
  weeklyDigest: z.boolean().optional(),
  teamUpdates: z.boolean().optional(),
});

// Update current user notification preferences
router.patch("/me/notification-settings", authenticateToken, async (req, res) => {
  try {
    const body = notificationSettingsSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ message: "Invalid notification settings", errors: body.error.flatten() });
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { notificationPreferences: true },
    });
    if (!user) return res.status(404).json({ message: "User not found" });
    const current = (user.notificationPreferences as Record<string, boolean>) || {};
    const next = {
      emailReports: body.data.emailReports ?? current.emailReports ?? true,
      rankingAlerts: body.data.rankingAlerts ?? current.rankingAlerts ?? true,
      weeklyDigest: body.data.weeklyDigest ?? current.weeklyDigest ?? false,
      teamUpdates: body.data.teamUpdates ?? current.teamUpdates ?? true,
    };
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { notificationPreferences: next },
    });
    return res.json({ notificationPreferences: next });
  } catch (error) {
    console.error("Update notification settings error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// Invite lookup (used by accept-invite signup page)
router.get("/invite", async (req, res) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token) return res.status(400).json({ message: "Missing token" });

    const record = await prisma.token.findUnique({
      where: { token },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    let metadata: any = null;
    try {
      metadata = record.metadata ? JSON.parse(record.metadata) : null;
    } catch {
      metadata = null;
    }

    const clientIds: string[] = Array.isArray(metadata?.clientIds)
      ? metadata.clientIds.map((c: any) => String(c))
      : metadata?.clientId
        ? [String(metadata.clientId)]
        : [];

    // Client user invite: token has metadata.kind === "CLIENT_USER_INVITE" and clientIds
    if (record.type === "INVITE" && metadata?.kind === "CLIENT_USER_INVITE" && clientIds.length > 0) {
      const clients = await prisma.client.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      if (clients.length === 0) return res.status(404).json({ message: "Client not found" });
      return res.json({
        kind: "CLIENT_USER_INVITE",
        email: record.email,
        clients,
      });
    }

    // Team invite: token created by team invite (type INVITE, userId set, no client metadata)
    if (record.type === "INVITE" && record.userId) {
      let agencyName: string | null = null;
      if (record.agencyId) {
        const agency = await prisma.agency.findUnique({
          where: { id: record.agencyId },
          select: { name: true },
        });
        agencyName = agency?.name ?? null;
      }
      return res.json({
        kind: "TEAM_INVITE",
        email: record.email,
        role: record.role || "SPECIALIST",
        agencyName: agencyName || undefined,
      });
    }

    return res.status(400).json({ message: "Unsupported invite token" });
  } catch (error) {
    console.error("Invite lookup error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1),
  password: z.string().min(6),
});

// Accept invite + set password (client user signup)
router.post("/invite/accept", async (req, res) => {
  try {
    const { token, name, password } = acceptInviteSchema.parse(req.body);

    const record = await prisma.token.findUnique({
      where: { token },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    let metadata: any = null;
    try {
      metadata = record.metadata ? JSON.parse(record.metadata) : null;
    } catch {
      metadata = null;
    }

    const clientIds: string[] = Array.isArray(metadata?.clientIds)
      ? metadata.clientIds.map((c: any) => String(c))
      : metadata?.clientId
        ? [String(metadata.clientId)]
        : [];

    // Team invite: token created by team invite (type INVITE, userId set)
    if (record.type === "INVITE" && record.userId) {
      const teamUser = await prisma.user.findUnique({ where: { id: record.userId } });
      if (!teamUser) return res.status(400).json({ message: "User not found" });
      const passwordHash = await bcrypt.hash(password, 12);
      const updated = await prisma.user.update({
        where: { id: record.userId },
        data: {
          name,
          passwordHash,
          verified: true,
          invited: false,
          lastLoginAt: new Date(),
        },
      });
      await prisma.token.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      const jwtToken = jwt.sign(
        { userId: updated.id, email: updated.email, role: updated.role },
        getJwtSecret(),
        { expiresIn: "7d" }
      );
      return res.json({
        token: jwtToken,
        user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role, verified: updated.verified, invited: updated.invited },
        redirect: { type: "TEAM" },
      });
    }

    // Client user invite
    if (record.type !== "INVITE" || metadata?.kind !== "CLIENT_USER_INVITE" || clientIds.length === 0) {
      return res.status(400).json({ message: "Unsupported invite token" });
    }

    // Create or update user (do NOT overwrite password for already-verified users)
    const existingUser = await prisma.user.findUnique({ where: { email: record.email } });
    let user;

    if (existingUser?.verified) {
      user = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          // Preserve existing name unless it's missing
          name: existingUser.name || name,
          invited: false,
          role: "USER",
          lastLoginAt: new Date(),
        },
      });
    } else {
      const passwordHash = await bcrypt.hash(password, 12);
      user = await prisma.user.upsert({
        where: { email: record.email },
        update: {
          name,
          passwordHash,
          verified: true,
          invited: false,
          role: "USER",
          lastLoginAt: new Date(),
        },
        create: {
          email: record.email,
          name,
          passwordHash,
          verified: true,
          invited: false,
          role: "USER",
          lastLoginAt: new Date(),
        },
      });
    }

    const resolvedClientRole = String(metadata?.clientRole || "CLIENT");
    const acceptedAt = new Date();

    // Ensure memberships exist for all invited clients
    for (const clientId of clientIds) {
      await prisma.clientUser.upsert({
        where: { clientId_userId: { clientId, userId: user.id } },
        update: {
          status: "ACTIVE",
          acceptedAt,
        },
        create: {
          clientId,
          userId: user.id,
          clientRole: resolvedClientRole === "STAFF" ? "STAFF" : "CLIENT",
          status: "ACTIVE",
          acceptedAt,
        },
      });
    }

    // Mark token as used
    await prisma.token.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    // Issue login JWT
    const jwtToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      getJwtSecret(),
      { expiresIn: "7d" }
    );

    return res.json({
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        verified: user.verified,
        invited: user.invited,
        clientAccess: { clients: clientIds.map((clientId) => ({ clientId, role: resolvedClientRole === "STAFF" ? "STAFF" : "CLIENT", status: "ACTIVE" })) },
      },
      redirect: { clientId: clientIds[0] },
    });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: error.errors });
    }
    console.error("Accept invite error:", error);
    return res.status(500).json({ message: "Failed to accept invite" });
  }
});

// Verify email
router.post("/verify", async (req, res) => {
  try {
    const { token } = req.body;

    // Find and validate token
    const tokenRecord = await prisma.token.findUnique({
      where: { token },
      include: { user: true },
    });

    if (
      !tokenRecord ||
      tokenRecord.usedAt ||
      tokenRecord.expiresAt < new Date()
    ) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    // Update user as verified
    await prisma.user.update({
      where: { id: tokenRecord.userId! },
      data: { verified: true },
    });

    // Mark token as used
    await prisma.token.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    });

    res.json({ message: "Email verified successfully" });
  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({ message: "Verification failed" });
  }
});

// Get specialists for task assignment
router.get("/specialists", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    if (user.role !== "AGENCY" && user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }

    let rawSpecialists: { id: string; name: string | null; email: string; specialties: string | null }[];
    if (user.role === "SUPER_ADMIN") {
      rawSpecialists = await prisma.user.findMany({
        where: { role: "SPECIALIST" },
        select: { id: true, name: true, email: true, specialties: true }
      });
    } else {
      const userAgency = await prisma.userAgency.findFirst({
        where: { userId: user.userId },
        select: { agencyId: true }
      });
      if (!userAgency) {
        return res.status(404).json({ message: "Agency not found" });
      }
      rawSpecialists = await prisma.user.findMany({
        where: { role: "SPECIALIST" },
        select: { id: true, name: true, email: true, specialties: true }
      });
    }

    const specialists = rawSpecialists.map((u) => {
      let specialties: string[] = [];
      if (u.specialties) {
        try {
          const parsed = JSON.parse(u.specialties);
          specialties = Array.isArray(parsed) ? parsed : [];
        } catch {
          // ignore invalid JSON
        }
      }
      return { id: u.id, name: u.name, email: u.email, specialties };
    });

    res.json(specialists);
  } catch (error) {
    console.error("Error fetching specialists:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Update user profile
const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
});

router.put("/profile", authenticateToken, async (req, res) => {
  try {
    const updateData = updateProfileSchema.parse(req.body);
    const userId = req.user.userId;

    // Check if email is being changed and if it's already taken
    if (updateData.email) {
      const existingUser = await prisma.user.findUnique({
        where: { email: updateData.email },
      });

      if (existingUser && existingUser.id !== userId) {
        return res.status(400).json({ message: "Email already in use" });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    res.json({
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role,
      verified: updatedUser.verified,
      invited: updatedUser.invited,
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: error.errors });
    }
    console.error("Update profile error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Forgot password: request a reset link by email
const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });
    // Always respond with success to avoid leaking whether the email exists
    if (!user || !user.passwordHash) {
      return res.json({ message: "If an account exists with this email, you will receive a reset link shortly." });
    }
    const resetToken = jwt.sign(
      { userId: user.id, purpose: "password_reset" },
      getJwtSecret(),
      { expiresIn: "1h" }
    );
    await prisma.token.create({
      data: {
        type: PASSWORD_RESET,
        email: user.email,
        token: resetToken,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        userId: user.id,
      },
    });
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
    await sendEmail({
      to: user.email,
      subject: "Reset your ZOESI password",
      html: `
        <p>You requested a password reset for your ZOESI account.</p>
        <p><a href="${resetUrl}">Reset your password</a></p>
        <p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
      `,
    }).catch((err) => {
      console.error("Forgot-password email failed:", err?.message);
    });
    return res.json({ message: "If an account exists with this email, you will receive a reset link shortly." });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }
    console.error("Forgot password error:", error);
    return res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

// Validate reset token (for the reset-password page)
router.get("/reset-password", async (req, res) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token) return res.status(400).json({ valid: false, message: "Missing token" });
    const record = await prisma.token.findUnique({ where: { token } });
    if (!record || record.usedAt || record.expiresAt < new Date() || record.type !== PASSWORD_RESET) {
      return res.json({ valid: false, message: "Invalid or expired link" });
    }
    return res.json({ valid: true });
  } catch (error) {
    console.error("Reset token check error:", error);
    return res.status(500).json({ valid: false, message: "Something went wrong" });
  }
});

// Reset password with token (from email link)
const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(6),
});

router.post("/reset-password", async (req, res) => {
  try {
    const { token: resetToken, newPassword } = resetPasswordSchema.parse(req.body);
    const record = await prisma.token.findUnique({
      where: { token: resetToken },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt < new Date() || record.type !== PASSWORD_RESET) {
      return res.status(400).json({ message: "Invalid or expired link. Please request a new reset link." });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: record.userId! },
      data: { passwordHash },
    });
    await prisma.token.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return res.json({ message: "Password updated successfully. You can now sign in." });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input. Password must be at least 6 characters." });
    }
    console.error("Reset password error:", error);
    return res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

// Change password
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

router.put("/password", authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.passwordHash) {
      return res.status(404).json({ message: "User not found or has no password set" });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    res.json({ message: "Password updated successfully" });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: error.errors });
    }
    console.error("Change password error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
