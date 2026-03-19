import express from "express";
import { z } from "zod";
import type { Role, TaskStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { authenticateToken, optionalAuthenticateToken } from "../middleware/auth.js";
import { requireAgencyTrialNotExpired } from "../middleware/requireAgencyTrialNotExpired.js";

const router = express.Router();

// Restrict agency users with expired trial
router.use(optionalAuthenticateToken, requireAgencyTrialNotExpired);

function isMissingTaskCommentTypeColumn(error: any) {
  return (
    error?.code === "P2022" &&
    typeof error?.meta?.column === "string" &&
    error.meta.column.includes("task_comments.type")
  );
}

function normalizeProofUrl(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Invalid URL");
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(candidate);
  return parsed.toString();
}

const proofItemSchema = z.object({
  type: z.enum(["image", "video", "url"]),
  value: z.string().transform((value, ctx) => {
    try {
      return normalizeProofUrl(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid URL" });
      return z.NEVER;
    }
  }), // URL to the file or external URL (accepts www.* by normalizing to https://)
  name: z.string().optional(), // Optional name/description
});

const taskStatusEnum = z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE", "NEEDS_APPROVAL", "CANCELLED"]);

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
  createdBy: { select: { id: true, name: true, email: true, role: true } },
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
  const recipientUserIds = new Set<string>();

  // 1. Notify client users (the actual client contacts who need to know)
  if (task.clientId) {
    const clientUsers = await prisma.clientUser.findMany({
      where: { clientId: task.clientId, status: "ACTIVE" as const },
      select: { userId: true, user: { select: { email: true } } },
    });
    clientUsers.forEach((cu: { userId: string; user: { email: string | null } }) => {
      recipientUserIds.add(cu.userId);
      if (cu.user.email) toEmails.push(cu.user.email);
    });
  }

  // 2. Notify the task creator if they didn't complete it themselves
  if (task.createdBy?.email && task.createdBy.id !== completedByUserId) {
    toEmails.push(task.createdBy.email);
  }
  if (task.createdBy?.id && task.createdBy.id !== completedByUserId) {
    recipientUserIds.add(task.createdBy.id);
  }

  // 3. Notify approval-notify users
  if (approvalNotifyUserIds) {
    try {
      const ids = JSON.parse(approvalNotifyUserIds) as string[];
      const users = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, email: true },
      });
      users.forEach((u) => {
        recipientUserIds.add(u.id);
        if (u.email) toEmails.push(u.email);
      });
    } catch {
      // ignore invalid JSON
    }
  }

  // 4. Notify higher-up users (super admins/admins), excluding the completer.
  const higherUpUsers = await prisma.user.findMany({
    where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } },
    select: { id: true, email: true },
  });
  higherUpUsers.forEach((u) => {
    if (u.id !== completedByUserId) recipientUserIds.add(u.id);
    if (u.email) toEmails.push(u.email);
  });

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

  // 5. Create in-app notifications only for targeted recipients
  const inAppRecipientIds = Array.from(recipientUserIds).filter((uid) => uid !== completedByUserId);
  if (inAppRecipientIds.length > 0) {
    const inAppUsers = await prisma.user.findMany({
      where: { id: { in: inAppRecipientIds } },
      select: { id: true, role: true },
    });
    if (inAppUsers.length > 0) {
      await prisma.notification
        .createMany({
          data: inAppUsers.map((u) => ({
            userId: u.id,
            agencyId: task.agencyId ?? null,
            type: "task_completed",
            title: "Task completed",
            message: `"${task.title}" for ${clientName} has been completed.`,
            link: u.role === "USER" ? `/client/tasks?taskId=${task.id}` : `/agency/tasks?taskId=${task.id}`,
          })),
        })
        .catch((e) => console.warn("[Task] Completion in-app notification failed", e?.message));
    }
  }
}

const taskCommentTypeEnum = z.enum(["COMMENT", "QUESTION", "APPROVAL_REQUEST", "APPROVAL", "REVISION_REQUEST"]);

const commentBodySchema = z.object({
  body: z.string().min(1).max(5000),
  type: taskCommentTypeEnum.optional(),
  mentionUserIds: z.array(z.string().min(1)).optional(),
  context: z.enum(["TASK", "WORKLOG"]).optional(),
});

function parseUserIdJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function selectTaskActivityRecipientIds(params: {
  authorRole: Role | null | undefined;
  authorId: string;
  assigneeId?: string | null;
  internalUserIds: Iterable<string>;
  clientUserIds: Iterable<string>;
}): string[] {
  const { authorRole, authorId, assigneeId, internalUserIds, clientUserIds } = params;
  const recipients = new Set<string>();
  const isAuthorTaskAssignee = Boolean(assigneeId) && assigneeId === authorId;

  // Client author -> notify internal side.
  // Task assignee author -> notify internal owner side (super admin / agency members).
  // Other internal author -> notify client side.
  if (authorRole === "USER" || isAuthorTaskAssignee) {
    for (const id of internalUserIds) recipients.add(id);
  } else {
    for (const id of clientUserIds) recipients.add(id);
  }

  recipients.delete(authorId);
  return [...recipients];
}

