-- AlterTable: add NEEDS_APPROVAL to TaskStatus enum and approvalNotifyUserIds to tasks
ALTER TABLE `tasks` MODIFY COLUMN `status` ENUM('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'NEEDS_APPROVAL') NOT NULL DEFAULT 'TODO';
ALTER TABLE `tasks` ADD COLUMN `approvalNotifyUserIds` TEXT NULL;
-- RecurringTaskRule uses same TaskStatus enum
ALTER TABLE `recurring_task_rules` MODIFY COLUMN `status` ENUM('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'NEEDS_APPROVAL') NOT NULL DEFAULT 'TODO';
