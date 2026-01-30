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

// Get all onboarding templates for the user's agency
router.get("/templates", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    let agencyId: string | undefined;
    if (user.role === "SUPER_ADMIN") {
      // Super admin can see all templates
      let templates = await prisma.onboardingTemplate.findMany({
        include: {
          tasks: {
            orderBy: { order: "asc" }
          }
        }
      });
      // If no templates exist (e.g. fresh DB or no agencies), ensure "Standard SEO Onboarding" is always visible
      if (templates.length === 0) {
        let firstAgency = await prisma.agency.findFirst({ select: { id: true } });
        if (!firstAgency) {
          firstAgency = await prisma.agency.create({
            data: { name: "Default Agency" },
            select: { id: true }
          });
        }
        await ensureDefaultTemplateForAgency(firstAgency.id);
        templates = await prisma.onboardingTemplate.findMany({
          include: { tasks: { orderBy: { order: "asc" } } }
        });
      }
      return res.json(templates);
    } else if (user.role === "AGENCY" || user.role === "ADMIN") {
      // Get user's agency
      const userAgency = await prisma.userAgency.findFirst({
        where: { userId: user.userId },
        include: { agency: true }
      });

      if (userAgency) {
        agencyId = userAgency.agencyId;
      }
      // If no agency linked, we still show "Standard SEO Onboarding" via default agency below (agencyId stays undefined)
    } else {
      return res.status(403).json({ message: "Access denied" });
    }

    // Resolve which agency's templates to show (user's agency or default when none)
    let effectiveAgencyId = agencyId;
    if (effectiveAgencyId == null) {
      let defaultAgency = await prisma.agency.findFirst({ select: { id: true } });
      if (!defaultAgency) {
        defaultAgency = await prisma.agency.create({
          data: { name: "Default Agency" },
          select: { id: true }
        });
      }
      effectiveAgencyId = defaultAgency.id;
    }

    let templates = await prisma.onboardingTemplate.findMany({
      where: { agencyId: effectiveAgencyId },
      include: {
        tasks: {
          orderBy: { order: "asc" }
        }
      }
    });

    // If this agency has no templates, create the default one so "Standard SEO Onboarding" always shows
    if (templates.length === 0) {
      await ensureDefaultTemplateForAgency(effectiveAgencyId);
      templates = await prisma.onboardingTemplate.findMany({
        where: { agencyId: effectiveAgencyId },
        include: {
          tasks: { orderBy: { order: "asc" } }
        }
      });
    }

    res.json(templates);
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