export function selectTaskStatusCreatorRecipientId(params: {
  actorRole: Role | null | undefined;
  actorId: string;
  createdById?: string | null;
  createdByRole?: Role | null;
  fromStatus?: TaskStatus | null;
  toStatus?: TaskStatus | null;
}): string | null {
  const { actorRole, actorId, createdById, createdByRole, fromStatus, toStatus } = params;

  if (actorRole !== "SPECIALIST" && actorRole !== "ADMIN") return null;
  if (!createdById || createdById === actorId) return null;
  if (!createdByRole || !["SUPER_ADMIN", "ADMIN", "AGENCY"].includes(createdByRole)) return null;
  if (!fromStatus || !toStatus || fromStatus === toStatus) return null;

  return createdById;
}

async function createTaskActivityNotifications(
  task: {
    id: string;
    title: string;
    clientId?: string | null;
    agencyId?: string | null;
    assigneeId?: string | null;
    createdById?: string | null;
  },
  authorId: string,
  authorName: string,
  commentType: string,
  body: string,
  options?: {
    suppressRecipientUserIds?: string[];
  }
): Promise<void> {
  const recipientUserIds = new Set<string>();

  const typeLabels: Record<string, string> = {
    COMMENT: "commented on",
    QUESTION: "asked a question on",
    APPROVAL_REQUEST: "requested approval for",
    APPROVAL: "approved",
    REVISION_REQUEST: "requested revisions on",
  };
  const action = typeLabels[commentType] || "commented on";
  const notifTitle = `${authorName} ${action} "${task.title}"`;
  const notifMessage = body.length > 120 ? body.slice(0, 120) + "…" : body;

  const author = await prisma.user.findUnique({
    where: { id: authorId },
    select: { role: true },
  });
  const authorRole = author?.role;

  // Always include super admins on internal-side notifications.
  const superAdmins = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });
  const internalUserIds = new Set(superAdmins.map((u) => u.id));

  // Resolve agency ownership: client ownership wins, then fallback to task agency.
  let agencyScopeId: string | null = task.agencyId ?? null;
  if (task.clientId) {
    const client = await prisma.client.findUnique({
      where: { id: task.clientId },
      select: { belongsToAgencyId: true },
    });
    if (client) {
      agencyScopeId = client.belongsToAgencyId ?? null;
    }
  }

  // If task is agency-owned, include that agency's members too.
  if (agencyScopeId) {
    const members = await prisma.userAgency.findMany({
      where: { agencyId: agencyScopeId },
      select: { userId: true },
    });
    members.forEach((m) => internalUserIds.add(m.userId));
  }
  if (task.assigneeId) {
    internalUserIds.add(task.assigneeId);
  }
  // Ensure task creator gets internal-side activity notifications
  // for client/specialist-side updates when creator is a panel user.
  if (task.createdById) {
    const creator = await prisma.user.findUnique({
      where: { id: task.createdById },
      select: { id: true, role: true },
    });
    if (creator && ["SUPER_ADMIN", "ADMIN", "AGENCY"].includes(creator.role)) {
      internalUserIds.add(creator.id);
    }
  }

  // Client-side recipients
  const clientUserIds = new Set<string>();
  if (task.clientId) {
    const clientUsers = await prisma.clientUser.findMany({
      where: { clientId: task.clientId, status: "ACTIVE" },
      select: { userId: true },
    });
    clientUsers.forEach((cu) => clientUserIds.add(cu.userId));
  }

  const selectedRecipientIds = selectTaskActivityRecipientIds({
    authorRole,
    authorId,
    assigneeId: task.assigneeId,
    internalUserIds,
    clientUserIds,
  });
  selectedRecipientIds.forEach((id) => recipientUserIds.add(id));
  const suppressedRecipientIds = new Set(
    (options?.suppressRecipientUserIds || []).map((id) => String(id || "").trim()).filter(Boolean)
  );
  for (const suppressedId of suppressedRecipientIds) {
    recipientUserIds.delete(suppressedId);
  }

  if (recipientUserIds.size === 0) return;

  // Look up roles so we can set correct link paths
  const recipientUsers = await prisma.user.findMany({
    where: { id: { in: [...recipientUserIds] } },
    select: { id: true, role: true },
  });
  const roleMap = new Map(recipientUsers.map((u) => [u.id, u.role]));

  const notifData = [...recipientUserIds].map((uid) => {
    const role = roleMap.get(uid);
    const basePath = role === "USER" ? "/client/tasks" : role === "SPECIALIST" ? "/specialist/tasks" : "/agency/tasks";
    return {
      userId: uid,
      agencyId: agencyScopeId ?? null,
      type: "task_activity",
      title: notifTitle,
      message: notifMessage,
      link: `${basePath}?taskId=${task.id}`,
    };
  });

  await prisma.notification.createMany({ data: notifData }).catch((e) =>
    console.warn("[Task] Activity notifications failed", e?.message)
  );

  // Send email for high-priority types (questions, approval requests, revisions)
  if (["QUESTION", "APPROVAL_REQUEST", "REVISION_REQUEST"].includes(commentType)) {
    const recipients = await prisma.user.findMany({
      where: { id: { in: [...recipientUserIds] } },
      select: { email: true, role: true },
    });

    // Mirror the same directional routing as in-app notifications.
    const emailTargets = recipients.filter((r) => {
      if (authorRole === "USER") return r.role !== "USER";
      return r.role === "USER";
    });

    const subject =
      commentType === "QUESTION"
        ? `Question on task: ${task.title}`
        : commentType === "APPROVAL_REQUEST"
        ? `Approval needed: ${task.title}`
        : `Revisions requested: ${task.title}`;

    const html = `<p><strong>${authorName}</strong> ${action} the task "<strong>${task.title}</strong>":</p>
<blockquote style="border-left:3px solid #6366f1;padding-left:12px;color:#555;">${body}</blockquote>
<p>Please review in the dashboard.</p>`;

    for (const u of emailTargets) {
      if (u.email) {
        sendEmail({ to: u.email, subject, html }).catch((e) =>
          console.warn("[Task] Activity email failed", u.email, e?.message)
        );
      }
    }
  }
}

