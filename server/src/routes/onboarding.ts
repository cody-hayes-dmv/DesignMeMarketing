import express from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authenticateToken, optionalAuthenticateToken } from "../middleware/auth.js";
import { requireAgencyTrialNotExpired } from "../middleware/requireAgencyTrialNotExpired.js";

const router = express.Router();

// Restrict agency users with expired trial
router.use(optionalAuthenticateToken, requireAgencyTrialNotExpired);

// Default onboarding tasks used when ensuring an agency has at least one template
const DEFAULT_ONBOARDING_TASKS = [
  { title: "Collect logins", description: null, category: "Onboarding", priority: "high", estimatedHours: 1, order: 1 },
  { title: "Set up GHL", description: null, category: "Onboarding", priority: "high", estimatedHours: 1, order: 2 },
  { title: "Set up Claude project", description: null, category: "Onboarding", priority: "high", estimatedHours: 1, order: 3 },
  { title: "Master input", description: null, category: "Onboarding", priority: "high", estimatedHours: 1, order: 4 },
  { title: "Keyword and map pack research", description: null, category: "Research", priority: "high", estimatedHours: 1, order: 5 },
  { title: "Technical audit", description: null, category: "Technical SEO", priority: "high", estimatedHours: 1, order: 6 },
  { title: "GBP categories research", description: null, category: "GBP", priority: "medium", estimatedHours: 1, order: 7 },
  { title: "GBP services research", description: null, category: "GBP", priority: "medium", estimatedHours: 1, order: 8 },
  { title: "Create avatar", description: null, category: "Strategy", priority: "medium", estimatedHours: 1, order: 9 },
  { title: "Keyword research", description: null, category: "Research", priority: "high", estimatedHours: 1, order: 10 },
  { title: "SEO content gap analysis", description: null, category: "Research", priority: "medium", estimatedHours: 1, order: 11 },
  { title: "Site hierarchy", description: null, category: "Architecture", priority: "medium", estimatedHours: 1, order: 12 },
  { title: "Internal linking structure", description: null, category: "Architecture", priority: "medium", estimatedHours: 1, order: 13 },
  { title: "SEO silo architecture", description: null, category: "Architecture", priority: "medium", estimatedHours: 1, order: 14 },
  { title: "12-month content building plan", description: null, category: "Content", priority: "medium", estimatedHours: 1, order: 15 },
  { title: "Create 12-month roadmap", description: null, category: "Strategy", priority: "medium", estimatedHours: 1, order: 16 },
  { title: "Map pack optimization", description: null, category: "Local SEO", priority: "medium", estimatedHours: 1, order: 17 },
  { title: "Update all GBP categories", description: null, category: "GBP", priority: "medium", estimatedHours: 1, order: 18 },
  { title: "Update all GBP services", description: null, category: "GBP", priority: "medium", estimatedHours: 1, order: 19 },
  { title: "Complete entire GBP profile", description: null, category: "GBP", priority: "high", estimatedHours: 1, order: 20 },
];

/** Global template (no agency) – shown to everyone. No "Default Agency" is created. */
async function ensureDefaultGlobalTemplate() {
  const existing = await prisma.onboardingTemplate.findFirst({ where: { agencyId: null } });
  if (existing) return;
  try {
    await prisma.onboardingTemplate.create({
      data: {
        name: "Standard SEO Onboarding",
        description: "Default template for new SEO clients",
        isDefault: true,
        agencyId: null,
        tasks: {
          create: DEFAULT_ONBOARDING_TASKS.map((t) => ({
            title: t.title,
            description: t.description,
            category: t.category,
            priority: t.priority,
            estimatedHours: t.estimatedHours,
            order: t.order,
          })),
        },
      },
    });
  } catch (error: any) {
    // Backward compatibility: older DBs may require non-null agencyId for onboarding_templates.
    // In that case, ensure each agency has its own default template instead of failing the endpoint.
    const agencies = await prisma.agency.findMany({ select: { id: true } });
    for (const a of agencies) {
      await ensureDefaultTemplateForAgency(a.id);
    }
  }
}

async function ensureDefaultTemplateForAgency(agencyId: string) {
  const existing = await prisma.onboardingTemplate.findFirst({ where: { agencyId } });
  if (existing) return;
  await prisma.onboardingTemplate.create({
    data: {
      name: "Standard SEO Onboarding",
      description: "Default template for new SEO clients",
      isDefault: true,
      agencyId,
      tasks: {
        create: DEFAULT_ONBOARDING_TASKS.map((t) => ({
          title: t.title,
          description: t.description,
          category: t.category,
          priority: t.priority,
          estimatedHours: t.estimatedHours,
          order: t.order,
        })),
      },
    },
  });
}

const taskSelectWithDueDays = {
  id: true,
  title: true,
  description: true,
  category: true,
  priority: true,
  estimatedHours: true,
  dueDate: true,
  dueDaysAfterStart: true,
  order: true,
};

const taskSelectWithoutDueDays = {
  id: true,
  title: true,
  description: true,
  category: true,
  priority: true,
  estimatedHours: true,
  dueDate: true,
  order: true,
};

