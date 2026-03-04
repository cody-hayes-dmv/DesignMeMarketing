-- AlterTable: add CANCELLED to TaskStatus enum
ALTER TABLE `tasks` MODIFY COLUMN `status` ENUM('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'NEEDS_APPROVAL', 'CANCELLED') NOT NULL DEFAULT 'TODO';
-- RecurringTaskRule uses same TaskStatus enum
ALTER TABLE `recurring_task_rules` MODIFY COLUMN `status` ENUM('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'NEEDS_APPROVAL', 'CANCELLED') NOT NULL DEFAULT 'TODO';