async function notifyTaskAssigneeOnlyActivity(
  task: {
    id: string;
    title: string;
    assigneeId?: string | null;
    agencyId?: string | null;
  },
  actorUserId: string,
  actorName: string,
  commentType: "APPROVAL" | "REVISION_REQUEST",
  body: string
): Promise<void> {
  const assigneeId = task.assigneeId ?? null;
  if (!assigneeId || assigneeId === actorUserId) return;

  const assignee = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { role: true },
  });
  const basePath =
    assignee?.role === "USER"
      ? "/client/tasks"
      : assignee?.role === "SPECIALIST"
      ? "/specialist/tasks"
      : "/agency/tasks";

  const action = commentType === "APPROVAL" ? "approved" : "requested revisions on";
  await prisma.notification.create({
    data: {
      userId: assigneeId,
      agencyId: task.agencyId ?? null,
      type: "task_activity",
      title: `${actorName} ${action} "${task.title}"`,
      message: body.length > 120 ? body.slice(0, 120) + "…" : body,
      link: `${basePath}?taskId=${task.id}`,
    },
  }).catch((e) => console.warn("[Task] Assignee-only activity notification error", e?.message));
}

async function notifyClientUsersTaskNeedsApproval(
  task: { id: string; title: string; clientId?: string | null },
  requestedByName: string,
  requestedByUserId: string
): Promise<void> {
  if (!task.clientId) return;

  const recipients = await prisma.clientUser.findMany({
    where: { clientId: task.clientId, status: "ACTIVE" },
    select: {
      userId: true,
      user: { select: { email: true } },
    },
  });

  const recipientUserIds = recipients
    .map((r) => r.userId)
    .filter((userId) => userId !== requestedByUserId);

  if (recipientUserIds.length > 0) {
    await prisma.notification
      .createMany({
        data: recipientUserIds.map((userId) => ({
          userId,
          type: "task_activity",
          title: `${requestedByName} requested approval for "${task.title}"`,
          message: "This task is awaiting your approval.",
          link: `/client/tasks?taskId=${task.id}`,
        })),
      })
      .catch((e) => console.warn("[Task] Client approval notifications failed", e?.message));
  }

  const subject = `Approval needed: ${task.title}`;
  const html = `<p><strong>${requestedByName}</strong> requested your approval for:</p>
<p><strong>${task.title}</strong></p>
<p>Please review this task in the client dashboard.</p>`;
  for (const r of recipients) {
    if (r.userId === requestedByUserId) continue;
    if (r.user.email) {
      sendEmail({ to: r.user.email, subject, html }).catch((e) =>
        console.warn("[Task] Client approval email failed", r.user.email, e?.message)
      );
    }
  }
}

async function createSelfTaskStatusNotification(params: {
  taskId: string;
  taskTitle: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  actorId: string;
  actorName: string;
  actorRole: Role;
  agencyId?: string | null;
}) {
  const { taskId, taskTitle, fromStatus, toStatus, actorId, actorName, actorRole, agencyId } = params;
  if (fromStatus === toStatus) return;

  const link =
    actorRole === "SPECIALIST"
      ? `/specialist/tasks?taskId=${taskId}`
      : actorRole === "USER"
      ? `/client/tasks?taskId=${taskId}`
      : `/agency/tasks?taskId=${taskId}`;

  await prisma.notification
    .create({
      data: {
        userId: actorId,
        agencyId: agencyId ?? null,
        type: "task_activity",
        title: `${actorName} updated task status`,
        message: `"${taskTitle}" moved from ${fromStatus} to ${toStatus}.`,
        link,
      },
    })
    .catch((e) => console.warn("[Task] Self status notification failed", e?.message));
}

