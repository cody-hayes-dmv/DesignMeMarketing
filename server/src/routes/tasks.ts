import express from "express";
import { z } from "zod";
import type { TaskStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { authenticateToken, optionalAuthenticateToken } from "../middleware/auth.js";
import { requireAgencyTrialNotExpired } from "../middleware/requireAgencyTrialNotExpired.js";

const router = express.Router();

// Restrict agency users with expired trial
router.use(optionalAuthenticateToken, requireAgencyTrialNotExpired);

const proofItemSchema = z.object({
  type: z.enum(["image", "video", "url"]),
  value: z.string().url(), // URL to the file or external URL
  name: z.string().optional(), // Optional name/description
});

const taskStatusEnum = z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE", "NEEDS_APPROVAL"]);

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  taskNotes: z.string().optional(),
  category: z.string().optional(),
  status: taskStatusEnum.optional(),
  dueDate: z.coerce.date().optional(), // accepts ISO string or Date
  assigneeId: z.string().optional(),
  clientId: z.string().optional(),
  priority: z.string().optional(),
  estimatedHours: z.number().int().positive().optional(),
  proof: z.array(proofItemSchema).optional(), // Array of proof items
  approvalNotifyUserIds: z.array(z.string().min(1)).optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  taskNotes: z.string().nullable().optional(),
  category: z.string().optional(),
  status: taskStatusEnum.optional(),
  dueDate: z.coerce.date().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  priority: z.string().optional(),
  estimatedHours: z.number().int().positive().optional(),
  proof: z.array(proofItemSchema).nullable().optional(), // Array of proof items
  approvalNotifyUserIds: z.array(z.string().min(1)).nullable().optional(),
});

const bulkCreateTaskSchema = z.object({
  tasks: z.array(z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    category: z.string().optional(),
    status: taskStatusEnum.optional(),
    dueDate: z.coerce.date().nullable().optional(),
    assigneeId: z.string().nullable().optional(),
    clientId: z.string().nullable().optional(),
    estimatedHours: z.number().optional(),
    priority: z.string().optional(),
  }))
});

const frequencyEnum = z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUAL"]);
const createRecurringTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  status: taskStatusEnum.optional(),
  priority: z.string().optional(),
  estimatedHours: z.number().int().positive().optional(),
  assigneeId: z.string().optional(),
  clientId: z.string().optional(),
  proof: z.array(proofItemSchema).optional(),
  frequency: frequencyEnum,
  dayOfWeek: z.number().int().min(0).max(6).optional(), // 0=Sunday, for WEEKLY
  dayOfMonth: z.number().int().min(1).max(31).optional(), // for MONTHLY/QUARTERLY/SEMIANNUAL
  firstRunAt: z.coerce.date(), // when to create the first task (and base for recurrence)
});

const updateRecurringTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  status: taskStatusEnum.optional(),
  priority: z.string().optional(),
  estimatedHours: z.number().int().positive().optional(),
  assigneeId: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  proof: z.array(proofItemSchema).optional(),
  frequency: frequencyEnum.optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
  dayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
  firstRunAt: z.coerce.date().optional(),
  nextRunAt: z.coerce.date().optional(),
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
      notes: true,
    },
  },
  createdBy: { select: { id: true, name: true, email: true } },
};

async function sendTaskApprovalRequestEmails(
  userIds: string[],
  task: { title: string; id: string; client?: { name: string } | null },
  createdByName: string
): Promise<void> {
  if (userIds.length === 0) return;
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { email: true, name: true },
  });
  const clientName = task.client?.name ?? "Client";
  const subject = `Content needs your approval: ${task.title}`;
  const body = `<p>${createdByName} has requested approval for the following task:</p>
<p><strong>${task.title}</strong></p>
<p>Client: ${clientName}</p>
<p>Please review and approve in the dashboard.</p>`;
  for (const u of users) {
    if (u.email) {
      sendEmail({ to: u.email, subject, html: body }).catch((e) =>
        console.warn("[Task] Approval email failed", u.email, e?.message)
      );
    }
  }
}

