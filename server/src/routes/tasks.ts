import express from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

const proofItemSchema = z.object({
  type: z.enum(["image", "video", "url"]),
  value: z.string().url(), // URL to the file or external URL
  name: z.string().optional(), // Optional name/description
});

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE"]).optional(),
  dueDate: z.coerce.date().optional(), // accepts ISO string or Date
  assigneeId: z.string().optional(),
  clientId: z.string().optional(),
  priority: z.string().optional(),
  estimatedHours: z.number().int().positive().optional(),
  proof: z.array(proofItemSchema).optional(), // Array of proof items
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE"]).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  priority: z.string().optional(),
  estimatedHours: z.number().int().positive().optional(),
  proof: z.array(proofItemSchema).nullable().optional(), // Array of proof items
});

const bulkCreateTaskSchema = z.object({
  tasks: z.array(z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    category: z.string().optional(),
    status: z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE"]).optional(),
    dueDate: z.coerce.date().nullable().optional(),
    assigneeId: z.string().nullable().optional(),
    clientId: z.string().nullable().optional(),
    estimatedHours: z.number().optional(),
    priority: z.string().optional(),
  }))
});

// Common include for consistency
const taskInclude = {
  assignee: { select: { id: true, name: true, email: true } },
  agency: { select: { id: true, name: true } },
  client: { 
    select: { 
      id: true, 
      name: true, 
      domain: true,
      loginUrl: true,
      username: true,
      password: true,
      notes: true
    } 
  },
  // Note: proof is a JSON field, so it's automatically included
};

const commentBodySchema = z.object({
  body: z.string().min(1).max(5000),
});

async function getTaskForAccess(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    include: {
      ...taskInclude,
      // Include client users so client-portal users can be authorized via membership
      client: {
        include: {
          clientUsers: {
            select: { userId: true, status: true },
          },
        },
      },
      agency: {
        include: {
          members: { select: { userId: true } },
        },
      },
    },
  });
}

function canAccessTask(user: any, task: any) {
  const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
  const inAgency = Boolean(task?.agency?.members?.some((m: any) => m.userId === user.userId));
  const inClient = Boolean(
    task?.client?.clientUsers?.some((m: any) => m.userId === user.userId && m.status === "ACTIVE")
  );
  const isClientOwner = task?.client?.userId === user.userId;
  return isAdmin || inAgency || inClient || isClientOwner;
}

