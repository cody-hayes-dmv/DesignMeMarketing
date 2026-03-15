import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { TokenType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { BRAND_DISPLAY_NAME } from "../lib/qualityContracts.js";
import { authenticateToken, getJwtSecret } from "../middleware/auth.js";
import { normalizeDomainHost } from "../lib/domainProvisioning.js";

const router = express.Router();

const PASSWORD_RESET: TokenType = "PASSWORD_RESET" as TokenType;

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(["ADMIN", "AGENCY", "USER", "SPECIALIST"]).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const domainStatusOrder = [
  "NONE",
  "PENDING_VERIFICATION",
  "VERIFIED",
  "SSL_PENDING",
  "ACTIVE",
  "FAILED",
] as const;

type DomainStatus = (typeof domainStatusOrder)[number];

const toDomainStatus = (value: string | null | undefined): DomainStatus => {
  if (!value) return "NONE";
  const upper = value.toUpperCase();
  return (domainStatusOrder as readonly string[]).includes(upper) ? (upper as DomainStatus) : "NONE";
};

const mapAgencyBranding = (agency: any) =>
  agency
    ? {
      agencyId: agency.id,
      brandDisplayName: agency.brandDisplayName ?? agency.name ?? null,
      logoUrl: agency.logoUrl ?? null,
      primaryColor: agency.primaryColor ?? null,
      subdomain: agency.subdomain ?? null,
      customDomain: agency.customDomain ?? null,
      domainStatus: toDomainStatus(agency.domainStatus),
      domainVerifiedAt: agency.domainVerifiedAt ? new Date(agency.domainVerifiedAt).toISOString() : null,
      sslIssuedAt: agency.sslIssuedAt ? new Date(agency.sslIssuedAt).toISOString() : null,
    }
    : null;

const getActiveAgencyMemberships = (memberships: Array<{ agency?: unknown | null }> | undefined | null) =>
  (memberships ?? []).filter((membership) => Boolean(membership?.agency));

const defaultBranding = {
  brandDisplayName: "Your Marketing Dashboard",
  logoUrl: null as string | null,
  primaryColor: "#4f46e5",
};

function resolveHost(req: express.Request): string | null {
  const rawHost = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim()
    .split(":")[0]
    .trim();
  if (!rawHost) return null;
  return normalizeDomainHost(rawHost) || rawHost.toLowerCase();
}

async function resolveAgencyBrandingForHost(host: string | null) {
  if (!host) return null;
  if (host === "localhost" || host === "127.0.0.1") return null;

  // 1) Exact custom domain match (only active).
  const byCustomDomain = await prisma.agency.findFirst({
    where: { customDomain: host, domainStatus: "ACTIVE" as any },
    select: {
      id: true,
      name: true,
      brandDisplayName: true,
      logoUrl: true,
      primaryColor: true,
      subdomain: true,
      customDomain: true,
      domainStatus: true,
    },
  });
  if (byCustomDomain) return mapAgencyBranding(byCustomDomain);

  // 2) Subdomain under primary platform domain.
  const primaryDomain = String(process.env.APP_PRIMARY_DOMAIN || "yourmarketingdashboard.ai").toLowerCase();
  if (host.endsWith(`.${primaryDomain}`)) {
    const subdomain = host.slice(0, host.length - (primaryDomain.length + 1)).trim().toLowerCase();
    if (subdomain && subdomain !== "www" && subdomain !== "app") {
      const bySubdomain = await prisma.agency.findUnique({
        where: { subdomain },
        select: {
          id: true,
          name: true,
          brandDisplayName: true,
          logoUrl: true,
          primaryColor: true,
          subdomain: true,
          customDomain: true,
          domainStatus: true,
        },
      });
      if (bySubdomain) return mapAgencyBranding(bySubdomain);
    }
  }
  return null;
}

// Register
router.post("/register", async (req, res) => {
  try {
    const { email, password, name, role } = registerSchema.parse(req.body);

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
        role: role || "AGENCY",
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

    // Send verification email (non-blocking)
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3001";
    const verifyUrl = `${frontendUrl}/verify?token=${encodeURIComponent(verificationToken)}`;
    await sendEmail({
      to: email,
      subject: `Verify your email - ${BRAND_DISPLAY_NAME}`,
      html: `
        <h1>Welcome to ${BRAND_DISPLAY_NAME}!</h1>
        <p>Please verify your email by clicking the link below:</p>
        <p><a href="${verifyUrl}">Verify my email</a></p>
        <p>If the link doesn't work, copy and paste this URL into your browser:</p>
        <p style="word-break:break-all">${verifyUrl}</p>
      `,
    }).catch((emailErr) => {
      console.warn("Register verification email failed:", (emailErr as any)?.message || emailErr);
    });

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

    const activeAgencyMemberships = getActiveAgencyMemberships(user.memberships);
    if (user.role === "AGENCY" && activeAgencyMemberships.length === 0) {
      return res.status(403).json({
        message: "Your agency account is no longer active. Please contact support.",
      });
    }

    // Track last login time (useful for client user lists)
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    let clientUsers = user.clientUsers ?? [];
    if (user.role === "USER" && clientUsers.length === 0) {
      const pendingCount = await prisma.clientUser.count({
        where: { userId: user.id, status: "PENDING" },
      });
      if (pendingCount > 0) {
        const acceptedAt = new Date();
        await prisma.clientUser.updateMany({
          where: { userId: user.id, status: "PENDING" },
          data: { status: "ACTIVE", acceptedAt },
        });
        clientUsers = await prisma.clientUser.findMany({
          where: { userId: user.id, status: "ACTIVE" },
          select: { clientId: true, clientRole: true, status: true },
        });
      }
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      getJwtSecret(),
      { expiresIn: "7d" }
    );
    const primaryAgency = activeAgencyMemberships[0]?.agency ?? null;
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        profileImageUrl: (user as any).profileImageUrl ?? null,
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
        agencyBranding: mapAgencyBranding(primaryAgency),
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
      return res.status(401).json({ message: "User not found" });
    }

    const activeAgencyMemberships = getActiveAgencyMemberships(user.memberships);
    if (user.role === "AGENCY" && activeAgencyMemberships.length === 0) {
      return res.status(403).json({
        message: "Your agency account is no longer active. Please contact support.",
      });
    }

    const prefs = user.notificationPreferences as Record<string, boolean> | null;
    const notificationPreferences = prefs && typeof prefs === "object"
      ? {
        emailReports: prefs.emailReports ?? true,
        rankingAlerts: prefs.rankingAlerts ?? true,
        weeklyDigest: prefs.weeklyDigest ?? false,
        teamUpdates: prefs.teamUpdates ?? true,
        webDesign: prefs.webDesign ?? true,
      }
      : { emailReports: true, rankingAlerts: true, weeklyDigest: false, teamUpdates: true, webDesign: true };

    let specialties: string[] = [];
    if (user.specialties && user.role === "SPECIALIST") {
      try {
        const parsed = JSON.parse(user.specialties);
        specialties = Array.isArray(parsed) ? parsed : [];
      } catch {
        specialties = [];
      }
    }

    let clientUsers = user.clientUsers ?? [];
    if (user.role === "USER" && clientUsers.length === 0) {
      const pendingCount = await prisma.clientUser.count({
        where: { userId: user.id, status: "PENDING" },
      });
      if (pendingCount > 0) {
        const acceptedAt = new Date();
        await prisma.clientUser.updateMany({
          where: { userId: user.id, status: "PENDING" },
          data: { status: "ACTIVE", acceptedAt },
        });
        clientUsers = await prisma.clientUser.findMany({
          where: { userId: user.id, status: "ACTIVE" },
          select: { clientId: true, clientRole: true, status: true },
        });
      }
    }

    const primaryAgency = activeAgencyMemberships[0]?.agency ?? null;
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      profileImageUrl: (user as any).profileImageUrl ?? null,
      role: user.role,
      verified: user.verified,
      invited: user.invited,
      notificationPreferences,
      ...(user.role === "SPECIALIST" ? { specialties } : {}),
      clientAccess: {
        clients: clientUsers.map((c) => ({
          clientId: c.clientId,
          role: c.clientRole,
          status: c.status,
        })),
      },
      agencyBranding: mapAgencyBranding(primaryAgency),
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Public branding resolved by host (custom domain or agency subdomain).
router.get("/branding", async (req, res) => {
  try {
    const host = resolveHost(req);
    const agencyBranding = await resolveAgencyBrandingForHost(host);
    return res.json({
      ...defaultBranding,
      agencyBranding,
      host: host || null,
    });
  } catch (error) {
    console.error("Get public branding error:", error);
    return res.json({
      ...defaultBranding,
      agencyBranding: null,
      host: null,
    });
  }
});

const notificationSettingsSchema = z.object({
  emailReports: z.boolean().optional(),
  rankingAlerts: z.boolean().optional(),
  weeklyDigest: z.boolean().optional(),
  teamUpdates: z.boolean().optional(),
  webDesign: z.boolean().optional(),
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
      webDesign: body.data.webDesign ?? current.webDesign ?? true,
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

    const verifiedPayload = (() => {
      try {
        return jwt.verify(token, getJwtSecret()) as Record<string, unknown>;
      } catch {
        return null;
      }
    })();

    if (!record && !verifiedPayload) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    if (record && record.expiresAt < new Date()) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    let metadata: any = null;
    try {
      metadata = record?.metadata ? JSON.parse(record.metadata) : null;
    } catch {
      metadata = null;
    }

    const tokenPayload = ((record ? jwt.decode(record.token) : null) || verifiedPayload || {}) as Record<string, unknown>;
    const inviteKind = String(metadata?.kind || tokenPayload?.kind || "");

    const clientIds: string[] = Array.isArray(metadata?.clientIds)
      ? metadata.clientIds.map((c: any) => String(c))
      : metadata?.clientId
        ? [String(metadata.clientId)]
        : Array.isArray(tokenPayload?.clientIds)
          ? (tokenPayload.clientIds as unknown[]).map((c) => String(c))
          : tokenPayload?.clientId
            ? [String(tokenPayload.clientId)]
            : [];

    const recordType = record?.type ?? "INVITE";
    const isClientUserInvite = recordType === "INVITE" && (inviteKind === "CLIENT_USER_INVITE" || clientIds.length > 0);

    // Client user invite: prefer explicit kind, but also support legacy tokens that only carry clientId/clientIds.
    if (isClientUserInvite && clientIds.length > 0) {
      const clients = await prisma.client.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      if (clients.length === 0) return res.status(404).json({ message: "Client not found" });
      return res.json({
        kind: "CLIENT_USER_INVITE",
        email: String(record?.email || tokenPayload?.email || ""),
        clients,
        used: Boolean(record?.usedAt),
      });
    }

    // Team invite: token created by team invite (type INVITE, userId set, non-client invite kind)
    if (record && record.type === "INVITE" && record.userId && !isClientUserInvite) {
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

    const tokenPayload = (jwt.decode(record.token) || {}) as Record<string, unknown>;
    const inviteKind = String(metadata?.kind || tokenPayload?.kind || "");

    const clientIds: string[] = Array.isArray(metadata?.clientIds)
      ? metadata.clientIds.map((c: any) => String(c))
      : metadata?.clientId
        ? [String(metadata.clientId)]
        : Array.isArray(tokenPayload?.clientIds)
          ? (tokenPayload.clientIds as unknown[]).map((c) => String(c))
          : tokenPayload?.clientId
            ? [String(tokenPayload.clientId)]
        : [];

    const isClientUserInvite = record.type === "INVITE" && (inviteKind === "CLIENT_USER_INVITE" || clientIds.length > 0);

    // Client user invite: prefer explicit kind, but also support legacy tokens that only carry clientId/clientIds.
    if (isClientUserInvite && clientIds.length > 0) {
      // Prefer the exact invited userId from the token to avoid drifting to a different account with the same email.
      const invitedUserById = record.userId
        ? await prisma.user.findUnique({ where: { id: record.userId } })
        : null;
      const existingUser = invitedUserById ?? (await prisma.user.findUnique({ where: { email: record.email } }));
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

      const resolvedClientRole = String(metadata?.clientRole || tokenPayload?.clientRole || "CLIENT");
      const acceptedAt = new Date();

      // Ensure memberships exist for all invited clients and are activated immediately after acceptance.
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
    }

    // Team invite: token created by team invite (type INVITE, userId set, non-client invite kind)
    if (record.type === "INVITE" && record.userId && !isClientUserInvite) {
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

    return res.status(400).json({ message: "Unsupported invite token" });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: error.errors });
    }
    console.error("Accept invite error:", error);
    return res.status(500).json({ message: "Failed to accept invite" });
  }
});

// Verify email – marks user verified and returns JWT so frontend can auto-log in
router.post("/verify", async (req, res) => {
  try {
    const { token } = req.body;

    // Find and validate token
    const tokenRecord = await prisma.token.findUnique({
      where: { token },
      include: {
        user: {
          include: {
            clientUsers: {
              where: { status: "ACTIVE" },
              select: { clientId: true, clientRole: true, status: true },
            },
          },
        },
      },
    });

    if (
      !tokenRecord ||
      tokenRecord.usedAt ||
      tokenRecord.expiresAt < new Date()
    ) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    const user = tokenRecord.user;
    if (!user) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    // Update user as verified
    await prisma.user.update({
      where: { id: user.id },
      data: { verified: true },
    });

    // Mark token as used
    await prisma.token.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    });

    // Return JWT so frontend can auto-log in without redirecting to login page
    const jwtToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      getJwtSecret(),
      { expiresIn: "7d" }
    );

    const clientUsers = user.clientUsers ?? [];
    res.json({
      message: "Email verified successfully",
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        verified: true,
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
    if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") {
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
      subject: `Reset your ${BRAND_DISPLAY_NAME} password`,
      html: `
        <p>You requested a password reset for your ${BRAND_DISPLAY_NAME} account.</p>
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

const emailDeliverabilityTestSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200).optional(),
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

// Deliverability diagnostic: send a test invite-style email and return metadata.
router.post("/email-deliverability-test", authenticateToken, async (req, res) => {
  try {
    const requesterRole = String(req.user?.role || "");
    if (requesterRole !== "SUPER_ADMIN" && requesterRole !== "ADMIN" && requesterRole !== "AGENCY") {
      return res.status(403).json({ message: "Access denied" });
    }

    const { to, subject } = emailDeliverabilityTestSchema.parse(req.body || {});
    const frontendUrl = String(process.env.FRONTEND_URL || "http://localhost:3001").trim();
    const sampleUrl = `${frontendUrl}/invite?token=deliverability-test`;
    const finalSubject = subject || `${BRAND_DISPLAY_NAME} email deliverability test`;

    const sendResult = await sendEmail({
      to,
      subject: finalSubject,
      html: `
        <h1>${BRAND_DISPLAY_NAME} - Deliverability Test</h1>
        <p>This is a diagnostic test email from your dashboard.</p>
        <p>If this lands in spam/junk, your sending domain/authentication likely needs adjustment.</p>
        <p>Sample invite-style link: <a href="${sampleUrl}">${sampleUrl}</a></p>
        <p style="color:#6b7280;font-size:12px;">Sent at: ${new Date().toISOString()}</p>
      `,
    });

    const smtpFromRaw = String(process.env.SMTP_FROM || "").trim();
    const smtpUserRaw = String(process.env.SMTP_USER || "").trim();
    const extractDomain = (value: string): string | null => {
      if (!value) return null;
      const emailMatch = value.match(/<([^>]+)>/);
      const email = (emailMatch?.[1] || value).trim().toLowerCase();
      const atIdx = email.lastIndexOf("@");
      if (atIdx < 0 || atIdx === email.length - 1) return null;
      return email.slice(atIdx + 1);
    };

    const fromDomain = extractDomain(sendResult?.from || smtpFromRaw);
    const smtpUserDomain = extractDomain(smtpUserRaw);

    return res.json({
      success: true,
      message: "Deliverability test email sent",
      email: {
        to,
        subject: finalSubject,
        messageId: sendResult?.messageId || null,
        from: sendResult?.from || null,
        replyTo: sendResult?.replyTo || null,
      },
      diagnostics: {
        emailDisabled: String(process.env.EMAIL_DISABLED || "false").toLowerCase() === "true",
        smtpHostConfigured: Boolean(process.env.SMTP_HOST),
        smtpPortConfigured: Boolean(process.env.SMTP_PORT),
        smtpUserConfigured: Boolean(process.env.SMTP_USER),
        smtpFromConfigured: Boolean(process.env.SMTP_FROM),
        fromDomain,
        smtpUserDomain,
        fromMatchesSmtpUserDomain: Boolean(fromDomain && smtpUserDomain && fromDomain === smtpUserDomain),
        recommendation:
          fromDomain && smtpUserDomain && fromDomain !== smtpUserDomain
            ? "SMTP_FROM domain differs from SMTP_USER domain. Align domains and ensure SPF/DKIM/DMARC are configured."
            : "Check SPF, DKIM, DMARC for the sending domain and monitor mailbox placement.",
      },
    });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: error.errors });
    }
    console.error("Email deliverability test error:", error);
    return res.status(500).json({ message: error?.message || "Failed to send deliverability test email" });
  }
});

export default router;
