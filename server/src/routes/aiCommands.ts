import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticateToken } from "../middleware/auth.js";

const router = Router();

function requireSuperAdmin(req: Request, res: Response, next: () => void) {
  if ((req as any).user?.role !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

router.get("/", authenticateToken, requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const commands = await prisma.aiCommand.findMany({ orderBy: { sortOrder: "asc" } });
    res.json(commands);
  } catch (err) {
    console.error("[AI Commands] list error:", err);
    res.status(500).json({ error: "Failed to load commands" });
  }
});

router.post("/", authenticateToken, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { title, content } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: "Title is required" });
    const maxSort = await prisma.aiCommand.aggregate({ _max: { sortOrder: true } });
    const command = await prisma.aiCommand.create({
      data: { title: title.trim(), content: content || "", sortOrder: (maxSort._max.sortOrder ?? -1) + 1 },
    });
    res.status(201).json(command);
  } catch (err) {
    console.error("[AI Commands] create error:", err);
    res.status(500).json({ error: "Failed to create command" });
  }
});

router.put("/:id", authenticateToken, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { title, content } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: "Title is required" });
    const command = await prisma.aiCommand.update({
      where: { id: req.params.id },
      data: { title: title.trim(), content: content ?? "" },
    });
    res.json(command);
  } catch (err) {
    console.error("[AI Commands] update error:", err);
    res.status(500).json({ error: "Failed to update command" });
  }
});

router.delete("/:id", authenticateToken, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    await prisma.aiCommand.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[AI Commands] delete error:", err);
    res.status(500).json({ error: "Failed to delete command" });
  }
});

export default router;