const includeTasksWithDueDays = {
  tasks: { orderBy: { order: "asc" as const }, select: taskSelectWithDueDays },
};

const includeTasksWithoutDueDays = {
  tasks: { orderBy: { order: "asc" as const }, select: taskSelectWithoutDueDays },
};

function isUnknownDueDaysAfterStartArg(error: any): boolean {
  const msg = String(error?.message || "");
  return (
    msg.includes("Unknown argument `dueDaysAfterStart`") ||
    msg.includes("Unknown field `dueDaysAfterStart`")
  );
}

function isMissingDueDaysAfterStartColumn(error: any): boolean {
  const msg = String(error?.message || "");
  const col = String(error?.meta?.column || "");
  return (
    (error?.code === "P2022" && col.includes("onboarding_tasks.due_days_after_start")) ||
    msg.includes("due_days_after_start")
  );
}

function canFallbackDueDaysAfterStart(error: any): boolean {
  return isUnknownDueDaysAfterStartArg(error) || isMissingDueDaysAfterStartColumn(error);
}

// Get onboarding templates. Client-based: agency/admin see only global template(s). Super admin sees all.
router.get("/templates", authenticateToken, async (req, res) => {
  try {
    const user = req.user;

    await ensureDefaultGlobalTemplate();

    if (user.role === "SUPER_ADMIN") {
      let templates;
      try {
        templates = await prisma.onboardingTemplate.findMany({
          include: includeTasksWithDueDays,
        });
      } catch (error: any) {
        if (!canFallbackDueDaysAfterStart(error)) throw error;
        templates = await prisma.onboardingTemplate.findMany({
          include: includeTasksWithoutDueDays,
        });
      }
      if ((templates?.length ?? 0) === 0) {
        const firstAgency = await prisma.agency.findFirst({ select: { id: true } });
        if (firstAgency?.id) {
          await ensureDefaultTemplateForAgency(firstAgency.id);
          templates = await prisma.onboardingTemplate.findMany({
            include: includeTasksWithoutDueDays,
          });
        }
      }
      return res.json(templates);
    }

    // Agency/Admin: show global templates + this agency's templates (for use in Create onboarding task)
    if (user.role === "AGENCY" || user.role === "ADMIN") {
      const userAgency = await prisma.userAgency.findFirst({
        where: { userId: user.userId },
      });
      const agencyId = userAgency?.agencyId ?? undefined;
      const where = agencyId
        ? { OR: [{ agencyId: null }, { agencyId }] }
        : { agencyId: null };
      let templates;
      try {
        templates = await prisma.onboardingTemplate.findMany({
          where,
          include: includeTasksWithDueDays,
        });
      } catch (error: any) {
        if (!canFallbackDueDaysAfterStart(error)) throw error;
        templates = await prisma.onboardingTemplate.findMany({
          where,
          include: includeTasksWithoutDueDays,
        });
      }
      if ((templates?.length ?? 0) === 0 && agencyId) {
        await ensureDefaultTemplateForAgency(agencyId);
        templates = await prisma.onboardingTemplate.findMany({
          where: { OR: [{ agencyId: null }, { agencyId }] },
          include: includeTasksWithoutDueDays,
        });
      }
      return res.json(templates);
    }

    return res.status(403).json({ message: "Access denied" });
  } catch (error) {
    console.error("Error fetching templates:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get templates the current user can manage (edit/delete). Used by Settings > Templates.
// SUPER_ADMIN: all templates. AGENCY/ADMIN: only templates belonging to their agency.
router.get("/templates/manageable", authenticateToken, async (req, res) => {
  try {
    const user = req.user;

    if (user.role === "SUPER_ADMIN") {
      let templates;
      try {
        templates = await prisma.onboardingTemplate.findMany({
          include: { ...includeTasksWithDueDays, agency: { select: { id: true, name: true } } },
        });
      } catch (error: any) {
        if (!canFallbackDueDaysAfterStart(error)) throw error;
        templates = await prisma.onboardingTemplate.findMany({
          include: { ...includeTasksWithoutDueDays, agency: { select: { id: true, name: true } } },
        });
      }
      return res.json(templates);
    }

    if (user.role === "AGENCY" || user.role === "ADMIN") {
      const userAgency = await prisma.userAgency.findFirst({
        where: { userId: user.userId },
      });
      if (!userAgency) {
        return res.json([]);
      }
      let templates;
      try {
        templates = await prisma.onboardingTemplate.findMany({
          where: { agencyId: userAgency.agencyId },
          include: includeTasksWithDueDays,
        });
      } catch (error: any) {
        if (!canFallbackDueDaysAfterStart(error)) throw error;
        templates = await prisma.onboardingTemplate.findMany({
          where: { agencyId: userAgency.agencyId },
          include: includeTasksWithoutDueDays,
        });
      }
      return res.json(templates);
    }

    return res.status(403).json({ message: "Access denied" });
  } catch (error) {
    console.error("Error fetching manageable templates:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Create a new onboarding template
router.post("/templates", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    if (user.role !== "AGENCY" && user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }

    const { name, description, isDefault, tasks, agencyId: bodyAgencyId } = req.body;

    let agencyId: string | null;
    if (user.role === "SUPER_ADMIN") {
      // Super admin can create global (null) or assign to an agency
      if (bodyAgencyId === null || bodyAgencyId === "") {
        agencyId = null;
      } else if (typeof bodyAgencyId === "string") {
        const agency = await prisma.agency.findUnique({ where: { id: bodyAgencyId } });
        if (!agency) {
          return res.status(400).json({ message: "Agency not found" });
        }
        agencyId = bodyAgencyId;
      } else {
        const agency = await prisma.agency.findFirst();
        if (!agency) {
          return res.status(400).json({ message: "No agency found" });
        }
        agencyId = agency.id;
      }
    } else {
      const userAgency = await prisma.userAgency.findFirst({
        where: { userId: user.userId }
      });
      
      if (!userAgency) {
        return res.status(404).json({ message: "Agency not found" });
      }
      
      agencyId = userAgency.agencyId;
    }

    let template;
    try {
      template = await prisma.onboardingTemplate.create({
        data: {
          name,
          description,
          isDefault: isDefault || false,
          agencyId,
          tasks: {
            create: tasks.map((task: any, index: number) => ({
              title: task.title,
              description: task.description,
              category: task.category,
              priority: task.priority,
              estimatedHours: task.estimatedHours,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              dueDaysAfterStart:
                task.dueDaysAfterStart === null || task.dueDaysAfterStart === undefined || task.dueDaysAfterStart === ""
                  ? null
                  : Math.max(0, Number(task.dueDaysAfterStart)),
              order: index + 1
            }))
          }
        },
        include: includeTasksWithDueDays
      });
    } catch (error: any) {
      if (!canFallbackDueDaysAfterStart(error)) throw error;
      // Backward compatibility when Prisma client/database is not synced yet.
      template = await prisma.onboardingTemplate.create({
        data: {
          name,
          description,
          isDefault: isDefault || false,
          agencyId,
          tasks: {
            create: tasks.map((task: any, index: number) => ({
              title: task.title,
              description: task.description,
              category: task.category,
              priority: task.priority,
              estimatedHours: task.estimatedHours,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              order: index + 1
            }))
          }
        },
        include: includeTasksWithoutDueDays
      });
    }

    res.status(201).json(template);
  } catch (error) {
    console.error("Error creating template:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Update an onboarding template
router.put("/templates/:id", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;
    const { name, description, isDefault, tasks } = req.body;

    if (user.role !== "AGENCY" && user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }

    // Check if template exists and user has access
    const existingTemplate = await prisma.onboardingTemplate.findUnique({
      where: { id },
      include: { agency: true }
    });

    if (!existingTemplate) {
      return res.status(404).json({ message: "Template not found" });
    }

    // Check permissions
    if (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
      const userAgency = await prisma.userAgency.findFirst({
        where: { userId: user.userId }
      });
      
      if (!userAgency || userAgency.agencyId !== existingTemplate.agencyId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    // Update template
    let template;
    try {
      template = await prisma.onboardingTemplate.update({
        where: { id },
        data: {
          name,
          description,
          isDefault: isDefault || false,
          tasks: {
            deleteMany: {},
            create: tasks.map((task: any, index: number) => ({
              title: task.title,
              description: task.description,
              category: task.category,
              priority: task.priority,
              estimatedHours: task.estimatedHours,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              dueDaysAfterStart:
                task.dueDaysAfterStart === null || task.dueDaysAfterStart === undefined || task.dueDaysAfterStart === ""
                  ? null
                  : Math.max(0, Number(task.dueDaysAfterStart)),
              order: index + 1
            }))
          }
        },
        include: includeTasksWithDueDays
      });
    } catch (error: any) {
      if (!canFallbackDueDaysAfterStart(error)) throw error;
      // Backward compatibility when Prisma client/database is not synced yet.
      template = await prisma.onboardingTemplate.update({
        where: { id },
        data: {
          name,
          description,
          isDefault: isDefault || false,
          tasks: {
            deleteMany: {},
            create: tasks.map((task: any, index: number) => ({
              title: task.title,
              description: task.description,
              category: task.category,
              priority: task.priority,
              estimatedHours: task.estimatedHours,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              order: index + 1
            }))
          }
        },
        include: includeTasksWithoutDueDays
      });
    }

    res.json(template);
  } catch (error) {
    console.error("Error updating template:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Delete an onboarding template
router.delete("/templates/:id", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;

    if (user.role !== "AGENCY" && user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }

    // Check if template exists and user has access
    const existingTemplate = await prisma.onboardingTemplate.findUnique({
      where: { id },
      include: { agency: true }
    });

    if (!existingTemplate) {
      return res.status(404).json({ message: "Template not found" });
    }

    // Check permissions
    if (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
      const userAgency = await prisma.userAgency.findFirst({
        where: { userId: user.userId }
      });
      
      if (!userAgency || userAgency.agencyId !== existingTemplate.agencyId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    await prisma.onboardingTemplate.delete({
      where: { id }
    });

    res.json({ message: "Template deleted successfully" });
  } catch (error) {
    console.error("Error deleting template:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
