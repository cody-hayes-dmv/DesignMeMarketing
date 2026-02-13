/**
 * One-time script: rename existing uploaded files that contain spaces or unsafe
 * characters so download URLs work on all platforms. Also updates Task and
 * RecurringTaskRule proof/attachments that reference those files.
 *
 * Run from server directory: npm run upload:sanitize
 */

import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const uploadsDir = path.join(process.cwd(), "uploads");

function sanitizeExistingFilename(fullFilename: string): string {
  const sanitized = fullFilename
    .replace(/\s+/g, "-")
    .replace(/[#%?&=[\]{}|\\<>"']/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized ? sanitized : "file" + (path.extname(fullFilename) || "");
}

function needsSanitization(filename: string): boolean {
  const safe = sanitizeExistingFilename(filename);
  return safe !== filename;
}

async function main() {
  if (!fs.existsSync(uploadsDir)) {
    console.log("Uploads directory not found. Nothing to do.");
    return;
  }

  const files = fs.readdirSync(uploadsDir);
  const renames: { oldName: string; newName: string }[] = [];

  for (const filename of files) {
    const fullPath = path.join(uploadsDir, filename);
    if (!fs.statSync(fullPath).isFile()) continue;
    if (!needsSanitization(filename)) continue;

    const newName = sanitizeExistingFilename(filename);
    if (newName === filename) continue;

    const newPath = path.join(uploadsDir, newName);
    if (fs.existsSync(newPath)) {
      console.warn(`Skip: ${filename} -> ${newName} (target already exists)`);
      continue;
    }

    fs.renameSync(fullPath, newPath);
    renames.push({ oldName: filename, newName });
    console.log(`Renamed: ${filename} -> ${newName}`);
  }

  if (renames.length === 0) {
    console.log("No files needed renaming.");
    return;
  }

  // Build replacement map: old filename (and encoded form) -> new filename
  const replaceInValue = (value: string): string => {
    let out = value;
    for (const { oldName, newName } of renames) {
      out = out.split(oldName).join(newName);
      try {
        const encoded = encodeURIComponent(oldName);
        if (encoded !== oldName) out = out.split(encoded).join(newName);
      } catch {
        // ignore
      }
    }
    return out;
  };

  // Update Task.proof
  const tasks = await prisma.task.findMany({
    where: { proof: { not: null } },
    select: { id: true, proof: true },
  });

  let taskUpdates = 0;
  for (const task of tasks) {
    if (!task.proof) continue;
    let parsed: Array<{ type?: string; value: string; name?: string }>;
    try {
      parsed = JSON.parse(task.proof) as Array<{ type?: string; value: string; name?: string }>;
    } catch {
      continue;
    }
    let changed = false;
    const updated = parsed.map((item) => {
      if (typeof item.value !== "string" || !item.value.includes("/uploads/")) return item;
      const newValue = replaceInValue(item.value);
      if (newValue !== item.value) {
        changed = true;
        return { ...item, value: newValue };
      }
      return item;
    });
    if (changed) {
      await prisma.task.update({
        where: { id: task.id },
        data: { proof: JSON.stringify(updated) },
      });
      taskUpdates++;
    }
  }
  console.log(`Updated proof in ${taskUpdates} task(s).`);

  // Update RecurringTaskRule.proof
  const rules = await prisma.recurringTaskRule.findMany({
    where: { proof: { not: null } },
    select: { id: true, proof: true },
  });

  let ruleUpdates = 0;
  for (const rule of rules) {
    if (!rule.proof) continue;
    let parsed: Array<{ type?: string; value: string; name?: string }>;
    try {
      parsed = JSON.parse(rule.proof) as Array<{ type?: string; value: string; name?: string }>;
    } catch {
      continue;
    }
    let changed = false;
    const updated = parsed.map((item) => {
      if (typeof item.value !== "string" || !item.value.includes("/uploads/")) return item;
      const newValue = replaceInValue(item.value);
      if (newValue !== item.value) {
        changed = true;
        return { ...item, value: newValue };
      }
      return item;
    });
    if (changed) {
      await prisma.recurringTaskRule.update({
        where: { id: rule.id },
        data: { proof: JSON.stringify(updated) },
      });
      ruleUpdates++;
    }
  }
  console.log(`Updated proof in ${ruleUpdates} recurring task rule(s).`);

  console.log(`Done. Renamed ${renames.length} file(s), updated ${taskUpdates} tasks and ${ruleUpdates} recurring rules.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