async function notifyClientUsersTaskStatusChanged(
  task: { id: string; title: string; clientId?: string | null },
  fromStatus: TaskStatus,
  toStatus: TaskStatus,
  updatedByName: string,
  updatedByUserId: string
): Promise<void> {
  if (!task.clientId) return;
  if (fromStatus === toStatus) return;

  const recipients = await prisma.clientUser.findMany({
    where: { clientId: task.clientId, status: "ACTIVE" },
    select: { userId: true },
  });

  const recipientUserIds = recipients
    .map((r) => r.userId)
    .filter((userId) => userId !== updatedByUserId);

  if (recipientUserIds.length === 0) return;

  const statusLabel = (status: TaskStatus): string => {
    if (status === "TODO") return "To Do";
    if (status === "IN_PROGRESS") return "In Progress";
    if (status === "NEEDS_APPROVAL") return "Needs Approval";
    if (status === "CANCELLED") return "Cancelled";
    return status.charAt(0) + status.slice(1).toLowerCase();
  };

  await prisma.notification
    .createMany({
      data: recipientUserIds.map((userId) => ({
        userId,
        type: "task_activity",
        title: `${updatedByName} updated "${task.title}" status`,
        message: `Status changed from ${statusLabel(fromStatus)} to ${statusLabel(toStatus)}.`,
        link: `/client/tasks?taskId=${task.id}`,
      })),
    })
    .catch((e) => console.warn("[Task] Client status-change notifications failed", e?.message));
}

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
          status: { not: "CANCELLED" },
          ...(clientIdParam ? { clientId: clientIdParam } : {}),
        },
        include: taskInclude,
        orderBy: { createdAt: "desc" },
      });
      return res.json(tasks);
    }

    // Client portal users: only tasks for clients they have access to
    if (req.user.role === "USER") {
      const clientAccess = await prisma.clientUser.findMany({
        where: { userId: req.user.userId, status: "ACTIVE" },
        select: { clientId: true },
      });
      const clientIds = clientAccess.map((ca) => ca.clientId);
      if (clientIds.length === 0) return res.json([]);

      const tasks = await prisma.task.findMany({
        where: {
          clientId: { in: clientIdParam ? [clientIdParam].filter((id) => clientIds.includes(id)) : clientIds },
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
      if (assigneeMe) {
        where.assigneeId = req.user.userId;
        where.status = { not: "CANCELLED" };
      }
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

// List users who can be assigned in task/work-log modals.
// Supports optional ?clientId=... to include scoped agency/client users.
router.get("/assignable-users", authenticateToken, async (req, res) => {
  try {
    if (
      req.user.role !== "SUPER_ADMIN" &&
      req.user.role !== "ADMIN" &&
      req.user.role !== "AGENCY" &&
      req.user.role !== "SPECIALIST"
    ) {
      return res.status(403).json({ message: "Access denied" });
    }
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const clientId = typeof req.query.clientId === "string" ? req.query.clientId.trim() : "";
    const searchFilter = search
      ? {
          OR: [
            { name: { contains: search } },
            { email: { contains: search } },
          ],
        }
      : {};
    const allowedIds = new Set<string>();
    const addIds = (ids: Array<string | null | undefined>) => {
      ids.forEach((id) => {
        const normalized = String(id || "").trim();
        if (normalized) allowedIds.add(normalized);
      });
    };

    if (req.user.role === "AGENCY") {
      // Agency users may assign to their own team.
      const myMemberships = await prisma.userAgency.findMany({
        where: { userId: req.user.userId },
        select: { agencyId: true },
      });
      const myAgencyIds = myMemberships.map((m) => m.agencyId);
      if (myAgencyIds.length) {
        const teamUserIds = await prisma.userAgency.findMany({
          where: { agencyId: { in: myAgencyIds } },
          select: { userId: true },
        });
        addIds(teamUserIds.map((m) => m.userId));
      }
    } else if (req.user.role === "SPECIALIST") {
      // Specialists: admins/super admins + own agency team.
      const coreUsers = await prisma.user.findMany({
        where: { role: { in: ["SUPER_ADMIN", "ADMIN"] }, verified: true },
        select: { id: true },
      });
      addIds(coreUsers.map((u) => u.id));

      const myMemberships = await prisma.userAgency.findMany({
        where: { userId: req.user.userId },
        select: { agencyId: true },
      });
      const myAgencyIds = myMemberships.map((m) => m.agencyId);
      if (myAgencyIds.length) {
        const teamUserIds = await prisma.userAgency.findMany({
          where: { agencyId: { in: myAgencyIds } },
          select: { userId: true },
        });
        addIds(teamUserIds.map((m) => m.userId));
      }
    } else {
      // SUPER_ADMIN + ADMIN: system-wide internal pool.
      const rolesForRequester: Role[] =
        req.user.role === "SUPER_ADMIN" ? ["SUPER_ADMIN", "ADMIN", "SPECIALIST"] : ["ADMIN", "SPECIALIST"];
      const users = await prisma.user.findMany({
        where: { role: { in: rolesForRequester }, verified: true },
        select: { id: true },
      });
      addIds(users.map((u) => u.id));
    }

    if (clientId) {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, belongsToAgencyId: true, user: { select: { memberships: { select: { agencyId: true } } } } },
      });
      if (!client) return res.status(404).json({ message: "Client not found" });

      const isRequesterAdmin = req.user.role === "SUPER_ADMIN" || req.user.role === "ADMIN";
      let hasClientAccess = isRequesterAdmin;
      if (!hasClientAccess) {
        const membership = await prisma.clientUser.findFirst({
          where: { clientId, userId: req.user.userId, status: "ACTIVE" },
          select: { id: true },
        });
        hasClientAccess = Boolean(membership);
      }
      if (!hasClientAccess) {
        const requesterMemberships = await prisma.userAgency.findMany({
          where: { userId: req.user.userId },
          select: { agencyId: true },
        });
        const requesterAgencyIds = requesterMemberships.map((m) => m.agencyId);
        const clientAgencyId = client.belongsToAgencyId ?? client.user.memberships[0]?.agencyId ?? null;
        hasClientAccess = Boolean(clientAgencyId && requesterAgencyIds.includes(clientAgencyId));
      }
      if (!hasClientAccess) return res.status(403).json({ message: "Access denied" });

      const clientUsers = await prisma.clientUser.findMany({
        where: { clientId, status: "ACTIVE" },
        select: { userId: true },
      });
      addIds(clientUsers.map((cu) => cu.userId));

      const scopedAgencyId = client.belongsToAgencyId ?? client.user.memberships[0]?.agencyId ?? null;
      if (scopedAgencyId) {
        const agencyMembers = await prisma.userAgency.findMany({
          where: { agencyId: scopedAgencyId },
          select: { userId: true },
        });
        addIds(agencyMembers.map((m) => m.userId));
      }
    }

    if (allowedIds.size === 0) return res.json([]);
    const users = await prisma.user.findMany({
      where: {
        id: { in: Array.from(allowedIds) },
        verified: true,
        ...(req.user.role === "ADMIN" ? { role: { not: "SUPER_ADMIN" as Role } } : {}),
        ...searchFilter,
      },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      take: 300,
    });
    return res.json(users);
  } catch (error) {
    console.error("Assignable users error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// List users who can be selected as Activity collaborators (@mentions + collaborator picker).
// Includes higher-ups, specialists, project client users, and agency user(s) for scoped client.
router.get("/activity-collaborators", authenticateToken, async (req, res) => {
  try {
    const allowedRequesterRoles = ["SUPER_ADMIN", "ADMIN", "AGENCY", "SPECIALIST", "USER"];
    if (!allowedRequesterRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const clientId = typeof req.query.clientId === "string" ? req.query.clientId.trim() : "";
    const searchFilter = search
      ? {
          OR: [
            { name: { contains: search } },
            { email: { contains: search } },
          ],
        }
      : {};

    const allowedIds = new Set<string>();
    const addIds = (ids: Array<string | null | undefined>) => {
      ids.forEach((id) => {
        const normalized = String(id || "").trim();
        if (normalized) allowedIds.add(normalized);
      });
    };

    // Always allow global higher-up and specialist collaborators.
    const coreUsers = await prisma.user.findMany({
      where: { role: { in: ["SUPER_ADMIN", "ADMIN", "SPECIALIST"] }, verified: true },
      select: { id: true },
    });
    addIds(coreUsers.map((u) => u.id));

    // Include agency account(s) + same-agency internal users for scoped collaboration.
    let scopedAgencyId: string | null = null;
    if (clientId) {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, belongsToAgencyId: true, userId: true, user: { select: { memberships: { select: { agencyId: true } } } } },
      });
      if (!client) return res.status(404).json({ message: "Client not found" });

      const isRequesterAdmin = req.user.role === "SUPER_ADMIN" || req.user.role === "ADMIN";
      let hasClientAccess = isRequesterAdmin;
      if (!hasClientAccess) {
        const membership = await prisma.clientUser.findFirst({
          where: { clientId, userId: req.user.userId, status: "ACTIVE" },
          select: { id: true },
        });
        hasClientAccess = Boolean(membership);
      }
      if (!hasClientAccess) {
        const requesterMemberships = await prisma.userAgency.findMany({
          where: { userId: req.user.userId },
          select: { agencyId: true },
        });
        const requesterAgencyIds = requesterMemberships.map((m) => m.agencyId);
        const clientAgencyId = client.belongsToAgencyId ?? client.user.memberships[0]?.agencyId ?? null;
        hasClientAccess = Boolean(clientAgencyId && requesterAgencyIds.includes(clientAgencyId));
      }
      if (!hasClientAccess) return res.status(403).json({ message: "Access denied" });

      scopedAgencyId = client.belongsToAgencyId ?? client.user.memberships[0]?.agencyId ?? null;

      const clientUsers = await prisma.clientUser.findMany({
        where: { clientId, status: "ACTIVE" },
        select: { userId: true },
      });
      addIds(clientUsers.map((cu) => cu.userId));
    }

    // Fallback agency scope when clientId is not provided.
    if (!scopedAgencyId && (req.user.role === "AGENCY" || req.user.role === "SPECIALIST")) {
      const memberships = await prisma.userAgency.findMany({
        where: { userId: req.user.userId },
        select: { agencyId: true },
      });
      scopedAgencyId = memberships[0]?.agencyId ?? null;
    }

    if (scopedAgencyId) {
      const agencyMembers = await prisma.userAgency.findMany({
        where: { agencyId: scopedAgencyId },
        select: { userId: true },
      });
      addIds(agencyMembers.map((m) => m.userId));
    }

    if (allowedIds.size === 0) return res.json([]);

    const users = await prisma.user.findMany({
      where: {
        id: { in: Array.from(allowedIds) },
        verified: true,
        ...searchFilter,
      },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      take: 300,
    });
    return res.json(users);
  } catch (error) {
    console.error("Activity collaborators error:", error);
    return res.status(500).json({ message: "Internal server error" });
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
        createdBy: { select: { id: true, name: true, email: true, role: true } },
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
// List recurring rules (agency-scoped, or client-scoped for USER role)
router.get("/recurring", authenticateToken, async (req, res) => {
  try {
    if (req.user.role === "SPECIALIST") {
      return res.status(403).json({ message: "Access denied" });
    }

    // Resolve assignee names for a list of rules (assigneeId has no Prisma relation)
    const enrichWithAssignees = async (rules: any[]) => {
      const ids = [...new Set(rules.map((r) => r.assigneeId).filter(Boolean))];
      if (ids.length === 0) return rules;
      const users = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true },
      });
      const map = new Map(users.map((u) => [u.id, u]));
      return rules.map((r) => ({ ...r, assignee: r.assigneeId ? map.get(r.assigneeId) ?? null : null }));
    };

    if (req.user.role === "USER") {
      const clientAccess = await prisma.clientUser.findMany({
        where: { userId: req.user.userId, status: "ACTIVE" },
        select: { clientId: true },
      });
      const clientIds = clientAccess.map((ca) => ca.clientId);
      if (clientIds.length === 0) return res.json([]);
      const rules = await prisma.recurringTaskRule.findMany({
        where: { clientId: { in: clientIds } },
        orderBy: { nextRunAt: "asc" },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });
      return res.json(await enrichWithAssignees(rules));
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
    return res.json(await enrichWithAssignees(rules));
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

    if ((req.user.role === "ADMIN" || req.user.role === "AGENCY") && rule.createdById !== req.user.userId) {
      return res.status(403).json({ message: "You can only edit recurring tasks you created." });
    }

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
    if ((req.user.role === "ADMIN" || req.user.role === "AGENCY") && rule.createdById !== req.user.userId) {
      return res.status(403).json({ message: "You can only manage recurring tasks you created." });
    }
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
    if ((req.user.role === "ADMIN" || req.user.role === "AGENCY") && rule.createdById !== req.user.userId) {
      return res.status(403).json({ message: "You can only manage recurring tasks you created." });
    }
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
    if ((req.user.role === "ADMIN" || req.user.role === "AGENCY") && rule.createdById !== req.user.userId) {
      return res.status(403).json({ message: "You can only delete recurring tasks you created." });
    }
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

    let comments: Array<{
      id: string;
      body: string;
      type: string;
      createdAt: Date;
      updatedAt: Date;
      author: { id: string; name: string | null; email: string; role: string };
    }> = [];
    try {
      comments = await prisma.taskComment.findMany({
        where: { taskId: id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          type: true,
          createdAt: true,
          updatedAt: true,
          author: { select: { id: true, name: true, email: true, role: true } },
        },
      });
    } catch (error: any) {
      if (!isMissingTaskCommentTypeColumn(error)) throw error;
      // Backward-compat for production DBs where task_comments.type was not added yet.
      const fallback = await prisma.taskComment.findMany({
        where: { taskId: id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          createdAt: true,
          updatedAt: true,
          author: { select: { id: true, name: true, email: true, role: true } },
        },
      });
      comments = fallback.map((c) => ({ ...c, type: "COMMENT" }));
    }

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
    const { id } = req.params;
    const { body, type, mentionUserIds } = commentBodySchema.parse(req.body);
    const commentType = type ?? "COMMENT";

    const task = await getTaskForAccess(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (!canAccessTask(req.user, task)) return res.status(403).json({ message: "Access denied" });

    let created: {
      id: string;
      body: string;
      type: string;
      createdAt: Date;
      updatedAt: Date;
      author: { id: string; name: string | null; email: string; role: string };
    };
    try {
      created = await prisma.taskComment.create({
        data: { taskId: id, authorId: req.user.userId, body, type: commentType as any },
        select: {
          id: true,
          body: true,
          type: true,
          createdAt: true,
          updatedAt: true,
          author: { select: { id: true, name: true, email: true, role: true } },
        },
      });
    } catch (error: any) {
      if (!isMissingTaskCommentTypeColumn(error)) throw error;
      const fallback = await prisma.taskComment.create({
        data: { taskId: id, authorId: req.user.userId, body },
        select: {
          id: true,
          body: true,
          createdAt: true,
          updatedAt: true,
          author: { select: { id: true, name: true, email: true, role: true } },
        },
      });
      created = { ...fallback, type: "COMMENT" };
    }

    const requestedMentionIds = Array.from(
      new Set((mentionUserIds || []).map((v) => String(v || "").trim()).filter(Boolean))
    ).filter((uid) => uid !== req.user.userId);

    // Fire-and-forget: create notifications for other participants.
    // If explicit @mentions exist, only mentioned users should be notified.
    const author = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { name: true, email: true },
    });
    // Restrict collaborator notifications to users that can access this task.
    const allowedIds = new Set<string>();
    const superAdminsAndAdmins = await prisma.user.findMany({
      where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } },
      select: { id: true },
    });
    superAdminsAndAdmins.forEach((u) => allowedIds.add(u.id));

    let agencyScopeId: string | null = task.agencyId ?? null;
    if (task.clientId) {
      const client = await prisma.client.findUnique({
        where: { id: task.clientId },
        select: { belongsToAgencyId: true },
      });
      if (client) agencyScopeId = client.belongsToAgencyId ?? null;
    }
    if (agencyScopeId) {
      const members = await prisma.userAgency.findMany({
        where: { agencyId: agencyScopeId },
        select: { userId: true },
      });
      members.forEach((m) => allowedIds.add(m.userId));
    }
    if (task.assigneeId) allowedIds.add(task.assigneeId);
    if (task.createdById) allowedIds.add(task.createdById);
    if (task.clientId) {
      const clientUsers = await prisma.clientUser.findMany({
        where: { clientId: task.clientId, status: "ACTIVE" },
        select: { userId: true },
      });
      clientUsers.forEach((cu) => allowedIds.add(cu.userId));
    }

    const existingCollaboratorIds = parseUserIdJson((task as any).approvalNotifyUserIds);
    const validMentionIds = requestedMentionIds.filter((uid) => allowedIds.has(uid));
    const nextCollaboratorIds = Array.from(
      new Set([...existingCollaboratorIds, ...validMentionIds])
    ).filter((uid) => uid !== req.user.userId);

    // Persist collaborator list when new @mentions are added.
    if (validMentionIds.length > 0) {
      await prisma.task.update({
        where: { id: task.id },
        data: { approvalNotifyUserIds: JSON.stringify(nextCollaboratorIds) },
      }).catch((e) => console.warn("[Task] Collaborator persist error", e?.message));
    }

    // Collaborator workflow: once someone is @mentioned, they become a collaborator
    // and all collaborators get notified on every future activity comment.
    if (nextCollaboratorIds.length > 0) {
      const collaborators = await prisma.user.findMany({
        where: { id: { in: nextCollaboratorIds } },
        select: { id: true, role: true },
      });
      const actionMap: Record<string, string> = {
        COMMENT: "commented on",
        QUESTION: "asked a question on",
        APPROVAL_REQUEST: "requested approval for",
        APPROVAL: "approved",
        REVISION_REQUEST: "requested revisions on",
      };
      const action = actionMap[commentType] || "commented on";
      const collaboratorNotifRows = collaborators.map((u) => {
        const basePath =
          u.role === "USER"
            ? "/client/tasks"
            : u.role === "SPECIALIST"
            ? "/specialist/tasks"
            : "/agency/tasks";
        return {
          userId: u.id,
          agencyId: task.agencyId ?? null,
          type: "task_activity",
          title: `${author?.name || author?.email || "Someone"} ${action} "${task.title}"`,
          message: body.length > 120 ? body.slice(0, 120) + "…" : body,
          link: `${basePath}?taskId=${task.id}`,
        };
      });
      await prisma.notification
        .createMany({ data: collaboratorNotifRows })
        .catch((e) => console.warn("[Task] Collaborator notification error", e?.message));
    } else {
      // No collaborators yet -> keep existing default routing.
      createTaskActivityNotifications(
        {
          id: task.id,
          title: task.title,
          clientId: task.clientId,
          agencyId: task.agencyId,
          assigneeId: task.assigneeId,
          createdById: task.createdById,
        },
        req.user.userId,
        author?.name || author?.email || "Someone",
        commentType,
        body
      ).catch((e) => console.warn("[Task] Activity notification error", e?.message));
    }

    return res.status(201).json(created);
  } catch (error: any) {
    console.error("Create task comment error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid comment", errors: error.errors });
    }
    return res.status(500).json({ message: "Failed to create comment" });
  }
});

