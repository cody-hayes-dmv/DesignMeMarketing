import express from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { authenticateToken, optionalAuthenticateToken } from "../middleware/auth.js";
import { requireAgencyTrialNotExpired } from "../middleware/requireAgencyTrialNotExpired.js";

const router = express.Router();

router.use(optionalAuthenticateToken, requireAgencyTrialNotExpired);

const activateProjectSchema = z.object({
  clientId: z.string().min(1),
  projectName: z.string().min(1).max(255),
  designerId: z.string().min(1),
});

const createPageSchema = z.object({
  pageName: z.string().min(1).max(255),
  figmaLink: z.string().url().optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
});

const updatePageSchema = z.object({
  pageName: z.string().min(1).max(255).optional(),
  figmaLink: z.string().url().optional().nullable(),
});

const updatePageStatusSchema = z.object({
  status: z.enum(["pending_upload", "needs_review", "revision_requested", "approved"]),
});

const uploadVersionSchema = z.object({
  fileUrl: z.string().url(),
});

const commentSchema = z.object({
  message: z.string().min(1).max(10000),
  parentId: z.string().optional().nullable(),
  notifyUserIds: z.array(z.string().min(1)).optional(),
});

const feedbackSchema = z.object({
  message: z.string().min(1).max(10000),
});

function isAdminRole(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AGENCY";
}

function isNotificationEnabled(notificationPreferences: unknown): boolean {
  if (!notificationPreferences || typeof notificationPreferences !== "object") return true;
  const prefs = notificationPreferences as Record<string, unknown>;
  const value = prefs.webDesign;
  return typeof value === "boolean" ? value : true;
}

function getDeepLink(projectId: string, pageId: string): string {
  return `/web-design/projects/${projectId}/pages/${pageId}`;
}