// Get tasks
router.get("/", authenticateToken, async (req, res) => {
  try {
    const clientIdParam = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
    let tasks;

    if (req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN") {
      tasks = await prisma.task.findMany({
        where: clientIdParam ? { clientId: clientIdParam } : undefined,
        include: taskInclude,
        orderBy: { createdAt: "desc" },
      });
    } else {
      const memberships = await prisma.userAgency.findMany({
        where: { userId: req.user.userId },
        select: { agencyId: true },
      });

      const agencyIds = memberships.map((m) => m.agencyId);

      tasks = await prisma.task.findMany({
        where: {
          agencyId: { in: agencyIds },
          ...(clientIdParam ? { clientId: clientIdParam } : {}),
        },
        include: taskInclude,
        orderBy: { createdAt: "desc" },
      });
    }

    res.json(tasks);
  } catch (error) {
    console.error("Fetch tasks error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Work log for a client (tasks associated with clientId)
// IMPORTANT: This route must be before "/:id"
router.get("/worklog/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: { select: { agencyId: true } },
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isOwner = client.userId === req.user.userId;

    let hasAccess = isAdmin || isOwner;
    if (!hasAccess) {
      const memberships = await prisma.userAgency.findMany({
        where: { userId: req.user.userId },
        select: { agencyId: true },
      });
      const userAgencyIds = memberships.map((m) => m.agencyId);
      const clientAgencyIds = client.user.memberships.map((m) => m.agencyId);
      hasAccess = clientAgencyIds.some((id) => userAgencyIds.includes(id));
    }
    if (!hasAccess) {
      const clientUser = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(clientUser);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const tasks = await prisma.task.findMany({
      where: { clientId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        status: true,
        proof: true,
        createdAt: true,
        updatedAt: true,
        assignee: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    return res.json(tasks);
  } catch (error) {
    console.error("Fetch client work log error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Task comments: list
// IMPORTANT: Must be before "/:id"
router.get("/:id/comments", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const task = await getTaskForAccess(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (!canAccessTask(req.user, task)) return res.status(403).json({ message: "Access denied" });

    const comments = await prisma.taskComment.findMany({
      where: { taskId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, name: true, email: true } },
      },
    });

    return res.json(comments);
  } catch (error) {
    console.error("Fetch task comments error:", error);
    return res.status(500).json({ message: "Failed to fetch comments" });
  }
});

// Task comments: create
// IMPORTANT: Must be before "/:id"
router.post("/:id/comments", authenticateToken, async (req, res) => {
  try {
    if (req.user.role === "USER") {
      return res.status(403).json({ message: "Access denied" });
    }

    const { id } = req.params;
    const { body } = commentBodySchema.parse(req.body);

    const task = await getTaskForAccess(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (!canAccessTask(req.user, task)) return res.status(403).json({ message: "Access denied" });

    const created = await prisma.taskComment.create({
      data: { taskId: id, authorId: req.user.userId, body },
      select: {
        id: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, name: true, email: true } },
      },
    });

    return res.status(201).json(created);
  } catch (error: any) {
    console.error("Create task comment error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid comment", errors: error.errors });
    }
    return res.status(500).json({ message: "Failed to create comment" });
  }
});

// Task comments: delete (author or admin)
// IMPORTANT: Must be before "/:id"
router.delete("/:id/comments/:commentId", authenticateToken, async (req, res) => {
  try {
    if (req.user.role === "USER") {
      return res.status(403).json({ message: "Access denied" });
    }

    const { id, commentId } = req.params;
    const task = await getTaskForAccess(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (!canAccessTask(req.user, task)) return res.status(403).json({ message: "Access denied" });

    const comment = await prisma.taskComment.findUnique({ where: { id: commentId } });
    if (!comment || comment.taskId !== id) {
      return res.status(404).json({ message: "Comment not found" });
    }

    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isAuthor = comment.authorId === req.user.userId;
    if (!isAdmin && !isAuthor) {
      return res.status(403).json({ message: "Access denied" });
    }

    await prisma.taskComment.delete({ where: { id: commentId } });
    return res.status(204).send();
  } catch (error) {
    console.error("Delete task comment error:", error);
    return res.status(500).json({ message: "Failed to delete comment" });
  }
});


// Get single task
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        ...taskInclude,
        agency: {
          include: {
            members: { select: { userId: true } }, // for permission check
          },
        },
      },
    });

    if (!task) return res.status(404).json({ message: "Task not found" });

    if (!canAccessTask(req.user, task)) {
      return res.status(403).json({ message: "Access denied" });
    }

    // strip heavy agency.members from response
    const { agency, ...rest } = task;
    return res.json({ ...rest, agency: agency ? { id: agency.id, name: agency.name } : null });
  } catch (error) {
    console.error("Get task error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Create task
router.post("/", authenticateToken, async (req, res) => {
  try {
    const parsed = createTaskSchema.parse(req.body);

    // For MVP, create under the first agency the user belongs to,
    // or allow ADMIN/SUPER_ADMIN to pick the first agency in DB.
    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
    });

    let agencyId: string | undefined =
      membership?.agencyId || (req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN" ? (await prisma.agency.findFirst())?.id : undefined);

    // Client-portal users: allow creating tasks only when linked to the client.
    if (!agencyId && req.user.role === "USER") {
      if (!parsed.clientId) {
        return res.status(400).json({ message: "clientId is required for client users" });
      }
      const clientUser = await prisma.clientUser.findFirst({
        where: { clientId: parsed.clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!clientUser) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Attach task to the owning user's first agency if available
      const ownerMembership = await prisma.userAgency.findFirst({
        where: { userId: (await prisma.client.findUnique({ where: { id: parsed.clientId }, select: { userId: true } }))?.userId || "" },
        select: { agencyId: true },
      });
      agencyId = ownerMembership?.agencyId;
    }

    // Work log: when clientId is provided, allow creating without agency (client-only task).
    const isWorkLogFromClient = Boolean(parsed.clientId);
    if (!agencyId && !isWorkLogFromClient) {
      return res.status(400).json({ message: "No agency found or provide a client for work log." });
    }

    const task = await prisma.task.create({
      data: {
        title: parsed.title,
        description: parsed.description,
        category: parsed.category,
        status: parsed.status ?? "TODO",
        dueDate: parsed.dueDate,
        agencyId: agencyId ?? undefined,
        createdById: req.user.userId,
        assigneeId: parsed.assigneeId,
        clientId: parsed.clientId,
        priority: parsed.priority,
        estimatedHours: parsed.estimatedHours,
        proof: parsed.proof ? JSON.stringify(parsed.proof) : undefined,
      },
      include: taskInclude,
    });

    res.status(201).json(task);
  } catch (error: any) {
    console.error("Create task error:", error);
    if (error instanceof z.ZodError) {
      const proofError = error.errors.find((e) => e.path.includes("proof"));
      const message = proofError
        ? "Invalid attachments: each attachment must have a valid URL."
        : "Invalid data";
      return res.status(400).json({ message, errors: error.errors });
    }
    res.status(500).json({ message: "Failed to create task" });
  }
});

// Update task (PUT = replace fields you send)
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = updateTaskSchema.parse(req.body);

    const task = await getTaskForAccess(id);

    if (!task) return res.status(404).json({ message: "Task not found" });

    if (!canAccessTask(req.user, task)) return res.status(403).json({ message: "Access denied" });

    // Handle proof field - ensure it's properly formatted
    const updateData: any = { ...updates };
    if (updates.proof !== undefined) {
      updateData.proof = updates.proof ? JSON.stringify(updates.proof) : null;
    }

    const updatedTask = await prisma.task.update({
      where: { id },
      data: updateData,
      include: taskInclude,
    });

    res.json(updatedTask);
  } catch (error: any) {
    console.error("Update task error:", error);
    if (error instanceof z.ZodError) {
      const proofError = error.errors.find((e) => e.path.includes("proof"));
      const message = proofError
        ? "Invalid attachments: each attachment must have a valid URL."
        : "Invalid data";
      return res.status(400).json({ message, errors: error.errors });
    }
    res.status(500).json({ message: "Failed to update task" });
  }
});

// Partial update: status only (useful for Kanban drag)
router.patch("/:id/status", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = z.object({ status: z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE"]) }).parse(req.body);

    const task = await getTaskForAccess(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (!canAccessTask(req.user, task)) return res.status(403).json({ message: "Access denied" });

    const updated = await prisma.task.update({
      where: { id },
      data: { status },
      include: taskInclude,
    });

    res.json(updated);
  } catch (error) {
    console.error("Patch task status error:", error);
    res.status(500).json({ message: "Failed to update task status" });
  }
});

// Delete task
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const task = await getTaskForAccess(id);
    if (!task) return res.status(404).json({ message: "Task not found" });

    if (!canAccessTask(req.user, task)) return res.status(403).json({ message: "Access denied" });

    await prisma.task.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error("Delete task error:", error);
    res.status(500).json({ message: "Failed to delete task" });
  }
});

// Bulk create tasks (for onboarding templates)
router.post("/bulk", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    if (user.role !== "AGENCY" && user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }

    const { tasks } = bulkCreateTaskSchema.parse(req.body);

    // Get user's agency for task creation
    let agencyId;
    if (user.role === "SUPER_ADMIN") {
      // For super admin, use the first agency
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

    // Create all tasks
    const createdTasks = await prisma.task.createMany({
      data: tasks.map(task => ({
        title: task.title,
        description: task.description,
        category: task.category,
        status: task.status || "TODO",
        dueDate: task.dueDate,
        assigneeId: task.assigneeId,
        clientId: task.clientId,
        agencyId,
        createdById: user.userId,
        estimatedHours: task.estimatedHours,
        priority: task.priority,
      }))
    });

    res.status(201).json({ 
      message: `${createdTasks.count} tasks created successfully`,
      count: createdTasks.count 
    });
  } catch (error) {
    console.error("Bulk create tasks error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    res.status(500).json({ message: "Failed to create tasks" });
  }
});

export default router;