async function sendTaskCompletedEmails(
  task: {
    title: string;
    id: string;
    clientId?: string | null;
    client?: { name: string } | null;
    assignee?: { id?: string; email: string | null; name: string | null } | null;
    createdBy?: { id?: string; email: string | null; name: string | null } | null;
    approvalNotifyUserIds?: string | null;
    agencyId?: string | null;
  },
  approvalNotifyUserIds: string | null,
  completedByUserId?: string
): Promise<void> {
  const toEmails: string[] = [];

  // 1. Notify client users (the actual client contacts who need to know)
  if (task.clientId) {
    const clientUsers = await prisma.clientUser.findMany({
      where: { clientId: task.clientId, status: "ACTIVE" as const },
      select: { user: { select: { email: true } } },
    });
    clientUsers.forEach((cu: { user: { email: string | null } }) => cu.user.email && toEmails.push(cu.user.email));
  }

  // 2. Notify the task creator if they didn't complete it themselves
  if (task.createdBy?.email && task.createdBy.id !== completedByUserId) {
    toEmails.push(task.createdBy.email);
  }

  // 3. Notify approval-notify users
  if (approvalNotifyUserIds) {
    try {
      const ids = JSON.parse(approvalNotifyUserIds) as string[];
      const users = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { email: true },
      });
      users.forEach((u) => u.email && toEmails.push(u.email));
    } catch {
      // ignore invalid JSON
    }
  }

  // Never email the person who completed the task
  const excludeEmail = completedByUserId
    ? (await prisma.user.findUnique({ where: { id: completedByUserId }, select: { email: true } }))?.email
    : null;
  const unique = [...new Set(toEmails)].filter((e) => e !== excludeEmail);
  if (unique.length === 0) return;

  const clientName = task.client?.name ?? "Client";
  const subject = `Task completed: ${task.title}`;
  const html = `<p>The following task has been marked completed:</p>
<p><strong>${task.title}</strong></p>
<p>Client: ${clientName}</p>`;
  for (const to of unique) {
    sendEmail({ to, subject, html }).catch((e) =>
      console.warn("[Task] Completion email failed", to, e?.message)
    );
  }

  // 4. Create in-app notification for the agency
  if (task.agencyId) {
    prisma.notification.create({
      data: {
        agencyId: task.agencyId,
        type: "task_completed",
        title: "Task completed",
        message: `"${task.title}" for ${clientName} has been completed.`,
        link: `/agency/tasks`,
      },
    }).catch((e) => console.warn("[Task] In-app notification failed", e?.message));
  }
}

const commentBodySchema = z.object({
  body: z.string().min(1).max(5000),
});