// Task comments: delete (author only)
// IMPORTANT: Must be before "/:id"
router.delete("/:id/comments/:commentId", authenticateToken, async (req, res) => {
  try {
    const { id, commentId } = req.params;
    const task = await getTaskForAccess(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (!canAccessTask(req.user, task)) return res.status(403).json({ message: "Access denied" });

    const comment = await prisma.taskComment.findUnique({
      where: { id: commentId },
      // Avoid selecting `type` to stay compatible with older DB schemas.
      select: { id: true, taskId: true, authorId: true },
    });
    if (!comment || comment.taskId !== id) {
      return res.status(404).json({ message: "Comment not found" });
    }

    const isAuthor = comment.authorId === req.user.userId;
    if (!isAuthor) {
      return res.status(403).json({ message: "You can only delete your own activity." });
    }

    await prisma.taskComment.delete({ where: { id: commentId } });
    return res.status(204).send();
  } catch (error) {
    console.error("Delete task comment error:", error);
    return res.status(500).json({ message: "Failed to delete comment" });
  }
});


// Get unread activity count for tasks (used for badge display)
// IMPORTANT: Must be before "/:id"
router.get("/unread-counts", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const unread = await prisma.notification.findMany({
      where: {
        userId,
        read: false,
        type: "task_activity",
      },
      select: { link: true },
    });

    const counts: Record<string, number> = {};
    for (const n of unread) {
      if (!n.link) continue;
      const match = n.link.match(/taskId=([a-zA-Z0-9_-]+)/);
      if (match) {
        counts[match[1]] = (counts[match[1]] || 0) + 1;
      }
    }

    return res.json(counts);
  } catch (error) {
    console.error("Unread counts error:", error);
    return res.status(500).json({ message: "Failed to fetch unread counts" });
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

    const actor = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { name: true, email: true },
    });
    const actorName = actor?.name || actor?.email || "A user";

    if (task.status === "NEEDS_APPROVAL" && (parsed.approvalNotifyUserIds?.length ?? 0) > 0) {
      sendTaskApprovalRequestEmails(
        parsed.approvalNotifyUserIds!,
        { id: task.id, title: task.title, client: task.client ?? undefined },
        actorName
      ).catch((e) => console.warn("[Task] Approval emails failed", e?.message));
    }
    if (task.status === "NEEDS_APPROVAL") {
      notifyClientUsersTaskNeedsApproval(
        { id: task.id, title: task.title, clientId: task.clientId },
        actorName,
        req.user.userId
      ).catch((e) => console.warn("[Task] Client NEEDS_APPROVAL notifications failed", e?.message));
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

    // ADMIN/AGENCY can only edit tasks they created
    if ((req.user.role === "ADMIN" || req.user.role === "AGENCY") && task.createdById !== req.user.userId) {
      return res.status(403).json({ message: "You can only edit tasks you created." });
    }

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

    const actor = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { name: true, email: true },
    });
    const actorName = actor?.name || actor?.email || "A user";
    const didStatusChange = (task.status as TaskStatus) !== (updatedTask.status as TaskStatus);
    const canSelfNotifyStatus = ["SUPER_ADMIN", "ADMIN", "AGENCY", "SPECIALIST"].includes(req.user.role);

    if (updatedTask.status === "NEEDS_APPROVAL" && (updates.approvalNotifyUserIds?.length ?? 0) > 0) {
      sendTaskApprovalRequestEmails(
        updates.approvalNotifyUserIds!,
        { id: updatedTask.id, title: updatedTask.title, client: updatedTask.client ?? undefined },
        actorName
      ).catch((e) => console.warn("[Task] Approval emails failed", e?.message));
    }
    if (didStatusChange && canSelfNotifyStatus && updatedTask.status !== "DONE") {
      createSelfTaskStatusNotification({
        taskId: updatedTask.id,
        taskTitle: updatedTask.title,
        fromStatus: task.status as TaskStatus,
        toStatus: updatedTask.status as TaskStatus,
        actorId: req.user.userId,
        actorName,
        actorRole: req.user.role as Role,
        agencyId: updatedTask.agencyId ?? null,
      });
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

    const actor = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { name: true, email: true },
    });
    const actorName = actor?.name || actor?.email || "A user";
    const didStatusChange = (task.status as TaskStatus) !== (updated.status as TaskStatus);
    const canSelfNotifyStatus = ["SUPER_ADMIN", "ADMIN", "AGENCY", "SPECIALIST"].includes(req.user.role);

    if (updated.status === "NEEDS_APPROVAL" && (body.approvalNotifyUserIds?.length ?? 0) > 0) {
      sendTaskApprovalRequestEmails(
        body.approvalNotifyUserIds!,
        { id: updated.id, title: updated.title, client: updated.client ?? undefined },
        actorName
      ).catch((e) => console.warn("[Task] Approval emails failed", e?.message));
    }
    if (didStatusChange && canSelfNotifyStatus && updated.status !== "DONE") {
      createSelfTaskStatusNotification({
        taskId: updated.id,
        taskTitle: updated.title,
        fromStatus: task.status as TaskStatus,
        toStatus: updated.status as TaskStatus,
        actorId: req.user.userId,
        actorName,
        actorRole: req.user.role as Role,
        agencyId: updated.agencyId ?? null,
      });
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

    // ADMIN/AGENCY can only delete tasks they created
    if ((req.user.role === "ADMIN" || req.user.role === "AGENCY") && task.createdById !== req.user.userId) {
      return res.status(403).json({ message: "You can only delete tasks you created." });
    }

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

// Approve a task (client portal action)
router.post("/:id/approve", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = z.object({ comment: z.string().max(5000).optional() }).parse(req.body);

    const task = await getTaskForAccess(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (!canAccessTask(req.user, task)) return res.status(403).json({ message: "Access denied" });

    if (task.status !== "NEEDS_APPROVAL") {
      return res.status(400).json({ message: "Task is not awaiting approval" });
    }

    // Move task to DONE
    const updated = await prisma.task.update({
      where: { id },
      data: { status: "DONE" },
      include: taskInclude,
    });

    // Create auto-generated activity entry
    const author = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { name: true, email: true },
    });
    const authorName = author?.name || author?.email || "Someone";
    const approvalBody = comment
      ? `Approved with note: ${comment}`
      : "Approved this task.";

    await prisma.taskComment.create({
      data: {
        taskId: id,
        authorId: req.user.userId,
        body: approvalBody,
        type: "APPROVAL",
      },
    });

    // Client-side approval action: notify only the task assignee.
    notifyTaskAssigneeOnlyActivity(
      {
        id: task.id,
        title: task.title,
        agencyId: task.agencyId,
        assigneeId: task.assigneeId,
      },
      req.user.userId,
      authorName,
      "APPROVAL",
      approvalBody
    ).catch((e) => console.warn("[Task] Approval assignee notification error", e?.message));

    return res.json(updated);
  } catch (error: any) {
    console.error("Approve task error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    return res.status(500).json({ message: "Failed to approve task" });
  }
});

