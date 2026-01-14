import express from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

// Get all onboarding templates for the user's agency
router.get("/templates", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    let agencyId;
    if (user.role === "SUPER_ADMIN") {
      // Super admin can see all templates
      const templates = await prisma.onboardingTemplate.findMany({
        include: {
          tasks: {
            orderBy: { order: "asc" }
          }
        }
      });
      return res.json(templates);
    } else if (user.role === "AGENCY" || user.role === "ADMIN") {
      // Get user's agency
      const userAgency = await prisma.userAgency.findFirst({
        where: { userId: user.userId },
        include: { agency: true }
      });
      
      if (!userAgency) {
        return res.status(404).json({ message: "Agency not found" });
      }
      
      agencyId = userAgency.agencyId;
    } else {
      return res.status(403).json({ message: "Access denied" });
    }

    const templates = await prisma.onboardingTemplate.findMany({
      where: { agencyId },
      include: {
        tasks: {
          orderBy: { order: "asc" }
        }
      }
    });

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