/** Advance nextRunAt by one interval based on frequency and day settings */
function addRecurrenceInterval(from: Date, frequency: string, dayOfWeek: number | null, dayOfMonth: number | null): Date {
  const next = new Date(from);
  switch (frequency) {
    case "WEEKLY": {
      next.setDate(next.getDate() + 7);
      if (dayOfWeek != null) next.setDate(next.getDate() - next.getDay() + dayOfWeek);
      return next;
    }
    case "MONTHLY": {
      next.setMonth(next.getMonth() + 1);
      if (dayOfMonth != null) {
        const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(dayOfMonth, lastDay));
      }
      return next;
    }
    case "QUARTERLY": {
      next.setMonth(next.getMonth() + 3);
      if (dayOfMonth != null) {
        const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(dayOfMonth, lastDay));
      }
      return next;
    }
    case "SEMIANNUAL": {
      next.setMonth(next.getMonth() + 6);
      if (dayOfMonth != null) {
        const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(dayOfMonth, lastDay));
      }
      return next;
    }
    default:
      next.setMonth(next.getMonth() + 1);
      return next;
  }
}

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
  // Specialist: only tasks assigned to them (receive, not assign)
  if (user.role === "SPECIALIST") {
    return task?.assigneeId === user.userId;
  }
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
    const assigneeMe = req.query.assigneeMe === "true" || req.query.assigneeMe === "1";

    // Specialist: only tasks assigned to them (own task list)
    if (req.user.role === "SPECIALIST") {
      const tasks = await prisma.task.findMany({
        where: {
          assigneeId: req.user.userId,
          ...(clientIdParam ? { clientId: clientIdParam } : {}),
        },
        include: taskInclude,
        orderBy: { createdAt: "desc" },
      });
      return res.json(tasks);
    }

    let tasks;
    if (req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN") {
      const where: any = {};
      if (clientIdParam) where.clientId = clientIdParam;
      if (assigneeMe) where.assigneeId = req.user.userId;
      tasks = await prisma.task.findMany({
        where: Object.keys(where).length ? where : undefined,
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

// List users who can be assigned to work log tasks.
// SUPER_ADMIN / ADMIN: can assign to Super Admins, Admins, Specialists (system-wide).
// AGENCY: can assign ONLY to users in their own agency (same team).
router.get("/assignable-users", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "SUPER_ADMIN" && req.user.role !== "ADMIN" && req.user.role !== "AGENCY") {
      return res.status(403).json({ message: "Access denied" });
    }
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const searchFilter = search
      ? {
          OR: [
            { name: { contains: search } },
            { email: { contains: search } },
          ],
        }
      : {};

    if (req.user.role === "AGENCY") {
      // Agency users may only assign to members of their own agency (team).
      const myMemberships = await prisma.userAgency.findMany({
        where: { userId: req.user.userId },
        select: { agencyId: true },
      });
      const myAgencyIds = myMemberships.map((m) => m.agencyId);
      if (myAgencyIds.length === 0) {
        return res.json([]);
      }
      const teamUserIds = await prisma.userAgency.findMany({
        where: { agencyId: { in: myAgencyIds } },
        select: { userId: true },
      });
      const uniqueIds = [...new Set(teamUserIds.map((m) => m.userId))];
      const users = await prisma.user.findMany({
        where: {
          id: { in: uniqueIds },
          verified: true,
          ...searchFilter,
        },
        select: { id: true, name: true, email: true, role: true },
        orderBy: [{ name: "asc" }],
        take: 100,
      });
      return res.json(users);
    }

    // SUPER_ADMIN and ADMIN: system-wide assignable users (Super Admins, Admins, Specialists only).
    const users = await prisma.user.findMany({
      where: {
        role: { in: ["SUPER_ADMIN", "ADMIN", "SPECIALIST"] },
        verified: true,
        ...searchFilter,
      },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      take: 100,
    });
    return res.json(users);
  } catch (error) {
    console.error("Assignable users error:", error);
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
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        description: true,
        taskNotes: true,
        category: true,
        status: true,
        dueDate: true,
        proof: true,
        approvalNotifyUserIds: true,
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

// List users who can receive approval notifications for a client's work log (agency members or client users)
router.get("/worklog/:clientId/approval-recipients", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: { include: { memberships: { select: { agencyId: true } } } },
      },
    });
    if (!client) return res.status(404).json({ message: "Client not found" });

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
    if (!hasAccess) return res.status(403).json({ message: "Access denied" });

    const agencyId = client.belongsToAgencyId ?? client.user.memberships[0]?.agencyId ?? null;
    if (agencyId) {
      const members = await prisma.userAgency.findMany({
        where: { agencyId },
        select: { userId: true },
      });
      const userIds = [...new Set(members.map((m) => m.userId))];
      const users = await prisma.user.findMany({
        where: { id: { in: userIds }, verified: true },
        select: { id: true, name: true, email: true },
        orderBy: [{ name: "asc" }],
      });
      return res.json(users);
    }
    const clientUsers = await prisma.clientUser.findMany({
      where: { clientId, status: "ACTIVE" },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    const users = clientUsers.map((cu) => cu.user).filter((u) => u?.email);
    return res.json(users);
  } catch (error) {
    console.error("Approval recipients error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ---------- Recurring task rules ----------
// List recurring rules (agency-scoped)
router.get("/recurring", authenticateToken, async (req, res) => {
  try {
    if (req.user.role === "SPECIALIST") {
      return res.status(403).json({ message: "Access denied" });
    }
    let agencyIds: string[] = [];
    if (req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN") {
      const agencies = await prisma.agency.findMany({ select: { id: true } });
      agencyIds = agencies.map((a) => a.id);
    } else {
      const memberships = await prisma.userAgency.findMany({
        where: { userId: req.user.userId },
        select: { agencyId: true },
      });
      agencyIds = memberships.map((m) => m.agencyId);
    }
    if (agencyIds.length === 0) {
      return res.json([]);
    }
    const rules = await prisma.recurringTaskRule.findMany({
      where: { agencyId: { in: agencyIds } },
      orderBy: { nextRunAt: "asc" },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
    return res.json(rules);
  } catch (error) {
    console.error("List recurring rules error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Create recurring rule
router.post("/recurring", authenticateToken, async (req, res) => {
  try {
    if (req.user.role === "SPECIALIST") {
      return res.status(403).json({ message: "Access denied" });
    }
    const parsed = createRecurringTaskSchema.parse(req.body);
    const membership = await prisma.userAgency.findFirst({
      where: { userId: req.user.userId },
    });
    let agencyId: string | undefined = membership?.agencyId;
    if (!agencyId && (req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN")) {
      agencyId = (await prisma.agency.findFirst())?.id ?? undefined;
    }
    if (!agencyId) {
      return res.status(400).json({ message: "No agency found." });
    }
    const rule = await prisma.recurringTaskRule.create({
      data: {
        agencyId,
        createdById: req.user.userId,
        title: parsed.title,
        description: parsed.description,
        category: parsed.category,
        status: parsed.status ?? "TODO",
        priority: parsed.priority,
        estimatedHours: parsed.estimatedHours,
        assigneeId: parsed.assigneeId,
        clientId: parsed.clientId,
        proof: parsed.proof?.length ? JSON.stringify(parsed.proof) : null,
        frequency: parsed.frequency,
        dayOfWeek: parsed.dayOfWeek ?? null,
        dayOfMonth: parsed.dayOfMonth ?? null,
        nextRunAt: parsed.firstRunAt,
        isActive: true,
      },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
    return res.status(201).json(rule);
  } catch (error: any) {
    console.error("Create recurring rule error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    return res.status(500).json({ message: "Failed to create recurring rule" });
  }
});

// Update recurring rule
router.put("/recurring/:id", authenticateToken, async (req, res) => {
  try {
    if (req.user.role === "SPECIALIST") {
      return res.status(403).json({ message: "Access denied" });
    }
    const { id } = req.params;
    const rule = await prisma.recurringTaskRule.findUnique({ where: { id } });
    if (!rule) return res.status(404).json({ message: "Resource not found." });
    let canAccess = false;
    if (req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN") canAccess = true;
    else {
      const membership = await prisma.userAgency.findFirst({
        where: { userId: req.user.userId, agencyId: rule.agencyId },
      });
      canAccess = Boolean(membership);
    }
    if (!canAccess) return res.status(403).json({ message: "Access denied" });

    const parsed = updateRecurringTaskSchema.parse(req.body);
    const nextRun = parsed.nextRunAt ?? parsed.firstRunAt ?? rule.nextRunAt;
    const data: Record<string, unknown> = {};
    if (parsed.title !== undefined) data.title = parsed.title;
    if (parsed.description !== undefined) data.description = parsed.description;
    if (parsed.category !== undefined) data.category = parsed.category;
    if (parsed.status !== undefined) data.status = parsed.status;
    if (parsed.priority !== undefined) data.priority = parsed.priority;
    if (parsed.estimatedHours !== undefined) data.estimatedHours = parsed.estimatedHours;
    if (parsed.assigneeId !== undefined) data.assigneeId = parsed.assigneeId;
    if (parsed.clientId !== undefined) data.clientId = parsed.clientId;
    if (parsed.proof !== undefined) data.proof = parsed.proof?.length ? JSON.stringify(parsed.proof) : null;
    if (parsed.frequency !== undefined) data.frequency = parsed.frequency;
    if (parsed.dayOfWeek !== undefined) data.dayOfWeek = parsed.dayOfWeek;
    if (parsed.dayOfMonth !== undefined) data.dayOfMonth = parsed.dayOfMonth;
    data.nextRunAt = nextRun;

    const updated = await prisma.recurringTaskRule.update({
      where: { id },
      data: data as any,
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
    return res.json(updated);
  } catch (error: any) {
    console.error("Update recurring rule error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    if (error?.code === "P2025") return res.status(404).json({ message: "Resource not found." });
    return res.status(500).json({ message: "Failed to update recurring task" });
  }
});

// Stop recurrence (set isActive = false)
router.patch("/recurring/:id/stop", authenticateToken, async (req, res) => {
  try {
    if (req.user.role === "SPECIALIST") {
      return res.status(403).json({ message: "Access denied" });
    }
    const { id } = req.params;
    const rule = await prisma.recurringTaskRule.findUnique({ where: { id } });
    if (!rule) return res.status(404).json({ message: "Recurring rule not found" });
    let canAccess = false;
    if (req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN") canAccess = true;
    else {
      const membership = await prisma.userAgency.findFirst({
        where: { userId: req.user.userId, agencyId: rule.agencyId },
      });
      canAccess = Boolean(membership);
    }
    if (!canAccess) return res.status(403).json({ message: "Access denied" });
    await prisma.recurringTaskRule.update({
      where: { id },
      data: { isActive: false },
    });
    return res.json({ message: "Recurrence stopped", id });
  } catch (error) {
    console.error("Stop recurrence error:", error);
    res.status(500).json({ message: "Failed to stop recurrence" });
  }
});

// Resume recurrence (set isActive = true)
router.patch("/recurring/:id/resume", authenticateToken, async (req, res) => {
  try {
    if (req.user.role === "SPECIALIST") {
      return res.status(403).json({ message: "Access denied" });
    }
    const { id } = req.params;
    const rule = await prisma.recurringTaskRule.findUnique({ where: { id } });
    if (!rule) return res.status(404).json({ message: "Recurring rule not found" });
    let canAccess = false;
    if (req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN") canAccess = true;
    else {
      const membership = await prisma.userAgency.findFirst({
        where: { userId: req.user.userId, agencyId: rule.agencyId },
      });
      canAccess = Boolean(membership);
    }
    if (!canAccess) return res.status(403).json({ message: "Access denied" });
    await prisma.recurringTaskRule.update({
      where: { id },
      data: { isActive: true },
    });
    return res.json({ message: "Recurrence resumed", id });
  } catch (error) {
    console.error("Resume recurrence error:", error);
    res.status(500).json({ message: "Failed to resume recurrence" });
  }
});

// Delete recurring rule (remove permanently)
router.delete("/recurring/:id", authenticateToken, async (req, res) => {
  try {
    if (req.user.role === "SPECIALIST") {
      return res.status(403).json({ message: "Access denied" });
    }
    const { id } = req.params;
    const rule = await prisma.recurringTaskRule.findUnique({ where: { id } });
    if (!rule) return res.status(404).json({ message: "Recurring rule not found" });
    let canAccess = false;
    if (req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN") canAccess = true;
    else {
      const membership = await prisma.userAgency.findFirst({
        where: { userId: req.user.userId, agencyId: rule.agencyId },
      });
      canAccess = Boolean(membership);
    }
    if (!canAccess) return res.status(403).json({ message: "Access denied" });
    await prisma.recurringTaskRule.delete({ where: { id } });
    return res.status(204).send();
  } catch (error) {
    console.error("Delete recurring rule error:", error);
    res.status(500).json({ message: "Failed to remove recurring task" });
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

// Create task (Specialists receive tasks; only AGENCY, ADMIN, SUPER_ADMIN can create/assign)
router.post("/", authenticateToken, async (req, res) => {
  try {
    if (req.user.role === "SPECIALIST") {
      return res.status(403).json({ message: "Access denied. Specialists cannot create or assign tasks." });
    }

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

    const approvalJson =
      (parsed.approvalNotifyUserIds?.length ?? 0) > 0
        ? JSON.stringify(parsed.approvalNotifyUserIds)
        : undefined;
    const task = await prisma.task.create({
      data: {
        title: parsed.title,
        description: parsed.description,
        taskNotes: parsed.taskNotes ?? undefined,
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
        approvalNotifyUserIds: approvalJson,
      },
      include: taskInclude,
    });

    if (task.status === "NEEDS_APPROVAL" && (parsed.approvalNotifyUserIds?.length ?? 0) > 0) {
      const createdBy = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { name: true, email: true },
      });
      sendTaskApprovalRequestEmails(
        parsed.approvalNotifyUserIds!,
        { id: task.id, title: task.title, client: task.client ?? undefined },
        createdBy?.name || createdBy?.email || "A user"
      ).catch((e) => console.warn("[Task] Approval emails failed", e?.message));
    }

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

// Update task (PUT = replace fields you send). Specialists cannot edit task details (only status via PATCH).
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    if (req.user.role === "SPECIALIST") {
      return res.status(403).json({ message: "Access denied. Specialists cannot edit task details." });
    }

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
    if (updates.approvalNotifyUserIds !== undefined) {
      updateData.approvalNotifyUserIds =
        (updates.approvalNotifyUserIds?.length ?? 0) > 0
          ? JSON.stringify(updates.approvalNotifyUserIds)
          : null;
    }

    const updatedTask = await prisma.task.update({
      where: { id },
      data: updateData as Parameters<typeof prisma.task.update>[0]["data"],
      include: taskInclude,
    });

    if (updatedTask.status === "NEEDS_APPROVAL" && (updates.approvalNotifyUserIds?.length ?? 0) > 0) {
      const createdBy = await prisma.user.findUnique({
        where: { id: updatedTask.createdById ?? "" },
        select: { name: true, email: true },
      });
      sendTaskApprovalRequestEmails(
        updates.approvalNotifyUserIds!,
        { id: updatedTask.id, title: updatedTask.title, client: updatedTask.client ?? undefined },
        createdBy?.name || createdBy?.email || "A user"
      ).catch((e) => console.warn("[Task] Approval emails failed", e?.message));
    }
    if (updatedTask.status === "DONE") {
      sendTaskCompletedEmails(
        {
          ...updatedTask,
          approvalNotifyUserIds: updatedTask.approvalNotifyUserIds ?? undefined,
        },
        updatedTask.approvalNotifyUserIds,
        req.user.userId
      ).catch((e) => console.warn("[Task] Completion emails failed", e?.message));
    }

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

// Partial update: status only (optional approvalNotifyUserIds when status is NEEDS_APPROVAL)
router.patch("/:id/status", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const body = z
      .object({
        status: taskStatusEnum,
        approvalNotifyUserIds: z.array(z.string().min(1)).optional(),
      })
      .parse(req.body);

    const task = await getTaskForAccess(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (!canAccessTask(req.user, task)) return res.status(403).json({ message: "Access denied" });

    const updateData: { status: TaskStatus; approvalNotifyUserIds?: string | null } = {
      status: body.status as TaskStatus,
    };
    if (body.status === "NEEDS_APPROVAL" && (body.approvalNotifyUserIds?.length ?? 0) > 0) {
      updateData.approvalNotifyUserIds = JSON.stringify(body.approvalNotifyUserIds);
    } else if (body.status !== "NEEDS_APPROVAL") {
      updateData.approvalNotifyUserIds = null;
    }

    const updated = await prisma.task.update({
      where: { id },
      data: updateData,
      include: taskInclude,
    });

    if (updated.status === "NEEDS_APPROVAL" && (body.approvalNotifyUserIds?.length ?? 0) > 0) {
      const createdBy = await prisma.user.findUnique({
        where: { id: updated.createdById ?? "" },
        select: { name: true, email: true },
      });
      sendTaskApprovalRequestEmails(
        body.approvalNotifyUserIds!,
        { id: updated.id, title: updated.title, client: updated.client ?? undefined },
        createdBy?.name || createdBy?.email || "A user"
      ).catch((e) => console.warn("[Task] Approval emails failed", e?.message));
    }
    if (updated.status === "DONE") {
      sendTaskCompletedEmails(
        {
          ...updated,
          approvalNotifyUserIds: updated.approvalNotifyUserIds ?? undefined,
        },
        updated.approvalNotifyUserIds,
        req.user.userId
      ).catch((e) => console.warn("[Task] Completion emails failed", e?.message));
    }

    res.json(updated);
  } catch (error) {
    console.error("Patch task status error:", error);
    res.status(500).json({ message: "Failed to update task status" });
  }
});

// Delete task. Specialists cannot delete tasks.
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    if (req.user.role === "SPECIALIST") {
      return res.status(403).json({ message: "Access denied. Specialists cannot delete tasks." });
    }

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

/** Process due recurring rules: create task and advance nextRunAt. Call from server cron. */
export async function processRecurringTaskRules(): Promise<void> {
  const now = new Date();
  const due = await prisma.recurringTaskRule.findMany({
    where: { isActive: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
  });
  for (const rule of due) {
    try {
      const dueDate = new Date(rule.nextRunAt);
      await prisma.task.create({
        data: {
          title: rule.title,
          description: rule.description,
          category: rule.category,
          priority: rule.priority,
          estimatedHours: rule.estimatedHours,
          assigneeId: rule.assigneeId,
          clientId: rule.clientId,
          agencyId: rule.agencyId,
          createdById: rule.createdById,
          status: rule.status ?? "TODO",
          proof: rule.proof,
          dueDate,
        },
      });
      const nextRunAt = addRecurrenceInterval(
        dueDate,
        rule.frequency,
        rule.dayOfWeek,
        rule.dayOfMonth
      );
      await prisma.recurringTaskRule.update({
        where: { id: rule.id },
        data: { nextRunAt },
      });
    } catch (err) {
      console.error("[RecurringTasks] Failed to process rule", rule.id, err);
    }
  }
}

export default router;