function toFrontendUrl(path: string): string {
  const base = String(process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "");
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function buildWebDesignEmailHtml(input: {
  projectName: string;
  clientName: string;
  pageName?: string;
  summary: string;
  linkPath: string;
}): string {
  const { projectName, clientName, pageName, summary, linkPath } = input;
  const link = toFrontendUrl(linkPath);
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
      <h3 style="margin: 0 0 10px;">Web Design Update</h3>
      <p style="margin: 0 0 10px;">${summary}</p>
      <p style="margin: 0 0 6px;"><strong>Project:</strong> ${projectName}</p>
      <p style="margin: 0 0 6px;"><strong>Client:</strong> ${clientName}</p>
      ${pageName ? `<p style="margin: 0 0 12px;"><strong>Page:</strong> ${pageName}</p>` : ""}
      <p style="margin: 12px 0 0;">
        <a href="${link}" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 8px 12px; border-radius: 6px;">
          Open in Dashboard
        </a>
      </p>
    </div>
  `;
}

async function getUserAgencyIds(userId: string): Promise<string[]> {
  const memberships = await prisma.userAgency.findMany({
    where: { userId },
    select: { agencyId: true },
  });
  return memberships.map((m) => m.agencyId);
}

async function getAgencyAdminUserIds(agencyId: string | null | undefined): Promise<string[]> {
  if (!agencyId) return [];
  const agencyAdminMemberships = await prisma.userAgency.findMany({
    where: { agencyId },
    select: { userId: true },
  });
  if (agencyAdminMemberships.length === 0) return [];
  const users = await prisma.user.findMany({
    where: {
      id: { in: agencyAdminMemberships.map((m) => m.userId) },
      role: "AGENCY",
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

async function canAccessProject(user: { userId: string; role: string }, projectId: string) {
  const project = await prisma.webDesignProject.findUnique({
    where: { id: projectId },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          belongsToAgencyId: true,
        },
      },
    },
  });
  if (!project) return { project: null, hasAccess: false };

  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") {
    return { project, hasAccess: true };
  }

  if (user.role === "DESIGNER") {
    return { project, hasAccess: project.designerId === user.userId };
  }

  if (user.role === "AGENCY") {
    const agencyIds = await getUserAgencyIds(user.userId);
    const hasAccess = Boolean(project.agencyId && agencyIds.includes(project.agencyId));
    return { project, hasAccess };
  }

  if (user.role === "USER") {
    const membership = await prisma.clientUser.findFirst({
      where: { userId: user.userId, clientId: project.clientId, status: "ACTIVE" },
      select: { id: true },
    });
    return { project, hasAccess: Boolean(membership) };
  }

  return { project, hasAccess: false };
}

async function notifyUsersById(
  userIds: string[],
  subject: string,
  html: string,
  notification: { title: string; message: string; link: string; agencyId?: string | null; type?: string }
) {
  if (userIds.length === 0) return;
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, notificationPreferences: true },
  });
  const enabledUsers = users.filter((u) => isNotificationEnabled(u.notificationPreferences));
  if (enabledUsers.length === 0) return;

  await prisma.notification.createMany({
    data: enabledUsers.map((u) => ({
      userId: u.id,
      agencyId: notification.agencyId ?? null,
      type: notification.type ?? "web_design_activity",
      title: notification.title,
      message: notification.message,
      link: notification.link,
    })),
  }).catch((e) => console.warn("[WebDesign] Notification createMany failed", e?.message));

  for (const u of enabledUsers) {
    if (!u.email) continue;
    sendEmail({ to: u.email, subject, html }).catch((e) =>
      console.warn("[WebDesign] Email send failed", u.email, e?.message)
    );
  }
}

async function getProjectCollaboratorOptionIds(project: {
  agencyId?: string | null;
  designerId: string;
  activatedById: string;
  clientId?: string;
  client?: { id?: string; name?: string; belongsToAgencyId?: string | null; userId?: string | null } | null;
}): Promise<string[]> {
  const ids = new Set<string>([project.designerId, project.activatedById]);
  // Match work-log activity behavior: allow tagging hierarchy/internal peers.
  const internalUsers = await prisma.user.findMany({
    where: {
      role: { in: ["SUPER_ADMIN", "ADMIN", "SPECIALIST"] },
      verified: true,
    },
    select: { id: true },
  });
  internalUsers.forEach((u) => ids.add(u.id));

  // Resolve agency scope from project agencyId first, then fallback via client linkage.
  let agencyScopeId = project.agencyId ?? null;
  if (!agencyScopeId && project.client?.belongsToAgencyId) {
    agencyScopeId = project.client.belongsToAgencyId;
  }
  if (!agencyScopeId && project.clientId) {
    const client = await prisma.client.findUnique({
      where: { id: project.clientId },
      select: { belongsToAgencyId: true, userId: true },
    });
    if (client?.belongsToAgencyId) agencyScopeId = client.belongsToAgencyId;
    if (client?.userId) ids.add(client.userId);
  }

  if (agencyScopeId) {
    const memberships = await prisma.userAgency.findMany({
      where: { agencyId: agencyScopeId },
      select: { userId: true },
    });
    memberships.forEach((m) => ids.add(m.userId));
  }

  // Include active client users for this specific project/client.
  if (project.clientId) {
    const clientUsers = await prisma.clientUser.findMany({
      where: { clientId: project.clientId, status: "ACTIVE" },
      select: { userId: true },
    });
    clientUsers.forEach((cu) => ids.add(cu.userId));
  }

  return [...ids];
}

async function applyPeerRoleTaggingRules(
  actorRole: string,
  candidateUserIds: string[]
): Promise<string[]> {
  const actor = String(actorRole || "").toUpperCase();
  if (candidateUserIds.length === 0) return [];
  if (actor !== "DESIGNER" && actor !== "SPECIALIST") return candidateUserIds;

  const users = await prisma.user.findMany({
    where: { id: { in: candidateUserIds } },
    select: { id: true, role: true },
  });
  const byId = new Map(users.map((u) => [u.id, String(u.role || "").toUpperCase()] as const));

  return candidateUserIds.filter((id) => {
    const targetRole = byId.get(id);
    if (!targetRole) return false;
    if (actor === "DESIGNER" && targetRole === "SPECIALIST") return false;
    if (actor === "SPECIALIST" && targetRole === "DESIGNER") return false;
    return true;
  });
}

// List assignable designers for activation UI
router.get("/designers", authenticateToken, async (req, res) => {
  try {
    if (!["SUPER_ADMIN", "ADMIN", "AGENCY"].includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    if (req.user.role === "SUPER_ADMIN" || req.user.role === "ADMIN") {
      const users = await prisma.user.findMany({
        where: { role: "DESIGNER", verified: true },
        select: { id: true, name: true, email: true },
        orderBy: [{ name: "asc" }],
      });
      return res.json(users);
    }

    const agencyIds = await getUserAgencyIds(req.user.userId);
    if (agencyIds.length === 0) return res.json([]);
    const memberships = await prisma.userAgency.findMany({
      where: { agencyId: { in: agencyIds } },
      select: { userId: true },
    });
    const userIds = [...new Set(memberships.map((m) => m.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, role: "DESIGNER", verified: true },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: "asc" }],
    });
    return res.json(users);
  } catch (error) {
    console.error("List web design designers error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/projects/activate", authenticateToken, async (req, res) => {
  try {
    if (!["SUPER_ADMIN", "ADMIN", "AGENCY"].includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const parsed = activateProjectSchema.parse(req.body);
    const client = await prisma.client.findUnique({
      where: { id: parsed.clientId },
      select: { id: true, name: true, belongsToAgencyId: true },
    });
    if (!client) return res.status(404).json({ message: "Client not found" });

    let agencyIdForProject: string | null = null;
    if (req.user.role === "AGENCY") {
      const agencyIds = await getUserAgencyIds(req.user.userId);
      if (!client.belongsToAgencyId || !agencyIds.includes(client.belongsToAgencyId)) {
        return res.status(403).json({ message: "You can only activate projects for your agency clients." });
      }
      agencyIdForProject = client.belongsToAgencyId;
      const designerMembership = await prisma.userAgency.findFirst({
        where: { userId: parsed.designerId, agencyId: agencyIdForProject },
        select: { id: true },
      });
      if (!designerMembership) {
        return res.status(400).json({ message: "Selected designer is not part of your agency." });
      }
    }

    const designer = await prisma.user.findUnique({
      where: { id: parsed.designerId },
      select: { id: true, role: true },
    });
    if (!designer || designer.role !== "DESIGNER") {
      return res.status(400).json({ message: "Selected user is not a designer." });
    }

    const project = await prisma.webDesignProject.create({
      data: {
        projectName: parsed.projectName.trim(),
        clientId: parsed.clientId,
        activatedById: req.user.userId,
        agencyId: agencyIdForProject,
        designerId: parsed.designerId,
        status: "active",
      },
      include: {
        client: { select: { id: true, name: true } },
        designer: { select: { id: true, name: true, email: true } },
      },
    });
    return res.status(201).json(project);
  } catch (error: any) {
    console.error("Activate web design project error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    return res.status(500).json({ message: "Failed to activate project" });
  }
});

router.get("/projects", authenticateToken, async (req, res) => {
  try {
    const statusQuery = String(req.query.status || "").toLowerCase();
    const statusFilter =
      statusQuery === "active"
        ? { status: "active" as const }
        : statusQuery === "complete"
        ? { status: "complete" as const }
        : undefined;

    if (req.user.role === "SUPER_ADMIN" || req.user.role === "ADMIN") {
      const projects = await prisma.webDesignProject.findMany({
        where: statusFilter,
        include: {
          client: { select: { id: true, name: true } },
          designer: { select: { id: true, name: true, email: true } },
          activatedBy: { select: { id: true, name: true, email: true } },
          pages: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return res.json(projects);
    }

    if (req.user.role === "AGENCY") {
      const agencyIds = await getUserAgencyIds(req.user.userId);
      const projects = await prisma.webDesignProject.findMany({
        where: {
          ...(statusFilter || {}),
          agencyId: { in: agencyIds },
        },
        include: {
          client: { select: { id: true, name: true } },
          designer: { select: { id: true, name: true, email: true } },
          activatedBy: { select: { id: true, name: true, email: true } },
          pages: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return res.json(projects);
    }

    if (req.user.role === "DESIGNER") {
      const projects = await prisma.webDesignProject.findMany({
        where: {
          ...(statusFilter || {}),
          designerId: req.user.userId,
        },
        include: {
          client: { select: { id: true, name: true } },
          designer: { select: { id: true, name: true, email: true } },
          activatedBy: { select: { id: true, name: true, email: true } },
          pages: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return res.json(projects);
    }

    if (req.user.role === "USER") {
      const memberships = await prisma.clientUser.findMany({
        where: { userId: req.user.userId, status: "ACTIVE" },
        select: { clientId: true },
      });
      const clientIds = memberships.map((m) => m.clientId);
      if (clientIds.length === 0) return res.json([]);
      const projects = await prisma.webDesignProject.findMany({
        where: {
          ...(statusFilter || {}),
          clientId: { in: clientIds },
        },
        include: {
          client: { select: { id: true, name: true } },
          designer: { select: { id: true, name: true, email: true } },
          activatedBy: { select: { id: true, name: true, email: true } },
          pages: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return res.json(projects);
    }

    return res.status(403).json({ message: "Access denied" });
  } catch (error) {
    console.error("List web design projects error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/projects/:projectId", authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const access = await canAccessProject(req.user, projectId);
    if (!access.project) return res.status(404).json({ message: "Project not found" });
    if (!access.hasAccess) return res.status(403).json({ message: "Access denied" });

    const project = await prisma.webDesignProject.findUnique({
      where: { id: projectId },
      include: {
        client: { select: { id: true, name: true } },
        designer: { select: { id: true, name: true, email: true } },
        activatedBy: { select: { id: true, name: true, email: true } },
        pages: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            versions: {
              orderBy: { versionNumber: "asc" },
              include: { uploadedBy: { select: { id: true, name: true, email: true } } },
            },
            comments: {
              orderBy: { createdAt: "asc" },
              include: { author: { select: { id: true, name: true, email: true, role: true } } },
            },
          },
        },
      },
    });
    return res.json(project);
  } catch (error) {
    console.error("Get web design project error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/projects/:projectId/collaborator-options", authenticateToken, async (req, res) => {
  try {
    if (!["SUPER_ADMIN", "ADMIN", "AGENCY", "DESIGNER", "USER"].includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { projectId } = req.params;
    const access = await canAccessProject(req.user, projectId);
    if (!access.project) return res.status(404).json({ message: "Project not found" });
    if (!access.hasAccess) return res.status(403).json({ message: "Access denied" });
    const optionIds = await getProjectCollaboratorOptionIds(access.project);
    if (optionIds.length === 0) return res.json([]);
    const filteredOptionIds = await applyPeerRoleTaggingRules(req.user.role, optionIds);
    if (filteredOptionIds.length === 0) return res.json([]);
    const users = await prisma.user.findMany({
      where: {
        id: { in: filteredOptionIds },
        role: { in: ["SUPER_ADMIN", "ADMIN", "AGENCY", "DESIGNER", "SPECIALIST", "USER"] },
      },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
    });
    return res.json(users);
  } catch (error) {
    console.error("List web design collaborator options error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/projects/:projectId/pages", authenticateToken, async (req, res) => {
  try {
    if (!isAdminRole(req.user.role)) {
      return res.status(403).json({ message: "Only admins can add project pages." });
    }
    const { projectId } = req.params;
    const parsed = createPageSchema.parse(req.body);
    const access = await canAccessProject(req.user, projectId);
    if (!access.project) return res.status(404).json({ message: "Project not found" });
    if (!access.hasAccess) return res.status(403).json({ message: "Access denied" });
    if (access.project.status === "complete") {
      return res.status(400).json({ message: "Cannot add pages to a completed project." });
    }

    const lastPage = await prisma.webDesignPage.findFirst({
      where: { projectId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const page = await prisma.webDesignPage.create({
      data: {
        projectId,
        pageName: parsed.pageName.trim(),
        figmaLink: parsed.figmaLink ?? null,
        sortOrder: parsed.sortOrder ?? (lastPage ? lastPage.sortOrder + 1 : 0),
        status: "pending_upload",
      },
    });
    return res.status(201).json(page);
  } catch (error: any) {
    console.error("Create web design page error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    return res.status(500).json({ message: "Failed to create page" });
  }
});

router.patch("/pages/:pageId", authenticateToken, async (req, res) => {
  try {
    if (!["SUPER_ADMIN", "ADMIN", "AGENCY", "DESIGNER"].includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { pageId } = req.params;
    const parsed = updatePageSchema.parse(req.body);
    if (typeof parsed.pageName === "undefined" && typeof parsed.figmaLink === "undefined") {
      return res.status(400).json({ message: "No updates provided." });
    }

    const page = await prisma.webDesignPage.findUnique({
      where: { id: pageId },
      include: { project: true },
    });
    if (!page) return res.status(404).json({ message: "Page not found" });

    const access = await canAccessProject(req.user, page.projectId);
    if (!access.hasAccess) return res.status(403).json({ message: "Access denied" });
    if (page.project.status === "complete") {
      return res.status(400).json({ message: "Cannot edit pages on a completed project." });
    }

    const updated = await prisma.webDesignPage.update({
      where: { id: pageId },
      data: {
        ...(typeof parsed.pageName === "string" ? { pageName: parsed.pageName.trim() } : {}),
        ...(typeof parsed.figmaLink !== "undefined" ? { figmaLink: parsed.figmaLink ?? null } : {}),
      },
    });

    return res.json(updated);
  } catch (error: any) {
    console.error("Update web design page error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    return res.status(500).json({ message: "Failed to update page" });
  }
});

router.patch("/pages/:pageId/status", authenticateToken, async (req, res) => {
  try {
    if (!["SUPER_ADMIN", "DESIGNER", "USER"].includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { pageId } = req.params;
    const parsed = updatePageStatusSchema.parse(req.body);

    const page = await prisma.webDesignPage.findUnique({
      where: { id: pageId },
      include: { project: true },
    });
    if (!page) return res.status(404).json({ message: "Page not found" });

    const access = await canAccessProject(req.user, page.projectId);
    if (!access.hasAccess) return res.status(403).json({ message: "Access denied" });
    if (page.project.status === "complete") {
      return res.status(400).json({ message: "Cannot update status on a completed project." });
    }

    const updated = await prisma.webDesignPage.update({
      where: { id: pageId },
      data: {
        status: parsed.status,
        approvedAt: parsed.status === "approved" ? new Date() : null,
      },
    });

    return res.json(updated);
  } catch (error: any) {
    console.error("Update web design page status error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    return res.status(500).json({ message: "Failed to update page status" });
  }
});

router.post("/pages/:pageId/versions", authenticateToken, async (req, res) => {
  try {
    if (!["SUPER_ADMIN", "ADMIN", "AGENCY", "DESIGNER"].includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { pageId } = req.params;
    const parsed = uploadVersionSchema.parse(req.body);
    const page = await prisma.webDesignPage.findUnique({
      where: { id: pageId },
      include: {
        project: {
          include: {
            client: { select: { id: true, name: true } },
          },
        },
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { versionNumber: true },
        },
      },
    });
    if (!page) return res.status(404).json({ message: "Page not found" });
    const access = await canAccessProject(req.user, page.projectId);
    if (!access.hasAccess) return res.status(403).json({ message: "Access denied" });
    if (page.project.status === "complete") {
      return res.status(400).json({ message: "Cannot upload to a completed project." });
    }
    if (page.status === "approved") {
      return res.status(400).json({ message: "Page is approved and locked." });
    }

    const nextVersion = (page.versions[0]?.versionNumber ?? 0) + 1;
    const version = await prisma.webDesignPageVersion.create({
      data: {
        pageId,
        versionNumber: nextVersion,
        fileUrl: parsed.fileUrl,
        uploadedById: req.user.userId,
      },
    });

    const shouldNotifyClientsOnUpload =
      req.user.role !== "DESIGNER" &&
      req.user.role !== "ADMIN" &&
      req.user.role !== "SUPER_ADMIN";
    if (shouldNotifyClientsOnUpload) {
      const clientUsers = await prisma.clientUser.findMany({
        where: { clientId: page.project.clientId, status: "ACTIVE" },
        select: { userId: true },
      });
      const clientRecipientIds = [...new Set(clientUsers.map((u) => u.userId))];
      if (clientRecipientIds.length > 0) {
        const link = getDeepLink(page.projectId, page.id);
        await notifyUsersById(
          clientRecipientIds,
          `Design ready for review: ${page.pageName}`,
          buildWebDesignEmailHtml({
            projectName: page.project.projectName,
            clientName: page.project.client.name,
            pageName: page.pageName,
            summary: "A new design revision is ready for your review.",
            linkPath: link,
          }),
          {
            title: "New web design revision ready",
            message: `${page.pageName} is ready for your review.`,
            link,
            agencyId: page.project.agencyId,
          }
        );
      }
    }

    return res.status(201).json(version);
  } catch (error: any) {
    console.error("Upload web design version error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    return res.status(500).json({ message: "Failed to upload version" });
  }
});

router.post("/pages/:pageId/mark-ready", authenticateToken, async (req, res) => {
  try {
    if (!["SUPER_ADMIN", "ADMIN", "AGENCY", "DESIGNER"].includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { pageId } = req.params;
    const page = await prisma.webDesignPage.findUnique({
      where: { id: pageId },
      include: {
        project: {
          include: {
            client: { select: { id: true, name: true } },
          },
        },
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (!page) return res.status(404).json({ message: "Page not found" });
    const access = await canAccessProject(req.user, page.projectId);
    if (!access.hasAccess) return res.status(403).json({ message: "Access denied" });
    if (page.project.status === "complete") {
      return res.status(400).json({ message: "Cannot update a page on a completed project." });
    }
    if (page.status === "approved") {
      return res.status(400).json({ message: "Page is approved and locked." });
    }
    if (page.versions.length === 0) {
      return res.status(400).json({ message: "Please upload at least one revision before marking ready." });
    }

    const wasAlreadyReady = page.status === "needs_review";
    if (!wasAlreadyReady) {
      await prisma.webDesignPage.update({
        where: { id: pageId },
        data: { status: "needs_review" },
      });
    }

    if (!wasAlreadyReady) {
      const clientUsers = await prisma.clientUser.findMany({
        where: { clientId: page.project.clientId, status: "ACTIVE" },
        select: { userId: true },
      });
      const clientRecipientIds = [...new Set(clientUsers.map((u) => u.userId))];
      if (clientRecipientIds.length > 0) {
        const link = getDeepLink(page.projectId, page.id);
        await notifyUsersById(
          clientRecipientIds,
          `Design ready for review: ${page.pageName}`,
          buildWebDesignEmailHtml({
            projectName: page.project.projectName,
            clientName: page.project.client.name,
            pageName: page.pageName,
            summary: "A new design revision is ready for your review.",
            linkPath: link,
          }),
          {
            title: "New web design revision ready",
            message: `${page.pageName} is ready for your review.`,
            link,
            agencyId: page.project.agencyId,
          }
        );
      }
    }

    return res.json({
      message: wasAlreadyReady ? "Page is already marked ready for review." : "Page marked ready for client review.",
    });
  } catch (error) {
    console.error("Mark web design page ready error:", error);
    return res.status(500).json({ message: "Failed to mark page ready for review" });
  }
});

router.get("/pages/:pageId/comments", authenticateToken, async (req, res) => {
  try {
    const page = await prisma.webDesignPage.findUnique({
      where: { id: req.params.pageId },
      select: { id: true, projectId: true },
    });
    if (!page) return res.status(404).json({ message: "Page not found" });
    const access = await canAccessProject(req.user, page.projectId);
    if (!access.hasAccess) return res.status(403).json({ message: "Access denied" });

    const comments = await prisma.webDesignComment.findMany({
      where: { pageId: page.id },
      orderBy: { createdAt: "asc" },
      include: {
        author: { select: { id: true, name: true, email: true, role: true } },
      },
    });
    return res.json(comments);
  } catch (error) {
    console.error("List web design comments error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/pages/:pageId/comments", authenticateToken, async (req, res) => {
  try {
    const parsed = commentSchema.parse(req.body);
    const page = await prisma.webDesignPage.findUnique({
      where: { id: req.params.pageId },
      include: {
        project: {
          include: { client: { select: { id: true, name: true } } },
        },
      },
    });
    if (!page) return res.status(404).json({ message: "Page not found" });
    const access = await canAccessProject(req.user, page.projectId);
    if (!access.hasAccess) return res.status(403).json({ message: "Access denied" });
    if (page.status === "approved") {
      return res.status(400).json({ message: "Page is approved and comment thread is locked." });
    }

    if (parsed.parentId) {
      const parent = await prisma.webDesignComment.findUnique({
        where: { id: parsed.parentId },
        select: { id: true, pageId: true },
      });
      if (!parent || parent.pageId !== page.id) {
        return res.status(400).json({ message: "Invalid parent comment." });
      }
    }

    const authorRole = req.user.role === "USER" ? "client" : req.user.role === "DESIGNER" ? "designer" : "admin";
    const notifyUserIds = [...new Set((parsed.notifyUserIds || []).map((v) => String(v || "").trim()).filter(Boolean))];
    const allowedNotifyOptionIds = new Set(await getProjectCollaboratorOptionIds(page.project));
    const roleFilteredNotifyUserIds = await applyPeerRoleTaggingRules(req.user.role, notifyUserIds);
    const safeNotifyUserIds = roleFilteredNotifyUserIds.filter((id) => allowedNotifyOptionIds.has(id));
    const created = await prisma.webDesignComment.create({
      data: {
        pageId: page.id,
        parentId: parsed.parentId ?? null,
        authorId: req.user.userId,
        authorRole,
        message: parsed.message,
      },
      include: {
        author: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    const link = getDeepLink(page.projectId, page.id);
    if (authorRole === "client") {
      const adminRecipientIds = new Set<string>([page.project.designerId, page.project.activatedById]);
      const agencyAdminIds = await getAgencyAdminUserIds(page.project.agencyId);
      agencyAdminIds.forEach((id) => adminRecipientIds.add(id));
      safeNotifyUserIds.forEach((id) => adminRecipientIds.add(id));
      adminRecipientIds.delete(req.user.userId);
      const recipients = [...adminRecipientIds];
      if (recipients.length > 0) {
        await notifyUsersById(
          recipients,
          `Client comment on ${page.pageName}`,
          buildWebDesignEmailHtml({
            projectName: page.project.projectName,
            clientName: page.project.client.name,
            pageName: page.pageName,
            summary: `${page.project.client.name} left a new comment: "${parsed.message}".`,
            linkPath: link,
          }),
          {
            title: "New client web design comment",
            message: `${page.project.client.name} commented on ${page.pageName}.`,
            link,
            agencyId: page.project.agencyId,
          }
        );
      }
    } else {
      const clientUsers = await prisma.clientUser.findMany({
        where: { clientId: page.project.clientId, status: "ACTIVE" },
        select: { userId: true },
      });
      const recipients = [...new Set([
        ...clientUsers.map((u) => u.userId),
        ...safeNotifyUserIds,
      ])].filter((id) => id !== req.user.userId);
      if (recipients.length > 0) {
        await notifyUsersById(
          recipients,
          `Update on ${page.pageName}`,
          buildWebDesignEmailHtml({
            projectName: page.project.projectName,
            clientName: page.project.client.name,
            pageName: page.pageName,
            summary: `A new update was posted: "${parsed.message}".`,
            linkPath: link,
          }),
          {
            title: "Web design page updated",
            message: `${page.pageName} has a new update for you.`,
            link,
            agencyId: page.project.agencyId,
          }
        );
      }
    }

    return res.status(201).json(created);
  } catch (error: any) {
    console.error("Create web design comment error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    return res.status(500).json({ message: "Failed to create comment" });
  }
});

router.post("/pages/:pageId/submit-feedback", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "USER") {
      return res.status(403).json({ message: "Only client users can submit feedback." });
    }
    const parsed = feedbackSchema.parse(req.body);
    const page = await prisma.webDesignPage.findUnique({
      where: { id: req.params.pageId },
      include: {
        project: {
          include: { client: { select: { id: true, name: true } } },
        },
      },
    });
    if (!page) return res.status(404).json({ message: "Page not found" });
    const access = await canAccessProject(req.user, page.projectId);
    if (!access.hasAccess) return res.status(403).json({ message: "Access denied" });
    if (page.status === "approved") {
      return res.status(400).json({ message: "Page is already approved and locked." });
    }

    await prisma.$transaction(async (tx) => {
      await tx.webDesignComment.create({
        data: {
          pageId: page.id,
          authorId: req.user.userId,
          authorRole: "client",
          message: parsed.message,
          actionTaken: "revision_requested",
        },
      });
      await tx.webDesignPage.update({
        where: { id: page.id },
        data: { status: "revision_requested" },
      });
    });

    const adminRecipientIds = new Set<string>([page.project.designerId, page.project.activatedById]);
    const agencyAdminIds = await getAgencyAdminUserIds(page.project.agencyId);
    agencyAdminIds.forEach((id) => adminRecipientIds.add(id));
    adminRecipientIds.delete(req.user.userId);
    const recipientIds = [...adminRecipientIds];
    if (recipientIds.length > 0) {
      const link = getDeepLink(page.projectId, page.id);
      await notifyUsersById(
        recipientIds,
        `Revision requested: ${page.pageName}`,
        buildWebDesignEmailHtml({
          projectName: page.project.projectName,
          clientName: page.project.client.name,
          pageName: page.pageName,
          summary: `${page.project.client.name} requested revisions: "${parsed.message}".`,
          linkPath: link,
        }),
        {
          title: "Client requested revisions",
          message: `${page.project.client.name} requested revisions on ${page.pageName}.`,
          link,
          agencyId: page.project.agencyId,
        }
      );
    }

    return res.json({ message: "Feedback submitted and page marked as revision requested." });
  } catch (error: any) {
    console.error("Submit feedback error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    return res.status(500).json({ message: "Failed to submit feedback" });
  }
});

router.post("/pages/:pageId/approve", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "USER") {
      return res.status(403).json({ message: "Only client users can approve a page." });
    }
    const page = await prisma.webDesignPage.findUnique({
      where: { id: req.params.pageId },
      include: {
        project: {
          include: { client: { select: { id: true, name: true } } },
        },
      },
    });
    if (!page) return res.status(404).json({ message: "Page not found" });
    const access = await canAccessProject(req.user, page.projectId);
    if (!access.hasAccess) return res.status(403).json({ message: "Access denied" });
    if (page.status === "approved") {
      return res.status(400).json({ message: "Page is already approved." });
    }

    await prisma.$transaction(async (tx) => {
      await tx.webDesignComment.create({
        data: {
          pageId: page.id,
          authorId: req.user.userId,
          authorRole: "client",
          message: "Approved this page.",
          actionTaken: "approved",
        },
      });
      await tx.webDesignPage.update({
        where: { id: page.id },
        data: { status: "approved", approvedAt: new Date() },
      });
    });

    const recipientIds = [...new Set([page.project.designerId, page.project.activatedById])].filter(
      (id) => id !== req.user.userId
    );
    if (recipientIds.length > 0) {
      const link = getDeepLink(page.projectId, page.id);
      await notifyUsersById(
        recipientIds,
        `Page approved: ${page.pageName}`,
        buildWebDesignEmailHtml({
          projectName: page.project.projectName,
          clientName: page.project.client.name,
          pageName: page.pageName,
          summary: `${page.project.client.name} approved this page.`,
          linkPath: link,
        }),
        {
          title: "Client approved page",
          message: `${page.project.client.name} approved ${page.pageName}.`,
          link,
          agencyId: page.project.agencyId,
        }
      );
    }

    const counts = await prisma.webDesignPage.groupBy({
      by: ["status"],
      where: { projectId: page.projectId },
      _count: { _all: true },
    });
    const totalPages = counts.reduce((acc, row) => acc + row._count._all, 0);
    const approvedCount = counts
      .filter((row) => row.status === "approved")
      .reduce((acc, row) => acc + row._count._all, 0);
    if (totalPages > 0 && approvedCount === totalPages) {
      const readyRecipientIds = new Set<string>([page.project.designerId, page.project.activatedById]);
      const agencyAdminIds = await getAgencyAdminUserIds(page.project.agencyId);
      agencyAdminIds.forEach((id) => readyRecipientIds.add(id));
      readyRecipientIds.delete(req.user.userId);
      const readyRecipients = [...readyRecipientIds];
      if (readyRecipients.length > 0) {
        const link = `/agency/web-design?projectId=${encodeURIComponent(page.projectId)}`;
        await notifyUsersById(
          readyRecipients,
          `Project ready to complete: ${page.project.projectName}`,
          buildWebDesignEmailHtml({
            projectName: page.project.projectName,
            clientName: page.project.client.name,
            summary: "All pages are approved and the project is ready to be marked complete.",
            linkPath: link,
          }),
          {
            title: "Web design project ready to complete",
            message: `${page.project.projectName} has all pages approved.`,
            link,
            agencyId: page.project.agencyId,
          }
        );
      }
    }

    return res.json({ message: "Page approved." });
  } catch (error) {
    console.error("Approve web design page error:", error);
    return res.status(500).json({ message: "Failed to approve page" });
  }
});

router.post("/projects/:projectId/complete", authenticateToken, async (req, res) => {
  try {
    if (!isAdminRole(req.user.role)) {
      return res.status(403).json({ message: "Only admins can complete projects." });
    }
    const { projectId } = req.params;
    const access = await canAccessProject(req.user, projectId);
    if (!access.project) return res.status(404).json({ message: "Project not found" });
    if (!access.hasAccess) return res.status(403).json({ message: "Access denied" });
    if (access.project.status === "complete") {
      return res.status(400).json({ message: "Project is already complete." });
    }

    const counts = await prisma.webDesignPage.groupBy({
      by: ["status"],
      where: { projectId },
      _count: { _all: true },
    });
    const totalPages = counts.reduce((acc, row) => acc + row._count._all, 0);
    const approvedCount = counts
      .filter((row) => row.status === "approved")
      .reduce((acc, row) => acc + row._count._all, 0);
    if (totalPages === 0 || approvedCount !== totalPages) {
      return res.status(400).json({ message: "All project pages must be approved before completion." });
    }

    const project = await prisma.webDesignProject.update({
      where: { id: projectId },
      data: { status: "complete", completedAt: new Date() },
    });
    return res.json(project);
  } catch (error) {
    console.error("Complete web design project error:", error);
    return res.status(500).json({ message: "Failed to complete project" });
  }
});

router.delete("/projects/:projectId", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Only Super Admin can delete web design projects." });
    }

    const { projectId } = req.params;
    const project = await prisma.webDesignProject.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) return res.status(404).json({ message: "Project not found" });

    await prisma.webDesignProject.delete({
      where: { id: projectId },
    });

    return res.json({ message: "Project deleted." });
  } catch (error) {
    console.error("Delete web design project error:", error);
    return res.status(500).json({ message: "Failed to delete project" });
  }
});

export default router;