// Request revisions on a task (client portal action)
router.post("/:id/request-revisions", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = z.object({ comment: z.string().min(1).max(5000) }).parse(req.body);

    const task = await getTaskForAccess(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (!canAccessTask(req.user, task)) return res.status(403).json({ message: "Access denied" });

    if (task.status !== "NEEDS_APPROVAL") {
      return res.status(400).json({ message: "Task is not awaiting approval" });
    }

    // Move task back to IN_PROGRESS
    const updated = await prisma.task.update({
      where: { id },
      data: { status: "IN_PROGRESS" },
      include: taskInclude,
    });

    // Create revision-request activity entry
    const author = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { name: true, email: true },
    });
    const authorName = author?.name || author?.email || "Someone";

    await prisma.taskComment.create({
      data: {
        taskId: id,
        authorId: req.user.userId,
        body: comment,
        type: "REVISION_REQUEST",
      },
    });

    // Client-side revision request action: notify only the task assignee.
    notifyTaskAssigneeOnlyActivity(
      {
        id: task.id,
        title: task.title,
        agencyId: task.agencyId,
        assigneeId: task.assigneeId,
      },
      req.user.userId,
      authorName,
      "REVISION_REQUEST",
      comment
    ).catch((e) => console.warn("[Task] Revision request assignee notification error", e?.message));

    return res.json(updated);
  } catch (error: any) {
    console.error("Request revisions error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    return res.status(500).json({ message: "Failed to request revisions" });
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
