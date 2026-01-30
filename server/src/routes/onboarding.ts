import express from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

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

const includeTasks = { tasks: { orderBy: { order: "asc" as const } } };

// Get onboarding templates. Client-based: agency/admin see only global template(s). Super admin sees all.
router.get("/templates", authenticateToken, async (req, res) => {
  try {
    const user = req.user;

    await ensureDefaultGlobalTemplate();

    if (user.role === "SUPER_ADMIN") {
      const templates = await prisma.onboardingTemplate.findMany({
        include: includeTasks,
      });
      return res.json(templates);
    }

    // Agency/Admin: onboarding is client-based – only show global template(s), not agency-specific
    if (user.role === "AGENCY" || user.role === "ADMIN") {
      const globalTemplates = await prisma.onboardingTemplate.findMany({
        where: { agencyId: null },
        include: includeTasks,
      });
      return res.json(globalTemplates);
    }

    return res.status(403).json({ message: "Access denied" });
  } catch (error) {
    console.error("Error fetching templates:", error);
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

    const { name, description, isDefault, tasks } = req.body;

    let agencyId;
    if (user.role === "SUPER_ADMIN") {
      // For super admin, use the first agency or create a default one
      const agency = await prisma.agency.findFirst();
      if (!agency) {
        return res.status(400).json({ message: "No agency found" });
      }
      agencyId = agency.id;
    } else {
      const userAgency = await prisma.userAgency.findFirst({
        where: { userId: user.userId }
      });
      
      if (!userAgency) {
        return res.status(404).json({ message: "Agency not found" });
      }
      
      agencyId = userAgency.agencyId;
    }

    const template = await prisma.onboardingTemplate.create({
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
            order: index + 1
          }))
        }
      },
      include: {
        tasks: {
          orderBy: { order: "asc" }
        }
      }
    });

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
    if (user.role !== "SUPER_ADMIN") {
      const userAgency = await prisma.userAgency.findFirst({
        where: { userId: user.userId }
      });
      
      if (!userAgency || userAgency.agencyId !== existingTemplate.agencyId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    // Update template
    const template = await prisma.onboardingTemplate.update({
      where: { id },
      data: {
        name,
        description,
        isDefault: isDefault || false,
        tasks: {
          deleteMany: {}, // Delete existing tasks
          create: tasks.map((task: any, index: number) => ({
            title: task.title,
            description: task.description,
            category: task.category,
            priority: task.priority,
            estimatedHours: task.estimatedHours,
            order: index + 1
          }))
        }
      },
      include: {
        tasks: {
          orderBy: { order: "asc" }
        }
      }
    });

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
    if (user.role !== "SUPER_ADMIN") {
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
