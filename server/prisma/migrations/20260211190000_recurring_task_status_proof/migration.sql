-- AlterTable: add status and proof to recurring_task_rules (match Create Task fields)
ALTER TABLE `recurring_task_rules` ADD COLUMN `status` ENUM('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE') NOT NULL DEFAULT 'TODO';
ALTER TABLE `recurring_task_rules` ADD COLUMN `proof` LONGTEXT NULL;
